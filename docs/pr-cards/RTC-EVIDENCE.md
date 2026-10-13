# RTC-EVIDENCE — truthful deployed identity and restricted HTTP discovery

Status: implementation slice; full/deployed connected acceptance remains IN_PROGRESS.
Baseline: #134 `fcc1993687043a9dbad33903968e2886444ac7c7`, architecture recovery #133.
Scope: approved existing RTC compatibility and safe service-owned integration evidence.

## Read only these
- AGENTS, SESSION-START, hosting policy
- src/rtc/contract.js, http.js, entry.js
- docs/audits/RTC-HUB-ADOPTION.md
- tests/unit/rtc-http.test.js, rtc-conformance.test.js

## Drift A
Public manifest listed the full standalone catalog but did not distinguish the much smaller HTTP pass scope or identify the running build. Consumers could not compare exact revision and actual available HTTP surface. No change to top-level standalone catalog semantics or RTC version.

## Implementation
- Share the existing exact read-only server/meta HTTP selector with subset discovery.
- Publish subset auth/modes/profile/areas/counts and unchanged no-write/no-production/zero-money restrictions.
- Publish canonical Vercel source SHA or null as explicitly unverified self-report. Never inspect arbitrary environment or return a credential.
- Authenticated whoami repeats safe identity and restrictions.
- Keep original independent MCP OAuth, canonical tools, dispatch, credentials/state/guards/results in this service.

## Demonstrated CI correction
#134 final-main db failed an existing rate fixture at 5879 >= 5900 ms. Preserve every threshold; request a fixed test clock for slot claims only, using PostgreSQL now() in a disposable transaction. Add exact before/after persisted timestamp equality on refused reservation and exact 6000 ms successful retry. Other expiry tests keep real time. Mandatory db CI verifies this; no blind infrastructure rerun.

## Acceptance
- Adversarial registry with writes, passthrough and missing hints produces identical evidence/dispatch allowlists.
- Invalid/absent/malformed environment values return no revision.
- Existing HTTP/auth/conformance tests and full check/unit/db/shapes pass.
- Production OFF, spending $0; no live pass, write, manual deployment or certification claimed.

## Next
After scheduled promotion compare self-report to provider deployment source evidence; then authorized owner-issued scoped read/denial/revocation through this custom service. Metadata alone is never authenticated acceptance.
