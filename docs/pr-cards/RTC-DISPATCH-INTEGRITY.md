# RTC-DISPATCH-INTEGRITY — truthful HTTP result vs argument errors
Status: PR #140 implementation; hosted RTC and OAuth acceptance remain OPEN.
Baseline inspected: f3ec5751ce27a0dc40118374c5b29bdaa5b64233 (merged #139). Service-owned read-only HTTPS only.

## Read only these
AGENTS.md, SESSION-START.md, hosting policy; src/rtc/http.js, src/core/validate.js;
src/tools/dispatch.js; tests/unit/rtc-http.test.js; recovery #133.

## Drift check A
| Assumption | Actual source at baseline | Correction |
| --- | --- | --- |
| Every wrapped dispatcher error is invalid input | Provider unavailable and refusal also set isError | Prevalidate with canonical validateArgs, 503 on runtime failure |
| A missing result shape is a legitimate null read | Missing structuredContent returned HTTP 200 null | Require explicit structuredContent property; explicit null remains valid |
| Error text can be forwarded | Handler text can disclose private provider detail | Only return sanitized existing service_error envelope |

## Implementation and acceptance
Reuse exact canonical argument validator before dispatch; malformed request
is HTTP 400 and cannot run provider; isError/malformed outcome is HTTP 503
with fixed generic service_error (no private text). `structuredContent:null`
remains a legitimate declared success. Retained handles and successful batch
responses are unchanged. Tests cover real envelope paths, malformed input,
simulated upstream error, absent result, null read, batch and redaction.
No new endpoint, profile, area, production, money or provider permissions.
Exact-head seven checks, self-review, final-main CI, separate external gates.
