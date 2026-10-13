# RESULT-OFFSET-METADATA — continue long text without blanking short fields

Status: MERGED (target #155, subject to exact-head review/CI/merge).
Baseline: PR #154 head d68d35bd4eaaaef0b3063358e8bff3141fa61f8f,
merged into main b36eb361936e46d18d8a6ef20b0579a3db479752.
Risk: C-1 saved-result text continuation semantics; no provider write,
migration, credential, access, production, spending or deployment change.

## Drift check A
| Assumption | Actual baseline | Correction and regression |
| --- | --- | --- |
| `offset` advances only long text needing a continuation | capText subtracts offset from every string recursively, even short IDs/titles/labels | Apply offset only when original string exceeds textLimit |
| Selected fields remain meaningful when resuming long text | A 4,000-character offset empties unrelated short metadata without a warning | Unit regression preserves ID, title, nested label, advances long body |
| Ordinary text caps change | Existing cap and log-lines logic is independent | Preserve existing long-text cap/offset behavior and tests |

## Acceptance
- `capText(...,{offset})` continues text whose original length exceeded
  the 4,000-character text budget, without shortening unrelated strings
  already small enough to return whole.
- Same helper powers original service `github_get_result` and RTC owned
  saved-result `offset` paging; no new tool behavior or permissions.
- Existing long text continuation, summary/fields, budgets, DB store,
  profile, revocation and all seven CI gates remain intact.
- External exact deployed custom MCP, original OAuth, Hub routes,
  service-issued RTC pass read/denial/revocation, RTC1 and cleanup
  remain separately UNVERIFIED. No manual deployment or new spend.

## Final-batch checkpoint
Reconcile PR #151–#155 source/CI evidence, reviews and exact main,
owner answers and status deferred re-entry. Post a permanent handoff on
#155, then provide compact automatically aligned continuation prompt.
Never certify deployed or connected acceptance from source tests.
