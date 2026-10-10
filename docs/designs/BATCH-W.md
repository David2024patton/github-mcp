# Design — Batch W: Workflows in Chris's language

Status: **APPROVED** (Chris, 2026-10-10). Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` →
Batch W. Cards W-1 … W-7. Depends on Batches E, G, H, O and P. Tool list: `docs/TOOL-CATALOG.md` section Workflows.

Each workflow does a whole job server-side and answers in plain English, with `structuredContent` for agents (Batch C).
Read-only workflows are in `read_only`. Write workflows preview everything first and confirm before anything production,
access-widening or outsider-notifying happens. The flagship set is **the PR conveyor Chris's AI build process runs in
every repository**: open PR → CI at the exact head → address review threads → merge at the expected head SHA with merge
commits → stacks bottom-up after retargeting to `main`.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| W1 | `listAll`, the time-budget helper and the E-1 CI-state helper exist | `grep -n "export" src/github/client.js src/github/ci-state.js` |
| W2 | Every tool a workflow calls exists and passes its write-contract | `grep -n "<tool name>" src/tools/*.js` per workflow |

## 1. Decisions

**W1. Workflows call tools through the registry** (the wrapped handlers), never GitHub directly, so guards apply once and
consistently.

**W2. Time budget 50 s** (Vercel limit). Out of time → return what is done, with a note and how to continue. **No
workflow waits for CI in a loop**: waits are checkpoints (Chris's PLAYBOOK Step 10) — a workflow reports `pending` with
what it is waiting for, and the agent calls it again later.

**W3. Merge on green means exactly this** (`github_workflow_merge_when_green(pr, expectedHeadSha)`): head equals the expected SHA;
every required check green at that SHA (E1 helper); no unresolved review thread (or each listed with a disposition the
caller passes: `fixed` / `already fixed` / `superseded` / `answered`); not draft; mergeable; then `github_pr_merge` with merge
commits at that SHA. Anything missing → `done: false` with the exact list. A protected `pr-only` repository is merged only
this way (B-3).

**W4. Stacks merge bottom-up** (`github_workflow_merge_stack(prs[] | stack)`): for the lowest unmerged PR: retarget to the default
branch if needed (preview), then require **fresh** green CI at its head after the retarget — if the CI for that head has not
run or is pending, stop with `pending` and the run link; when green, merge; then move to the next. Never merges a PR into
its stack parent.

**W5. Review threads** (`github_workflow_review_threads(pr, dispositions?)`): without dispositions, lists unresolved threads with
file, line, the comment text (marked `untrusted` for outsiders) and the code around the line at the current head; with
dispositions, for each thread: verify the disposition at the current head (for `fixed`: the commented lines changed since
the comment), reply with the disposition text, resolve — all in one preview, one confirm.

**W6. CI failure summary** (`github_workflow_ci_failure_summary(pr | run | ref)`): failed jobs and steps, error lines, annotations,
whether the same job fails on the default branch's latest run ("is it mine?"), and a one-line likely cause.
`github_workflow_rerun_failed_ci` re-runs failed jobs once and refuses a second automatic rerun for the same head and job
("Same failure twice: reproduce locally" — Chris's two-strikes rule).

**W7. Branch cleanup is by PR state, not by guessing** (audit G16): a branch qualifies when its PR (by head ref) is merged or
closed and its head SHA equals the PR's head (no newer commits); never the default branch, protected branches, profile
production/owned refs, or branches with an open PR; pages through every branch.

**W8. Releases** (`github_workflow_release(repo, tag | 'next-patch|minor|major', from?)`): computes the next version from the
latest release when asked, generates notes since the previous tag, creates a **draft**, and publishes only with `confirm`
on a production connection.

**W9. New repository the standard way** (`github_workflow_new_repo`): private by default (public is access-widening), default
branch `main`, ruleset on the default branch requiring the named check (default `ci`) and blocking force pushes and
deletion, merge commits only, delete branch on merge, secret scanning and push protection (free on public repos; on
private repos only when the plan includes it — otherwise reported), Dependabot alerts on, Actions default token read-only,
fork-PR approval for all outside contributors, standard labels. Idempotent.

## 4. Work units (tests: normal case, empty case, more than one page, time budget exceeded)

| Card | Workflow(s) | Notes |
|---|---|---|
| W-1 (M) | `github_workflow_pr_status`, `github_workflow_open_pr` | status: CI required vs optional at head, mergeable, review decision, unresolved threads, stack position, next action in one sentence; open: existing PR returned, outsider mentions need confirm |
| W-2 (L, medium effort) | `github_workflow_merge_when_green`, `github_workflow_merge_stack` | each refusal reason has a test; stack: retarget → pending on fresh CI → merge; never merges into a stack parent |
| W-3 (M) | `github_workflow_review_threads` | dispositions verified at head; one preview, one confirm; outsider text marked untrusted |
| W-4 (M) | `github_workflow_ci_failure_summary`, `github_workflow_rerun_failed_ci` | "same failure on default branch" detection; second rerun refused |
| W-5 (M) | `github_workflow_repo_health`, `github_workflow_security_review`, `github_workflow_access_review` | read-only; plan-dependent items reported; no fixes unasked |
| W-6 (M) | `github_workflow_release`, `github_workflow_cleanup_branches` | release draft then publish; cleanup by PR state (G16 regression), never protected/owned refs |
| W-7 (M) | `github_workflow_new_repo`, `github_workflow_find`, `github_workflow_weekly_digest` | new repo idempotent; find across PRs/issues/runs/releases/commits; digest in dollars and Denver dates |

## 5. Stop-and-ask points

1. A workflow would need a tool that does not exist: build the tool in its area batch first (or use Batch U), never inline
   GitHub calls in a workflow.

## 6. Acceptance mapping

| PLAN Batch W line | Evidence |
|---|---|
| Merge on green exactly as W3; stacks as W4 | `tests/unit/workflow-merge.test.js` |
| Threads verified before resolving | `tests/unit/workflow-review-threads.test.js` |
| No waiting loops; time budget respected | per-workflow budget tests |
| All writes confirmed and logged | write-contract via `github_call` for each write workflow |

## Amendments

(Dated entries only.)
