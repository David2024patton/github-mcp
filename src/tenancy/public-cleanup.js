// LAUNCH-1: when someone who connected through the public sign-in uninstalls (or suspends) the App, or revokes its
// authorization on GitHub, the matching state kept in THEIR OWN store is cleaned up too. GitHub already refuses the
// installation token, so this is stale state rather than access, but it must not linger. Only numbers and one status word are
// handled here: no token, repository text or name ever passes through, and it never writes to GitHub.
import { createTenantDirectory, createTenantSql } from './directory.js';
import { createDb } from '../db.js';

const BACKFILL_KEY = 'public_installations_backfilled';

const STATUS = { deleted: 'none', suspend: 'suspended', unsuspend: 'active' };

/** @param {{ rootSql: Function, connectionString: string, sqlFactory?: Function }} deps */
export function createPublicCleanup({ rootSql, connectionString, sqlFactory }) {
  const directory = createTenantDirectory(rootSql);
  // PUB-5 A: ONE shared lookup (installation -> people) instead of opening every person's store. The first time it finds
  // nothing, it is filled once from the people's own stores (people who signed in before the lookup existed) and a marker is saved.
  async function tenantsFor(installationId) {
    const found = await directory.publicTenantsForInstallation(installationId);
    if (found.length) return found;
    const root = createDb(rootSql);
    if (await root.getSetting(BACKFILL_KEY)) return found;
    await directory.backfillPublicInstallations({ readInstallationIds: async (tenantId) => {
      const sql = createTenantSql(connectionString, tenantId, sqlFactory);
      return (await sql`SELECT installation_id FROM gh_accounts WHERE credential_kind = 'app' AND installation_id IS NOT NULL`)
        .map((r) => Number(r.installation_id));
    } });
    await root.setSetting(BACKFILL_KEY, true);
    return await directory.publicTenantsForInstallation(installationId);
  }
  return Object.freeze({
    /** @returns {Promise<number>} how many people's stores changed */
    async installationChanged({ installationId, action }) {
      const status = STATUS[action];
      if (!status || !Number.isSafeInteger(installationId) || installationId <= 0) return 0;
      let changed = 0;
      for (const tenantId of await tenantsFor(installationId)) {
        try {
          const sql = createTenantSql(connectionString, tenantId, sqlFactory);
          const rows = await sql`UPDATE gh_accounts SET installation_status = ${status}, checked_at = now()
            WHERE installation_id = ${installationId} AND credential_kind = 'app' RETURNING login`;
          if (!rows.length) continue;
          await sql`DELETE FROM gh_installation_tokens WHERE installation_id = ${installationId}`;
          changed += 1;
        } catch { /* one unreadable store never stops the others */ }
      }
      return changed;
    },
    /** @returns {Promise<number>} how many stored user grants were removed */
    async authorizationRevoked({ subject }) {
      return await directory.revokeUserAuthorizationsBySubject(subject);
    }
  });
}
