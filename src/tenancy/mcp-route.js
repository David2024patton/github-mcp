// PRIVATE tenant MCP routing boundary. Every tenant bearer is self-scoped by
// HMAC, checked against current membership/allowlist, AND looked up by hash in
// only that tenant's store. A failed tenant credential must NEVER be looked up
// through the legacy owner's global database.
import { neon } from '@neondatabase/serverless';
import { createTenantDirectory, openAuthorizedTenantDb } from './directory.js';
import { isTenantRoutedCredential, verifyTenantCredential } from './routed-credential.js';
import { createCredentials } from '../github/credentials.js';

export const isPrivateTenantBearer = (authorization) =>
  typeof authorization === 'string' &&
  /^Bearer (?:tac|trf|tcl)_/.test(authorization);

/** Dependency overrides are for private tests only; no user-visible route
 * accepts an arbitrary tenant identifier, identity or tenant SQL handle. */
export async function resolvePrivateTenantMcpBearer({
  authorization, env = process.env, fetchImpl = fetch, rootSqlFactory = neon,
  tenantSqlFactory = neon
}) {
  const value = /^Bearer ([A-Za-z0-9_-]{30,256})$/.exec(String(authorization || ''))?.[1];
  if (!value || !isTenantRoutedCredential(value)) return null;
  const claim = verifyTenantCredential(value, 'tac', env);
  if (!claim || !env.DATABASE_URL) return null;
  try {
    const directory = createTenantDirectory(rootSqlFactory(env.DATABASE_URL));
    const authorized = await directory.authorizedPilotIdentity(claim.tenantId, claim.identityId);
    if (!authorized || authorized.tenantId !== claim.tenantId ||
        authorized.identityId !== claim.identityId) return null;
    const { db, tenant } = await openAuthorizedTenantDb({
      directory, tenantId: claim.tenantId, verifiedIdentityId: claim.identityId,
      connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory
    });
    if (tenant.namespace !== authorized.namespace ||
        tenant.membershipRevision !== authorized.membershipRevision) return null;
    const grant = await db.getAccessToken(value);
    // The token must be a real tenant-scoped connector issued to exactly
    // this identity, with its registered client also MAC-bound to the same
    // tenant/identity. Arbitrary legacy client IDs never inherit tenant access.
    const client = grant?.client_id &&
      verifyTenantCredential(grant.client_id, 'tcl', env);
    if (!client || client.tenantId !== claim.tenantId ||
        client.identityId !== claim.identityId) return null;
    return { db, credentials: createCredentials({ db, env, fetch: fetchImpl }),
      tenant: Object.freeze({ ...authorized }) };
  } catch {
    // Missing private registry, driver search_path refusal, revocation, and
    // database failure are all a closed authentication failure. No SQL details.
    return null;
  }
}
