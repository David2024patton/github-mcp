# RTC-RESULT-ERRORS — scoped retained-read failure taxonomy
Status: MERGED (#145) in implementation documentation; merge/CI/live acceptance must be separately verified.
Baseline inspected: main c945fe2781b81cc7bad68016c4eaac3e13a5f41b (#144).
Approved scope: Batch C-1 retained results and existing RTC restricted HTTPS §7.
Risk area: result ownership and truthful failure classification. No migration; no new tool or permission.

## Read only these
AGENTS.md and SESSION-START.md; AI-PR-READ-FIRST; hosting policy;
src/rtc/http.js (results route), src/tools/server.js getResult,
src/tools/dispatch.js read failures; tests/unit/rtc-http.test.js,
tests/unit/rtc-batch-integrity.test.js, test/helpers/fake-db.js.

## Drift check A
| Baseline assumption | Actual source at #144 | Correction / evidence |
| --- | --- | --- |
| A failed retained page means no handle exists | All non-200 canonical responses remapped to 404 | Separate scoped absence (404) from unavailable read (503) |
| A text failure can classify a result | Dispatcher intentionally redacts/flattens exceptions | Never inspect error text or forward provider/DB detail |
| Calling a retained handler establishes ownership | Canonical handler already uses connection client ID | Preflight owner-scoped DB lookup, then canonical guarded read |
| Authorized malformed parameters should remain 400 | Query validation precedes handler and rate-limited dispatch | Keep rejection before owned-handle lookup, preserve 400 |

## Implementation contract
- `src/rtc/http.js`: after RTC pass, scratch and shared-rate authorization,
  validate query; distinguish missing or other-connection `res_` handle with
  `db.getResult(handle, connection.client_id)` before invoking the canonical
  guarded `github_get_result` handler. Do not inspect flattened error text.
- The canonical result handler continues to own pagination, field projection,
  output shaping, retention expiry and connection checks. If storage fails,
  dispatch returns an error, or a result disappears between reads, return
  sanitized 503; do not invent 404, leak internal text or return partial success.
- `tests/unit/rtc-result-errors.test.js`: fake DB + actual dispatcher prove
  owned paging, absent/foreign 404, thrown DB error 503, thrown/flattened/invalid
  dispatcher output 503, disappearing result 503, query 400 and missing bearer
  401. Retained-owner identity remains fail-closed.
- Validation: targeted vitest, npm run check, npm test, exact-head `ci` and
  `release-policy`, self-review and final-main gates. Never bypass any check.

## Done when
HTTP 404 means missing/inaccessible retained handle only; 503 means a
backend/read failure. No source failure is claimed deployed until checked
main->live plus independently matched Vercel READY source. Genuine authorized
pass, original OAuth MCP, Hub, Sandbox, revocation and scratch cleanup remain
separate, unverified acceptance.
