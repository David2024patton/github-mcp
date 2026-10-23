// Owner-only deletion of one public person's data. NOT a tool and not a public URL: the protected owner setup page calls it
// after the owner types the person's GitHub account name twice. The person is found by the account name inside each public
// person's own store (personal accounts only, never an organization), so nothing about them is kept at the shared level.
import { createTenantSql } from './directory.js';

const LOGIN = /^[a-z0-9][a-z0-9-]{0,38}$/;
const MAX_TENANTS = 100;

/** @returns {Promise<string[]>} ids of public tenants that connected this GitHub account name */
export async function findPublicTenantsByLogin(rootSql, login, { connectionString, sqlFactory }) {
  const name = String(login ?? '').trim().toLowerCase();
  if (!LOGIN.test(name)) throw new TypeError('Enter a valid GitHub account name.');
  const rows = await rootSql`SELECT tenant_id FROM gh_tenant_pilot_bootstraps WHERE account_login='public-connect' ORDER BY created_at LIMIT ${MAX_TENANTS}`;
  const found = [];
  for (const row of rows) {
    try {
      const sql = createTenantSql(connectionString, String(row.tenant_id), sqlFactory);
      const hit = await sql`SELECT 1 AS hit FROM gh_accounts WHERE lower(login)=${name} AND account_type='User' LIMIT 1`;
      if (hit.length) found.push(String(row.tenant_id));
    } catch { /* an unreadable store is skipped; it is reported by the caller as not found */ }
  }
  return found;
}

/** Deletes every public tenant that connected this account name. Returns how many were removed. */
export async function forgetPublicPerson(directory, rootSql, login, options) {
  const ids = await findPublicTenantsByLogin(rootSql, login, options);
  let removed = 0;
  for (const id of ids) if (await directory.forgetPublicTenant(id)) removed += 1;
  return removed;
}
