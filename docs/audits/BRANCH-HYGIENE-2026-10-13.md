# Branch hygiene audit — 2026-10-13

Owner requested a comprehensive audit and safe cleanup of forgotten work branches. At inspection the repo had **163 remote branches**: `main`, `live`, 151 branches for already-merged PRs, six for closed-unmerged PRs, and four branches without matching PRs. No open or draft PRs were present; final main/live and exact-main CI were aligned.

## Action

The guarded maintenance workflow cleans up branches under `ai/` **only if their exact tip is an ancestor of `main`**. It refuses if a PR is open for that branch, live API lookup fails, the commit history cannot be checked, a protected/non-AI ref is encountered, or the ref advanced since observation (remote push lease). It does not modify `main` or `live`. On the first workflow merge it audits the historical backlog; later merged PR closures clean their own source branches. See the Actions run summary for actual deletion counts—nothing is claimed deleted merely because this workflow was authored.

## Distinct historical branches with commits outside main

These are **preserved, not approved for automatic deletion**. The old PR closure or current replacement work suggests duplication, but history divergence alone cannot prove every change is safe to discard. Treat each as a tracked exception, compare the current implementation and remaining findings, and obtain confirmation before deleting anything that is not an ancestor of main.

| Branch | Tip at inspection | Origin or resolution context |
| --- | --- | --- |
| `ai/claude/a-5c-webhook-server-tools` | `dcd7d4d82cd5950e20f0497a4e002310082effdb` | #14 closed as duplicate of merged #13 |
| `ai/claude/b-1-write-layer` | `83b3c3781ef7c4a222d50f2eca1eb1130f7da7ba` | #17 closed as duplicate of merged #16; review findings warrant checking current guards |
| `ai/claude/d-1b-repo-writes` | `c57b886ea1bd1626cd61548a9547ade4241f5db7` | #28 closed as duplicate of merged #29 |
| `ai/claude/d-2b-code-writes` | `58545cb15a318991f6c37e0b3fec1b0904f4d463` | #31 closed without merge; review findings warrant checking current tools |
| `ai/claude/d-3-branches-tags` | `3109f58f164cb77dceb2c6969619fea584209dbf` | #34 closed as duplicate of merged #33; review findings warrant checking current guards |
| `ai/claude/e-1-pull-requests` | `253f0bb571d540c01ba79a5d272c25679bfc886f` | #36 closed without merge; review findings warrant checking current tools |
| `ai/claude/d-1-repositories` | `0aa65dc48739093eb68962328b50f2db4d47e2a4` | No PR; early D-1 source, compare with #27/#29 |
| `ai/codex/hosting-cost-handoff-2026-10-12` | `37b37c12c5e9c3bcc523c47c4e54a273c7071624` | No PR; policy contents already present in main; confirm old edits |
| `ai/gpt6/g-5a-releases-read` | `82d74d22d05e0e5560a865d146130443b6df06fb` | No PR; earlier G-5 read branch, compare with merged G-5 work |
| `ai/gpt6/g-5b-release-lifecycle` | `bb165d819fc49139553527763d9b1044e5a1cea6` | No PR; earlier G-5 write branch, compare with merged G-5 work |

Do not mistake abandoned history for a new work item: code must be compared against present `main`, and any real missing behavior should be completed via a new reviewed PR. No merge of stale branch snapshots into modern main.

## Actual verified first-pass cleanup and five additional divergent PR heads

The owner-authorized Actions run `38474294944` completed with **147 ancestor-confirmed deletions, zero refusals and 15 preserved distinct-history heads**. Main CI after PR #158 passed. Five additional branch heads belong to PRs marked merged by GitHub but have commits not in main's *ancestry* (for example, squash-style merges). They were correctly kept by the ancestry-only deletion rule:

| Preserved branch | Exact source head | Original merged PR |
| --- | --- | --- |
| `ai/gpt6/v2-ledger-collision` | `cd28ef9ca8d3cf25ea59971656171516056e3fe2` | #91 |
| `ai/gpt6/v2-intent-reconciliation` | `f3ba1b05b5a138533381f216d17e642b5737410f` | #92 |
| `ai/gpt6/v2-all-runs-inventory` | `e34551c619d19db8771a9fbb8f8e867f32fc9ca7` | #93 |
| `ai/gpt6/v2-run-inventory-cursors` | `f674e7369cb77f1bffd6f775fbf39b0525c42cf8` | #94 |
| `ai/gpt6/v2-scratch-foreign-artifacts` | `ddf655b0cb6aadcd2bd3868487e33e48904cc44d` | #95 |

### History-preserving resolution (source staged; Actions result required)

The owner requested **no stray historical work branches**. The next one-time workflow builds the **non-production** `archive/legacy-ai-2026-10-13` branch at a newly created commit whose file tree is *exactly* the current `main` tree, but whose parents explicitly include the exact 15 preserved heads. These parents preserve full historical objects without bringing obsolete sources into `main`. It refuses on changed/missing branch heads, new open PRs, unverifiable Git ancestry or archive-ref conflicts. Only *after* remote archival SHA is read back does it retire each original ref using an exact SHA lease. Never merge this archive branch into main; it is historical preservation, **not pending product code**. The permanent handoff must record exact verified archive/ref and deletion counts from the real Actions run, not claim them merely from this PR.

## Privileged maintenance review correction

After #158 merged, an independent review flagged privileged Actions version tags and a mismatched GitHub REST pin. The successor #159 pins checkout/setup-node to independently resolved full commit SHAs and uses the project's selected GitHub API date `2026-03-10` for these isolated Actions control-plane open-PR checks. These checks are not custom MCP provider calls, and they continue to fail closed if unavailable. Close the #158 review threads only after verified exact-head CI and the replacement changes merge; preserve PR history and review context.
