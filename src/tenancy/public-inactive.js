// PUB-5 B: people who stopped using the service. After PUBLIC_INACTIVE_DAYS (default 180) without a call or a sign-in, their
// stored GitHub grants (shared level) and the app tokens in their own store are deleted. Their store and settings stay and they
// simply sign in again. "Last seen" is the LATER of their newest usage day and their newest grant update, so someone who signed in
// but has not called yet is not removed. People on the unlimited list (numeric GitHub ids) are never removed. It never touches GitHub.
import { createTenantSql } from './directory.js';

const HOUR_MS = 60 * 60 * 1000;
const LAST_RUN_KEY = 'public_inactive_last_run';

/** @returns {Promise<number>} how many people were signed out (at most `limit`) */
export async function removeInactivePeople({ rootSql, connectionString, sqlFactory, limits, limit = 20, exceptTenantId = null }) {
  const days = limits.inactiveDays;
  const exempt = [...limits.unlimitedSubjects];
  const except = exceptTenantId ?? '00000000-0000-0000-0000-000000000000';
  const rows = await rootSql`SELECT a.tenant_id FROM (
        SELECT tenant_id, max(updated_at) AS seen FROM gh_tenant_user_authorizations GROUP BY tenant_id) a
      JOIN gh_tenant_pilot_bootstraps b ON b.tenant_id = a.tenant_id AND b.account_login = 'public-connect'
      JOIN gh_tenant_identities i ON i.id = b.identity_id
      WHERE a.seen < now() - (${days} * interval '1 day')
        AND a.tenant_id <> ${except}::uuid
        AND i.provider_subject <> ALL(${exempt}::text[])
        AND NOT EXISTS (SELECT 1 FROM gh_public_usage_daily u WHERE u.tenant_id = a.tenant_id
          AND u.day > (now() AT TIME ZONE 'UTC')::date - ${days}::int)
      ORDER BY a.seen LIMIT ${Math.min(Math.max(limit, 1), 50)}`;
  let removed = 0;
  for (const row of rows) {
    const tenantId = String(row.tenant_id);
    try {
      // The person's own app tokens first; if that fails nothing at the shared level is removed and the next run tries again.
      await createTenantSql(connectionString, tenantId, sqlFactory)`DELETE FROM oauth_tokens`;
      await rootSql`DELETE FROM gh_tenant_user_authorizations WHERE tenant_id = ${tenantId}::uuid`;
      removed += 1;
    } catch { /* one person's problem never stops the others */ }
  }
  return removed;
}

/** Runs the clean-up at most once an hour (the time is kept in the shared settings), so a sign-in pays for it only now and then. */
export async function removeInactivePeopleHourly({ root, now = Date.now, ...deps }) {
  const last = await root.getSetting(LAST_RUN_KEY).catch(() => null);
  if (Number.isFinite(last) && now() - last >= 0 && now() - last < HOUR_MS) return 0;
  await root.setSetting(LAST_RUN_KEY, now());
  return await removeInactivePeople(deps);
}
