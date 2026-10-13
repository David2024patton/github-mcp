# RTC-RESULT-SINGLE-READ — eliminate duplicate retained-result lookup

Status: IMPLEMENTING (target #148). Confirm checks and final-main independently.
Baseline inspected: main 6f58e0894a25e9d1727a074a81251e37dd4e5a25 (#147).
Risk: absent/foreign handle nondisclosure and outage taxonomy. No migration.

## Read only these

AGENTS.md; docs/SESSION-START.md; docs/AI-PR-READ-FIRST.md;
docs/HOSTING-COST-POLICY.md; src/rtc/http.js;
src/tools/server.js getResult; src/tools/dispatch.js catch;
tests/unit/rtc-result-errors.test.js and retained output tests.

## Drift check A

| Prior assumption | Current source behavior | Correction / regression |
| --- | --- | --- |
| #145 needs separate scoped presence to return truthful 404 | Preflight then canonical handler each query owner-scoped DB twice | One canonical read with typed missing-handle outcome |
| All flattened failures can map to 404 | Provider/storage errors are flattened into content text | Only internal RetainedResultNotFound, mapped to fixed failureCode, yields 404 |
| Two scoped lookups offer consistent readback | Result can disappear between reads | Remove TOCTOU window; single lookup regression |
| Standalone users need generic TypeError wording | Existing missing result error is plain TypeError | Subclass TypeError preserving exact user-facing message |

## Implementation contract

- Introduce RetainedResultNotFound in src/core/result-errors.js, thrown only by
  canonical server getResult when a connection-owned row is absent.
- Dispatcher distinguishes this type only for github_get_result. Keep normal
  readable error contents and all existing auth, fields, budgets, retention and
  credential safeguards. Never parse reflected error text or trust arbitrary code.
- RTC maps trusted fixed failureCode to sanitized 404. Any other dispatch/DB
  failure remains sanitized 503. Remove the redundant preflight scoped read.
- Tests: one lookup for owned result and absent/foreign; no two-read race;
  storage outage 503; unrelated error with matching human text still 503;
  original query 400, bearer 401, paging and output unchanged.
- Required exact-head check/db/shapes/two-unit/ci/release-policy, self-review,
  review resolution, green final-main, no secret or connected acceptance claim.

## External gates

Source and CI do not equal deployed Vercel exact revision or real custom
read/denial/revocation, direct OAuth MCP, Hub or scratch cleanup. rtc:0 unchanged.
