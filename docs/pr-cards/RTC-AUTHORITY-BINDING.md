# RTC-AUTHORITY-BINDING — preserve scratch identity across a read

Status: MERGED (#151; all seven exact-head application/release checks passed).
Baseline: main fe88d9402d0be903ef7c17004bc866ffb3507c93 (#150).
Risk: read-only RTC response authorization identity. No migrations, provider
writes, new credential or pass defaults, account access, production or spending.

## Drift check A
| Assumption | Inspected #150 implementation | Corrective behavior/test |
| --- | --- | --- |
| A valid final pass implies identical grant | Final authenticate checks validity and scratch status but does not compare original account/client | Bind final send to initial client ID and scratch account |
| A valid next batch authorization shares the first read's identity | Subsequent reads accept any newly valid owner for the same bearer | Check original principal before each later batch child |
| Denial of drift needs an extra rate unit | authenticate charges rate after existing account/guard checks | Refuse drift before any subsequent rate charge |

## Implementation and test
- In `src/rtc/http.js`, optionally bind authentication to the initial,
  server-derived `client_id` and `default_account`. Both must match
  after DB pass/account validation and before any additional rate charge.
- Final response rechecks the same initial principal without consuming rate.
  Each successful batch child retains the original initial principal, and
  existing per-read shared rate/argument/area gates are unchanged.
- Controlled fake-transport regressions cover a valid midflight transfer to
  another verified scratch owner and a changed client ID, both immediately
  after a read and between batch calls. No old payload is released or additional
  rate charged for refused later read.
- Verify all seven exact-head Actions jobs, reviews, final-main jobs.
  Absence of local shell means CI is the execution evidence, not this card.

## Independent acceptance and owner gates
No real service-issued pass has been supplied in this session. Exact reviewed
Vercel production source currently #146, not #151. Custom OAuth MCP, Hub
direct/relay/Sandbox, RTC1, separately authorized real revocation and
run-owned destructive cleanup remain UNVERIFIED. Do not relabel a standard
GitHub connector or public manifest as custom-service acceptance. Maintain
standalone MCP, rtc:0, production OFF, zero autonomous spending, scratch-only
permissions and scheduled-only release.
