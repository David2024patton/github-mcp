// Owner-only, read-only summary of public sign-in usage. Aggregate numbers only: how many people are connected and how
// many assistant calls ran in the last day and week, by result. No names, tokens, repository text or client ids ever
// appear. Each person's counts live in that person's own store, so this adds them up one store at a time (a hard cap
// keeps one page load small). It changes nothing and charges nobody: it exists so the owner can see how the service is used.
import { createTenantDirectory, createTenantSql } from './directory.js';

const PAGE = 200;
const TIME_BUDGET_MS = 8000;
const empty = () => ({ calls: 0, ok: 0, refused: 0, throttled: 0, errors: 0 });

/** PUB-5 A: no ceiling on people. Public people are read in pages of 200 (keyset paging). After a time budget of 8 seconds it
 *  stops and says `partial: true` with how many were counted, never a wrong total.
 *  @param {Function} rootSql the shared database, tagged-template style
 *  @param {{connectionString:string, sqlFactory?:Function, timeBudgetMs?:number}} options */
export async function publicUsageSummary(rootSql, { connectionString, sqlFactory, timeBudgetMs = TIME_BUDGET_MS }) {
  const directory = createTenantDirectory(rootSql);
  const started = Date.now();
  const day = empty(), week = empty();
  let counted = 0, unreadable = 0, partial = false;
  scan: for (let last = null, ids = await directory.publicTenantPage(null, PAGE); ids.length; ids = await directory.publicTenantPage(last, PAGE)) {
    for (const tenantId of ids) {
      if (Date.now() - started > timeBudgetMs) { partial = true; break scan; }
      last = tenantId;
      try {
        const sql = createTenantSql(connectionString, tenantId, sqlFactory);
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
      counted += 1;
    }
  }
  return { peopleConnected: counted, partial, moreThanShown: partial, unreadable, lastDay: day, lastWeek: week };
}
