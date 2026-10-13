# RTC-OPENAPI — usable current HTTP wire description

Status: MERGED #136 implementation slice; full RTC/deployed connected acceptance remains IN_PROGRESS.
Baseline: #135 `18ea274ce043c1f50a9a7e2c6281a021ad3e4a28`.
Scope: approved service-owned RTC compatibility after architecture recovery #133.

## Read only these
- AGENTS, SESSION-START, hosting policy
- src/rtc/http.js query/body/response contracts; contract.js discovery
- docs/audits/RTC-HUB-ADOPTION.md
- tests/unit/rtc-http.test.js, rtc-conformance.test.js

## Drift A
Existing OpenAPI had only summaries/security/200 labels. Required path placeholders lacked parameters; bodies, paging limits, envelopes and rate denials were undiscoverable. OpenAPI 3.1 requires path parameters to be declared and required. This is a current-interface fix, not a new API or full RTC1 gate closure.

## Implementation
- Complete eight-operation, seven-path schema for the actual restricted pass-only door.
- Tool POST body is its arguments directly; batch is only calls (1–10), with name and optional object args, no extra envelope fields.
- Declare public no-auth operations separately; do not accept MCP OAuth or provider credentials on pass routes.
- Schema actual page/result/field bounds, success/error envelope and Retry-After.
- Complete document <=8192 UTF-8 bytes; no bearer example or credential output.

## Verification
JSON Schema checks for batch requests and actual adapter success/refusal results; finite structural path/operation/reference checks; existing auth/HTTP/pinned conformance, full check/unit/db/shapes. Manifest stays rtc:0, preview remains preview.

## Handoff
Fifth substantive implementation PR of this session (concurrent architecture #133 excluded). Final main must pass all existing CI/release-policy/review gates. Follow STATUS’s recovered service-first RTC roadmap and genuine exact-deployment/read/denial/revocation gates, with optional Hub/shared core. No production, spending, manual deploy or destructive acceptance.
