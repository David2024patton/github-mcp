# RTC-POSTREAD-AUTHORITY — refuse in-flight reads after authority changes

Status: IMPLEMENTING (target #150). Baseline: main 5c249cd0dfb836275dd39859b9b48a5422cce485 (#149).
Risk area: authorization revocation consistency. No DB migration, provider mutation,
new token/pass, scope expansion, production or billing change.

## Read only these
AGENTS.md, docs/SESSION-START.md, docs/AI-PR-READ-FIRST.md;
docs/HOSTING-COST-POLICY.md; src/rtc/http.js authenticate and response paths;
tests/unit/rtc-http.test.js, rtc-batch-integrity.test.js,
tests/unit/rtc-cross-process*.test.js if present.

## Drift check A
| Assumption | Inspected main behavior | Corrective code and regression |
| --- | --- | --- |
| Pre-dispatch pass check guarantees response authority | A long read can finish after revocation, expiry or scratch designation removal | Recheck trusted server pass+account before successful send |
| Batch inter-call checks cover final read | Last batch read has no following check | Final no-rate authority verification before sending combined results |
| Revalidating requires another rate unit | Existing authenticate always consumes rate | Add explicit consumeRate=false for final recheck; one rate unit per actual read |
| Failed recheck may reveal stale result | Handler catches storage exceptions and sanitizes them | Return 401/403/503, never release stale data or private DB error |

## Implementation contract
- Authenticate before every read as before, then revalidate protected current
  pass expiry, revocation, exact preview/read_only scopes and verified scratch
  account immediately before sending a successful response.
- Final recheck does not consume extra pass-rate budget. Inter-call batch
  rechecks continue charging one real rate unit per read, unchanged.
- Public contract/OpenAPI routes have no authentication change. Do not leak
  a completed read after a late revocation or scratch disable; fail closed on
  database authorization outage.
- Tests: revoked/expired/scratch removal during read; final batch revocation,
  successful single-read one rate unit, final auth DB outage sanitized 503;
  preserve original request denials, write refusals and cross-process rates.
- Check full required exact-head seven jobs, self-review, resolve reviews,
  exact-main post-merge seven checks, permanent handoff and unverified live
  acceptance. No owner pass or real provider write involved.

## Real acceptance still open
Postread tests use controlled fakes. Genuine independently authorized service-
issued scratch pass read/denial/revocation, original OAuth MCP, RTC1 Hub routes,
run-owned deletion cleanup, scheduled deployed exact revision stay independent
and cannot be certified from this PR. rtc:0 unchanged.
