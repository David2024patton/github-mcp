# RESULT-OWN-KEYS — JSON projection cannot mutate object prototypes

Status: MERGED (#154; all seven exact-head application/release checks passed).
Baseline: #153 head 7ea9112d097f7ace9ffee2a86996e759490552dc,
subsequently merged as part of main f8a675886cb1d22f4fcc2a75e654cb12e08b8a48.
Risk: data integrity and own-property isolation in original service result
projection, also used by restricted RTC saved-result `fields`.

## Drift check A
| Assumed | Actual source behavior | Correction / verification |
| --- | --- | --- |
| Projected JSON keys are treated as data | merge() uses out[k] assignment, which invokes the inherited __proto__ setter | Define an enumerable writable own data property for each key |
| Merging can check inherited properties safely | `k in out` includes Object.prototype | Recurse only when Object.hasOwn(out,k) |
| Filtering untrusted paths is sufficient | pickPath correctly blocks inherited paths, but own reserved names were lost | Regression with parsed JSON own __proto__, constructor, nested paths |

## Acceptance
- `projectFields` retains selected own keys, including legitimate JSON
  `__proto__` and `constructor`, without changing the output prototype.
- Unrequested and inherited fields remain excluded; existing selected
  nested/list and companion paths unchanged.
- The original parsed value and Object.prototype are not modified.
- Run all seven exact-head jobs, review, exact-main checks and handoff.
  Only application/unit tests can verify this source fix; genuine custom
  service OAuth/pass/RTC1/Hub/revocation/cleanup and checked live version
  must be demonstrated separately. No deployment, credential or permission
  change, no production writes or spending, no shared-core requirement.
