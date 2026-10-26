// GitHub MCP composition boundary: the reusable core handlers are dependency-injected with this server's policy.
import { createOAuthHandlers } from '../core/oauth-handlers.js';
import { createGithubPolicy } from './policy.js';
import { getDb } from '../runtime.js';
import { isTenantRoutedCredential } from '../tenancy/routed-credential.js';
import { privateTenantToken } from '../tenancy/oauth-token.js';
import { paramsOf, send } from '../core/http.js';
import { clientIp } from '../core/oauth.js';
import { createIpRateLimiter } from '../core/ip-rate-limit.js';
import privateTenantAuthorize from '../../api/tenant/oauth/authorize.js';
import { isPublicClientId } from '../tenancy/public-code.js';
import { publicConnectEnabled } from '../tenancy/public-connect.js';
import { publicApprove, publicAuthorize, publicForget, publicLimits, publicManage, publicTrust, publicMoved, publicRegister } from '../tenancy/public-http.js';

// Defaults below: 30 registrations and 60 token requests a minute per IP.
const registerRate = createIpRateLimiter({ limit: 30, windowMs: 60_000 });
const tokenRate = createIpRateLimiter({ limit: 60, windowMs: 60_000 });
const MAX_REGISTER_BODY_BYTES = 64 * 1024;

const rateLimited = (limiter, req, res) => {
  const verdict = limiter.check(clientIp(req));
  if (verdict.allowed) return false;
  res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
  send(res, 429, { error: 'slow_down', error_description: 'Too many requests; try again after the Retry-After delay' });
  return true;
};


/** Runs one OAuth handler. Any failure answers 503 with no detail (never SQL, tokens, passphrases or stack text).
 * Malformed request bodies are refused with 400 before this catch-all can see them (see the guards below). */
export async function handleOAuth(which, req, res, { db, env = process.env, consentFactory } = {}) {
  try {
    // The unauthenticated endpoints are brute-force and abuse targets, so each IP (read with the
    // same trusted-header helper the admin login uses) gets a fixed budget: 30 registrations and
    // 60 token requests a minute. In-memory and per-instance, hence best-effort on serverless
    // (see ip-rate-limit.js for why nothing DB-backed in this repo fits per-IP throttling).
    if (which === 'register' && req.method === 'POST') {
      if (rateLimited(registerRate, req, res)) return;
      // Oversized bodies are refused before any parsing: the actual string bytes when the body
      // is still raw, otherwise the declared length (serverless platforms pre-parse JSON bodies).
      const declared = Number(req.headers?.['content-length']);
      const raw = typeof req.body === 'string' ? Buffer.byteLength(req.body) : 0;
      if (raw > MAX_REGISTER_BODY_BYTES || (Number.isFinite(declared) && declared > MAX_REGISTER_BODY_BYTES)) {
        return send(res, 413, { error: 'too_large', error_description: 'Registration body exceeds 64 KB' });
      }
      // Unparseable JSON is the client's fault, not an outage: answer it here so a SyntaxError
      // from paramsOf can never fall through to the 503 catch-all below.
      try { paramsOf(req); } catch { return send(res, 400, { error: 'invalid_request', error_description: 'Malformed registration body' }); }
    }
    if (which === 'token' && req.method === 'POST' && rateLimited(tokenRate, req, res)) return;
    // PUB-6 (dark): while GITHUB_PUBLIC_CONNECT is on, registration creates public clients (pcl_), never owner clients.
    if (which === 'register' && publicConnectEnabled(env)) return await publicRegister(req, res, { env });
    if (which === 'authorize' && ['GET','POST'].includes(req.method)) {
      let params;
      try { params = paramsOf(req); } catch { return send(res, 400, { error: 'invalid_request' }); }
      // Standard MCP discovery advertises /api/oauth/authorize. A pre-enrolled
      // PRIVATE tenant client must land on GitHub consent there, not the
      // global owner's administrator-passphrase authorization page.
      // Invalid signed clients fail closed; never query the owner DB for them.
      if (publicConnectEnabled(env)) {
        if (params.page === 'limits') return await publicLimits(req, res, { env });
        if (['privacy', 'terms', 'security', 'support'].includes(params.page)) return await publicTrust(req, res, { env });
        if (params.forget === '1') return await publicForget(req, res, { env });
        if (params.manage === '1' || req.query?.manage === '1') return await publicManage(req, res, { env });
        if (params.step === 'approve') return await publicApprove(req, res, { env });
      }
      if (isPublicClientId(params.client_id)) return await publicAuthorize(req, res, { env });
      if (isTenantRoutedCredential(params.client_id)) {
        // One sign-in for everyone: once the public sign-in is on, the older private-pilot sign-in takes no NEW sign-ins.
        // Connections it already made keep working (their refresh is untouched); reconnecting goes through the new flow.
        if (publicConnectEnabled(env)) return publicMoved(req, res);
        return privateTenantAuthorize(req,res,{env,consentFactory});
      }
    }
    if (which === 'token' && req.method === 'POST') {
      let params;
      try { params = paramsOf(req); } catch { return send(res, 400, { error: 'invalid_request' }); }
      // Never try an explicitly tenant-routed client/refresh token against
      // the legacy owner database, even if the marker/signature is invalid.
      if (isTenantRoutedCredential(params.client_id) || isPublicClientId(params.client_id))
        return privateTenantToken(req, res, { env });
      if (isTenantRoutedCredential(params.refresh_token) ||
          isTenantRoutedCredential(params.code))
        return send(res, 401, { error: 'invalid_client' });
    }
    const handlers = createOAuthHandlers({ db: db ?? await getDb(), env, policy: createGithubPolicy({ env }),
      ...(env.GITHUB_PRIVATE_TENANT_PILOT==='enabled'?{scopesSupported:['github.notifications.read']}:{}) });
    return await handlers[which](req, res);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'temporarily_unavailable', error_description: 'GitHub MCP is not configured or its database is unavailable' });
  }
}
