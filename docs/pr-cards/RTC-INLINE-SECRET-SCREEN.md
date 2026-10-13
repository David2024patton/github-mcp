# RTC-INLINE-SECRET-SCREEN — independent HTTPS last-mile credential refusal

Status: MERGED (#153; all seven exact-head application/release checks passed).
Baseline: merged main ff9f0ae0006a12c80e3a8fd89e30bacc753191c8 (#152).
Risk: outgoing HTTP read credential screening. No provider operation,
credential handling change, pass grant, migration, write or release change.

## Drift check A
| Assumption | #152 implementation observed | Correction and regression |
| --- | --- | --- |
| Every HTTP 200 is independently screened | Canonical dispatcher screens, but readEnvelope checks credentials only on oversized retention | Screen the complete successful envelope before small inline return |
| Reused handle summary cannot contain token-shaped data | readEnvelope promotes kept_result.what without an independent check when under budget | Fail 503 on credential-shaped summary too |
| Batch is equally weak | rtcBatchReply already screens before size tests | Leave batch and canonical unchanged |

## Implementation
Screen every successful restricted RTC direct/read-result/description HTTP
envelope for credential-shaped text before returning 200 or retaining
additional data. Do not log or return suspect content; preserve the
canonical dispatcher's existing independent screen and all source guards.
Regression covers deliberately injected credential-shaped small body and
reused-handle summary, with sanitized 503 and zero store writes.
Keep safe small/null/read/retained cases passing.

## Acceptance boundaries
All seven exact-head and final-main CI checks, self-review, review threads,
and permanent final handoff remain gates. No local shell validation claimed.
Custom OAuth MCP, real service-issued pass, Hub routes, RTC1, revocation
and separately approved scratch cleanup are UNVERIFIED; no deployment,
production access, spend or preview change. rtc:0 unchanged.
