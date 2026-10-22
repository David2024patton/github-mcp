// GitHub MCP composition boundary: the reusable core handlers are dependency-injected with this server's policy.
import { createOAuthHandlers } from '../core/oauth-handlers.js';
import { createGithubPolicy } from './policy.js';
import { getDb } from '../runtime.js';
import { isTenantRoutedCredential } from '../tenancy/routed-credential.js';
import { privateTenantToken } from '../tenancy/oauth-token.js';
import { paramsOf, send } from '../core/http.js';
import privateTenantAuthorize from '../../api/tenant/oauth/authorize.js';

/** Runs one OAuth handler. Any failure answers 503 with no detail (never SQL, tokens, passphrases or stack text). */
export async function handleOAuth(which, req, res, { db, env = process.env } = {}) {
  try {
    if (which === 'authorize' && ['GET','POST'].includes(req.method)) {
      let params;
      try { params = paramsOf(req); } catch { return send(res, 400, { error: 'invalid_request' }); }
      // Standard MCP discovery advertises /api/oauth/authorize. A pre-enrolled
      // PRIVATE tenant client must land on GitHub consent there, not the
      // global owner's administrator-passphrase authorization page.
      // Invalid signed clients fail closed; never query the owner DB for them.
      if (isTenantRoutedCredential(params.client_id))
        return privateTenantAuthorize(req,res,{env});
    }
    if (which === 'token' && req.method === 'POST') {
      let params;
      try { params = paramsOf(req); } catch { return send(res, 400, { error: 'invalid_request' }); }
      // Never try an explicitly tenant-routed client/refresh token against
      // the legacy owner database, even if the marker/signature is invalid.
      if (isTenantRoutedCredential(params.client_id))
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
