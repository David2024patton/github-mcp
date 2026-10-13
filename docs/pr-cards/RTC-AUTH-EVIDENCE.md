# RTC-AUTH-EVIDENCE — protected pass live read/denial/revocation probe
Status: PR #141 implementation; no actual external acceptance yet.
Baseline inspected: ebdb438990015ce69a45d268e20c76b0552d309f (#140 merged). No service schema, provider write or deployment.

## Read only these
AGENTS, SESSION-START, HOSTING-COST-POLICY; src/rtc/http.js,
src/rtc/scope.js, scripts/rtc-public-evidence.mjs, source #133 recovery,
docs/audits/RTC-HUB-ADOPTION.md, RTC-EVIDENCE card.

## Drift check A
| Assumption | Current evidence | Correction |
| --- | --- | --- |
| Existing `main` is deployed | Vercel linked production/live still points at #109 | Require independently observed exact production revision |
| Public preflight proves authenticated pass | No protected owner pass available to this agent | Require `RTC_AUTH_PASS` from protected env, after public preflight |
| Revocation can be checked during initial read | Owner revocation is a separate protected setup action | Separate `read` and `revoked` manual phases |
| Preview may be called TEST | No proven isolated TEST environment | Insist mode `preview`, scratch restriction, never relabel |

## Implementation and acceptance
- `npm run rtc:auth-evidence -- read` uses `RTC_PUBLIC_ORIGIN`,
  `RTC_PROVIDER_DEPLOYED_SHA` and protected `RTC_AUTH_PASS` env only.
  Pinned known project live origin only, redirects denied, 8-second bounded reads.
- Checks public exact-source SHA before sending the pass. Sends pass only to
  known same-origin RTC service read routes, never a write endpoint.
- Read phase: verify whoami preview/read_only, zero money/writes/prod,
  complete catalog (no unseen pages) restricted to server/meta, `github_enable_production` and
  `github_batch` metadata refused, actual harmless `github_whoami` POST read.
- Owner separately revokes through protected server setup; later run
  `npm run rtc:auth-evidence -- revoked` with same securely held pass,
  requiring pass_revoked HTTP 401. No revocation/writes within this script.
- Only report boolean checks; no pass, client ID, account name or raw body.
  Unit tests fake all HTTP; do not call live in CI. No OAuth MCP/Hub/cleanup
  proof claimed from this CLI. Preserve CI/review/exact-head, after-merge
  final-main tests and scheduled release without manual deployment.
