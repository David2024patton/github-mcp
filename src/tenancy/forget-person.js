// Owner-only deletion of one public person's data. NOT a tool and not a public URL: the protected owner setup page calls it
// after the owner types the person's GitHub account name twice. The person is found by the account name inside each public
// person's own store (personal accounts only, never an organization), so nothing about them is kept at the shared level.
import { createTenantDirectory, createTenantSql } from './directory.js';

const LOGIN = /^[a-z0-9][a-z0-9-]{0,38}$/;
const PAGE = 200;

/** @returns {Promise<string[]>} ids of public tenants that connected this GitHub account name.
 * PUB-5 A: the shared grant (it already holds the personal GitHub name) names the candidates, and each candidate's own store
 * still confirms it. Only when that finds nobody (for example the grant was removed by the inactive clean-up) every public
 * person is scanned in pages of 200, with no ceiling. */
export async function findPublicTenantsByLogin(rootSql, login, { connectionString, sqlFactory }) {
  const name = String(login ?? '').trim().toLowerCase();
  if (!LOGIN.test(name)) throw new TypeError('Enter a valid GitHub account name.');
  const directory = createTenantDirectory(rootSql);
  const confirm = async (ids) => {
    const found = [];
    for (const id of ids) {
      try {
        const sql = createTenantSql(connectionString, id, sqlFactory);
        const hit = await sql`SELECT 1 AS hit FROM gh_accounts WHERE lower(login)=${name} AND account_type='User' LIMIT 1`;
        if (hit.length) found.push(id);
      } catch { /* an unreadable store is skipped; it is reported by the caller as not found */ }
    }
    return found;
  };
  const viaGrant = await confirm(await directory.publicTenantsByUserLogin(name));
  if (viaGrant.length) return viaGrant;
  const found = [];
  for (let last = null, ids = await directory.publicTenantPage(null, PAGE); ids.length; ids = await directory.publicTenantPage(last, PAGE)) {
    last = ids[ids.length - 1];
    found.push(...await confirm(ids));
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
