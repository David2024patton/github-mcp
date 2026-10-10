# Design — Batch X: Undo, real-account smoke test

Status: **APPROVED** (Chris, 2026-10-10). Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` →
Batch X. Cards X-1 … X-3.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| X1 | Change-log rows carry `inverse` for every tool with a clean opposite (catalog D7 and per-batch lists) | `grep -n "inverse" src/tools/*.js \| head -50` |
| X2 | A preview-mode connection with the `read_only` profile exists for the real accounts (IN-04/IN-05 done) | `github_whoami` |

## 1. Decisions

**X1. Undo** (`github_undo_change(change_id)`): runs the stored `inverse` with preview and confirm, through the same guards
(an undo of a production change needs a production connection). Clean opposites: labels, topics, descriptions and simple
settings ↔ previous values; archive ↔ unarchive; visibility ↔ previous; rename ↔ old name; default branch ↔ previous;
file put ↔ previous content by blob SHA, or delete if it did not exist (audit G17 fixed); branch create ↔ delete; branch
delete ↔ recreate at the recorded SHA (if nothing else took the name); tag create ↔ delete; star ↔ unstar; workflow
enable ↔ disable; issue/PR close ↔ reopen; thread resolve ↔ unresolve; assignees/labels ↔ previous sets; variable set ↔
previous value or delete; ruleset/protection change ↔ previous configuration (read-merge-write). **No inverse** (each says
what the right opposite action is): merges (revert PR), releases published (delete or edit), repository delete or transfer,
secret values (set again on the setup page), sent invitations (cancel), spend (seats removed bill to the end of the cycle),
deleted runs/logs/artifacts/packages beyond their restore window.

**X2. Smoke test** (`scripts/smoke-readonly.mjs`): every `writes: false` tool with minimal arguments on a **preview,
read_only** connection to each real account; never a write; report `docs/audits/smoke-<date>.md` with pass/fail per tool,
GitHub's request IDs for failures, and the plan-dependent items seen.


## 4. Work units

### X-1 — Undo (M)
Tests: each clean opposite; merge refuses with "open a revert PR"; undo of an undo; undo of a production change on a
preview connection refused.
### X-2 — Read-only smoke test (M)
Done when: report committed; every failure fixed or listed as a known gap with an owner card.
## 5. Stop-and-ask points

1. The smoke test finds a real repository in a state that needs a change (e.g. no protection on a default branch): report
   it to Chris; never change it in this batch.

## 6. Acceptance mapping

| PLAN Batch X line | Evidence |
|---|---|
| Undo for every clean opposite | `tests/unit/undo.test.js` |
| Read-only smoke report | `docs/audits/smoke-<date>.md` |
| Toolkit note delivered | X-3 PR |

## Amendments

(Dated entries only.)
