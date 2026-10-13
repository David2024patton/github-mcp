# RTC-REQUIRED-RETENTION — no successful shortened HTTPS read without its complete saved result

Status: IMPLEMENTED (target PR #152; exact-head CI/review pending).
Baseline: merged main aba3cf0c0ea2e18764f3a66a925430a49a75ec15 (#151).
Risk: RTC read result integrity. No migration, provider write, credential
change, production activation, deletion or spending.

## Drift check A
| Assumption | Inspected current behavior | Correction |
| --- | --- | --- |
| All shortened read results retain a handle | Canonical readReply catches putResult failure and returns a capped payload with kept_result.note | Restricted HTTPS refuses success if kept_result exists without valid handle |
| Only an oversize RTC HTTP wrapper needs storage | Underlying canonical read may already be truncated to under 8192 bytes | Check the canonical missing handle before final HTTP size calculation |
| Standalone MCP fallback must change too | It intentionally tells standalone clients about partial data | Change only RTC adapter; preserve canonical behavior |

## Acceptance and boundaries
- A canonical capped read with no retrievable handle returns sanitized
  HTTP 503 from the restricted pass-only tool and batch door.
- A successfully retained canonical result still reuses its original handle,
  without double-storing content or leaking a token.
- Fake-transport tests invoke the **real** canonical dispatcher, simulate
  storage failure and success and distinguish the HTTP behavior.
- Seven exact-head Actions jobs, review resolution, exact-final-main checks
  and permanent handoff required. No local shell was available here.
- RTC1, custom OAuth MCP, secure real scratch pass read/denial/revocation,
  Hub routes, actual run-owned cleanup and exact checked production
  deployment remain separate unverified gates. No manual release; rtc:0.
