# RTC-RATE — independent two-process read-only rate evidence

Status: implementation slice; full RTC acceptance remains IN_PROGRESS.
Baseline: architecture recovery #133, main `a7f0637ede79aec49c6ec12341c9f28bdceb5cbe`.
Approved scope: existing RTC adoption / BATCH-R R3 / CONTRACT §9.

## Outcome
Prove the implemented RTC read-only rate and revocation guards hold across two real processes sharing one disposable PostgreSQL schema. No adoption of shared core, Hub dependency, provider write or genuine external acceptance.

## Read only these
- AGENTS.md, SESSION-START.md, hosting policy
- src/rtc/http.js, src/db.js RTC pass methods
- docs/audits/RTC-HUB-ADOPTION.md
- tests/db/rtc-passes.test.js, test/helpers/pg-neon-adapter.js

## Drift A
The old database rate test used one PostgreSQL client and one process. The pinned runner deliberately skips two-instance testing against this rtc:0 subset. Add independent actual process/connection coverage rather than asserting that skip passed.

## Implementation
- Child worker composes only the real restricted HTTP handler and existing static-query DB store.
- Parent opens an isolated localhost schema, creates randomized fake passes and starts two workers with narrowly scoped environment.
- Send overlapping HTTP whoami requests; verify exact allowed/denied totals, headers, mode, no bearer output and independent pass budget.
- Revoke in the shared DB and remove scratch designation; both processes must observe denial.
- Bounded startup/request/shutdown and child exit before schema teardown. No real remote DB allowed.

## Acceptance
- npm run check, existing unit/shapes/RTC tests pass.
- CI db proves separate PIDs/connections and exact shared limits.
- Full conformance, deployed exact revision, genuine authenticated TEST/OAuth/Hub/revocation remain separately unverified.

## Handoff
Continue current RTC compatibility; preserve service ownership and standalone functionality. Scope production OFF and spend $0. No manual deploy or expiry-based authorization.
