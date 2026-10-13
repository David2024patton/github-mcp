# RTC-SECRET-OUTPUT — credential-safe tool replies and source scanning
Status: MERGED (#143); acceptance evidence in the PR checks/handoff.
Baseline inspected: 184c2b0dc9330a117c4f33c5cb98abb73b9ebb91 (#142).
Approved scope: B-5/B-7 and Batch R §2/§7 credential-output rules.
One risk area: credential output. No migration or new tool/permission; budget 100 production lines.

## Read only these
AGENTS, SESSION-START, AI-PR-READ-FIRST; src/tools/util.js and dispatch.js;
scripts/check-secrets.mjs; tests/unit/util.test.js and check-secrets.test.js.

## Drift check A
| Assumption | Observed at baseline | Correction / test |
| --- | --- | --- |
| All RTC credential shapes are scrubbed | util and dispatcher detect only provider tokens/PEM | Share redactor-backed detector; redact RTC passes and clipped fragments |
| Error replies use result redaction | TypeError and validation failures return text directly | Redact fail text, including clipped unknown-argument names |
| Source scanner rejects literal RTC passes | RULES lacks RTC pass | Exact wire shape, no FAKE exception; findings omit payload |
| A successful stored result is safe | Deep values/property names bypass field shaping | Whole-output detector before retention; withhold remaining credentials |

## Build contract
- `redact` handles embedded RTC values/fragments; `containsCredential` reuses that
  same detector for both final wire replies and values about to enter result storage.
- `createDispatch` preserves existing safety/profile/guard handling, scrubs all
  failure text, and refuses residual credentials in read or wrapper output.
- Scanner rejects exact recognisable RTC wire shapes even with FAKE text; tests
  generate ephemeral pass values in memory only. No real credential use.
- Regression uses real dispatcher for large retained reads, deeply nested values,
  credential-shaped object keys, handler/validation errors and passthrough output.
- Commands: focused rtc-secret-output/util/check-secrets/dispatch-shaping tests;
  npm run check; npm test; existing exact-head CI/release-policy and final-main gates.

## Done when
No supplied ephemeral RTC value reaches either wire copy, stored result or error.
Literal RTC source values produce payload-free scanner findings. Existing provider
redaction tests remain green. Full RTC1/OAuth/Hub/cleanup acceptance stays open.
