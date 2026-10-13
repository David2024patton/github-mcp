# RTC-PUBLIC-EVIDENCE — repeatable no-pass deployed read/denial preflight

Status: implementation PR #138, external authenticated acceptance IN_PROGRESS.
Baseline inspected: 6cf04ab16a3c012f9ba6076abc36c24b953ded52, #137 merged after all seven exact-head CI gates.
Risk: no secret, no provider mutation, no deployment triggering.

## Read only these
AGENTS, SESSION-START, hosting policy, architecture recovery #133;
src/rtc/contract.js, scope.js, openapi.js; package.json and RTC-EVIDENCE card.

## Drift check A
| Assumption | Main reality | Correction |
| --- | --- | --- |
| Main green means live current | Live branch and Vercel production metadata still #109 | Caller supplies independently confirmed provider deployment SHA |
| Manifest build SHA independently verified | Self-report explicitly unverified | Only compare, flag provider input not independently read in this process |
| No-pass 401 proves connected OAuth | Missing-bearer refusal proves no authenticated integration | Keep all acceptance booleans false and RTC0 identity unchanged |

## Implementation and acceptance
- Explicit CLI `npm run rtc:public-evidence` with `RTC_PUBLIC_ORIGIN` and
  `RTC_PROVIDER_DEPLOYED_SHA` (public, non-secret values; never pass an OAuth token).
- Validate HTTPS origin, no credentials/query/fragment/path; redirects rejected.
- GET public contract, OpenAPI, unauthenticated whoami 401; match self-reported
  exact SHA to separately acquired deployed provider revision. Redact remote failures.
- Unit tests fake every HTTP response; no CI call to live servers or Neon.
- CI check, units, shapes, db, release-policy, exact-head self-review and
  post-merge final-main checks mandatory. This is not custom pass/OAuth/Hub acceptance.
