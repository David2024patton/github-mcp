# RTC-BATCH-INTEGRITY — validate complete requests; retain bounded aggregate results
Status: MERGED (#144); exact-head/final-main acceptance tracked on PR.
Baseline inspected: #143 validated tree c29acfe8c9a96dc1577ea0226ca8eb4d4aa8cc0a.
Approved scope: Batch R §2/§7 read-only HTTPS batch, C-1 result retention.
One risk area: read batch correctness. No migration/permission change; budget 150 production lines.

## Read only these
AGENTS, SESSION-START, AI-PR-READ-FIRST; src/rtc/http.js;
src/core/validate.js and result-rules.js; src/tools/server.js getResult;
tests/unit/rtc-http.test.js and result-store contract.

## Drift check A
| Assumption | Demonstrated baseline behavior | Correction / test |
| --- | --- | --- |
| Complete malformed batch is refused before reads | Later schema-invalid args are checked inside execution loop | Validate every canonical schema up front; zero executed reads |
| Per-read 8 KiB budget bounds batches | Ten separately bounded replies exceed 8 KiB together | Bound UTF-8 envelope, retain ordered aggregate in existing store |
| Cut batches stay retrievable | No aggregate handle/count exists | Retain all original rows/child handles before returning preview |
| Storage failure permits successful partial reply | No aggregate retention path | Return sanitized 503 rather than lose data silently |

## Build contract
- Keep existing ten-call/32 KiB request limits and shape/area refusal order.
  Canonical validateArgs must accept every call before any dispatch/additional rate.
- Continue live pass/expiry/scratch checks and one shared rate unit per read.
- `rtcBatchReply` keeps small envelopes unchanged. Oversized replies include
  full aggregate handle, count/shown and next page=1/pageSize=1. Preview contains
  complete prefix rows only; every original child handle is preserved in storage.
- Existing putResult binds the aggregate to current RTC client, default 24h TTL.
  Missing/failed storage throws into sanitized HTTP 503. Never expose DB errors.
- Real dispatcher/fake DB test: ten ordered UTF-8 reads, independent result
  paging without rerunning handlers, foreign owner refusal, child handles, storage
  failure and malformed later argument with no prior dispatch.
- Commands: targeted rtc-batch-integrity/http/openapi; npm run check; npm test;
  exact-head ci/release-policy/reviews; final-main checks. DB storage contract unchanged.

## Done when
Every valid inline batch fits 8192 bytes, or returns a persisted aggregate handle
and truthful preview count. Malformed later schemas execute no reads. All existing
mid-batch revocation/expiry/scratch/rate tests stay green. No RTC1 claim or live proof.
