// PUB-2 private OAuth token endpoint routing. An OAuth client ID embeds
// server-signed tenant and verified subject IDs; these are only selectors.
// The real tenant's stored OAuth client secret, single-use code/refresh hash,
// and current owner-approved private pilot membership remain mandatory.
// Never retry a private tenant client through legacy owner OAuth storage.
import { neon } from '@neondatabase/serverless';
import { createTenantDirectory, openAuthorizedTenantDb } from './directory.js';
import { verifyTenantCredential, issueTenantCredential } from './routed-credential.js';
import { createOAuthHandlers } from '../core/oauth-handlers.js';
import { createGithubPolicy } from '../oauth/policy.js';
import { paramsOf, send } from '../core/http.js';

export async function privateTenantToken(req, res, {
  env = process.env, rootSqlFactory = neon, tenantSqlFactory = neon
} = {}) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }
  let params;
  try { params = paramsOf(req); } catch { return send(res, 400, { error: 'invalid_request' }); }
  const claim = verifyTenantCredential(params.client_id, 'tcl', env);
  if (!claim || !env.DATABASE_URL) return send(res, 401, { error: 'invalid_client' });
  try {
    const directory = createTenantDirectory(rootSqlFactory(env.DATABASE_URL));
    const pilot = await directory.authorizedPilotIdentity(claim.tenantId, claim.identityId);
    if (!pilot || pilot.tenantId !== claim.tenantId || pilot.identityId !== claim.identityId)
      return send(res, 401, { error: 'invalid_client' });
    const scope = await openAuthorizedTenantDb({
      directory, tenantId: claim.tenantId, verifiedIdentityId: claim.identityId,
      connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory
    });
    if (scope.tenant.namespace !== pilot.namespace ||
        scope.tenant.membershipRevision !== pilot.membershipRevision)
      return send(res, 401, { error: 'invalid_client' });
    const handlers = createOAuthHandlers({
      db: scope.db, env, policy: createGithubPolicy({ env }),
      issueTokens: () => ({
        accessToken: issueTenantCredential('tac', claim, env),
        refreshToken: issueTenantCredential('trf', claim, env)
      })
    });
    return await handlers.token(req, res);
  } catch {
    return send(res, 503, { error: 'temporarily_unavailable' });
  }
}
