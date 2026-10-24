// Owner-only, read-only summary of public sign-in usage, for the protected setup page. PUB-5 B: every number comes from ONE source,
// the shared usage tables (numbers per person per day), so it is a handful of cheap queries however many people there are.
// Only for the ten heaviest people this week it reads their GitHub name from their own store (to prevent abuse and control cost);
// the shared level keeps no names. It changes nothing and charges nobody.
import { createDb } from '../db.js';
import { createTenantSql } from './directory.js';
import { publicUsageLimits } from './public-usage.js';
import { estimatePublicCost, publicSignupState } from './usage-cost.js';

const TOP = 10;

/** @param {Function} rootSql the shared database, tagged-template style
 *  @param {{connectionString:string, sqlFactory?:Function, env?:Record<string,string|undefined>, now?:()=>number}} options */
export async function publicUsageSummary(rootSql, { connectionString, sqlFactory, env = process.env, now = Date.now }) {
  const [people] = await rootSql`SELECT count(*)::int AS n FROM gh_tenant_pilot_bootstraps WHERE account_login = 'public-connect'`;
  const [t] = await rootSql`SELECT
      COALESCE(SUM(calls)  FILTER (WHERE day = d), 0)::bigint AS calls_day,
      COALESCE(SUM(writes) FILTER (WHERE day = d), 0)::bigint AS writes_day,
      COALESCE(SUM(errors) FILTER (WHERE day = d), 0)::bigint AS errors_day,
      COUNT(DISTINCT tenant_id) FILTER (WHERE day = d)::int AS active_day,
      COALESCE(SUM(calls), 0)::bigint AS calls_week, COALESCE(SUM(writes), 0)::bigint AS writes_week,
      COALESCE(SUM(errors), 0)::bigint AS errors_week, COUNT(DISTINCT tenant_id)::int AS active_week
    FROM gh_public_usage_daily, (SELECT (now() AT TIME ZONE 'UTC')::date AS d) today
    WHERE day > d - 7`;
  const heaviest = await rootSql`SELECT tenant_id, SUM(calls)::bigint AS calls, SUM(writes)::bigint AS writes
    FROM gh_public_usage_daily WHERE day > (now() AT TIME ZONE 'UTC')::date - 7
    GROUP BY tenant_id ORDER BY 2 DESC, tenant_id LIMIT ${TOP}`;
  const top = [];
  let unreadable = 0;
  for (const row of heaviest) {
    let login = null;
    try {
      const sql = createTenantSql(connectionString, String(row.tenant_id), sqlFactory);
      const found = await sql`SELECT login FROM gh_accounts WHERE account_type = 'User' ORDER BY is_default DESC, login LIMIT 1`;
      login = found[0]?.login ?? null;
    } catch { unreadable += 1; }
    top.push({ login, calls: Number(row.calls), writes: Number(row.writes) });
  }
  const limits = publicUsageLimits(env);
  const lastWeek = { calls: Number(t.calls_week), writes: Number(t.writes_week), errors: Number(t.errors_week) };
  const signups = await publicSignupState({ rootSql, root: createDb(rootSql), env, limits, now }).catch(() => null);
  return {
    peopleConnected: people.n, partial: false, moreThanShown: false, unreadable,
    activeToday: t.active_day, activeThisWeek: t.active_week,
    lastDay: { calls: Number(t.calls_day), writes: Number(t.writes_day), errors: Number(t.errors_day) }, lastWeek,
    cost: estimatePublicCost({ lastWeek }, env), signups, top, limits: { callsPerDay: limits.callsPerDay, writesPerHour: limits.writesPerHour }
  };
}
