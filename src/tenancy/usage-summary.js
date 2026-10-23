// Owner-only, read-only summary of public sign-in usage. Aggregate numbers only: how many people are connected and how
// many assistant calls ran in the last day and week, by result. No names, tokens, repository text or client ids ever
// appear. Each person's counts live in that person's own store, so this adds them up one store at a time (a hard cap
// keeps one page load small). It changes nothing and charges nobody: it exists so the owner can see how the service is used.
import { createTenantSql } from './directory.js';

const MAX_TENANTS = 100;
const empty = () => ({ calls: 0, ok: 0, refused: 0, throttled: 0, errors: 0 });

/** @param {Function} rootSql the shared database, tagged-template style
 *  @param {{connectionString:string, sqlFactory?:Function}} options */
export async function publicUsageSummary(rootSql, { connectionString, sqlFactory }) {
  const people = await rootSql`SELECT tenant_id FROM gh_tenant_pilot_bootstraps WHERE account_login='public-connect' ORDER BY created_at LIMIT ${MAX_TENANTS + 1}`;
  const counted = people.slice(0, MAX_TENANTS);
  const day = empty(), week = empty();
  let unreadable = 0;
  for (const row of counted) {
    try {
      const sql = createTenantSql(connectionString, String(row.tenant_id), sqlFactory);
      const rows = await sql`SELECT outcome,
          COALESCE(SUM(count) FILTER (WHERE hour >= now() - interval '1 day'),0)::bigint AS day,
          COALESCE(SUM(count) FILTER (WHERE hour >= now() - interval '7 days'),0)::bigint AS week
        FROM gh_tenant_runtime_metrics WHERE event='mcp' GROUP BY outcome`;
      for (const r of rows) {
        const key = r.outcome === 'error' ? 'errors' : r.outcome;
        if (!(key in day)) continue;
        day[key] += Number(r.day); week[key] += Number(r.week);
        day.calls += Number(r.day); week.calls += Number(r.week);
      }
    } catch { unreadable += 1; }
  }
  return { peopleConnected: counted.length, moreThanShown: people.length > MAX_TENANTS, unreadable, lastDay: day, lastWeek: week };
}
