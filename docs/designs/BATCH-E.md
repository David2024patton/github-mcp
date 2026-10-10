# Design — Batch E: Pull requests, merges, stacks and reviews

Status: **DRAFT — awaiting Chris's approval (IN-00)**. Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` →
Batch E. Cards E-1 … E-3. Depends on Batch D. Tool list: `docs/TOOL-CATALOG.md` sections Pull requests; Reviews and
review threads.

This is the batch Chris's own build process runs on every day (AGENTS "Verify, push, review, merge" in every Robinson
repo and Appliance Desk): open PR → CI at the exact head → address review threads → merge at the expected head SHA with
merge commits → stacks merge bottom-up after retargeting to `main`.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| E1 | `PUT /repos/{o}/{r}/pulls/{n}/merge` takes `sha`, `merge_method`; `PUT …/merge-async` takes `sha`, `merge_method`, `merge_action`, `bypass_rules` and `GET …/merge-async/{uuid}` returns the result | `node scripts/openapi-find.mjs "merge a pull request"` |
| E2 | PR stacks: `GET/POST /repos/{o}/{r}/stacks`, `GET …/stacks/{stack_number}`, `POST …/add`, `POST …/unstack` | `node scripts/openapi-find.mjs "pull request stack"` |
| E3 | GraphQL `reviewThreads` (with `isResolved`, `isOutdated`, `path`, `line`, `comments`), `resolveReviewThread`, `unresolveReviewThread`, `enablePullRequestAutoMerge`, `disablePullRequestAutoMerge`, `markPullRequestReadyForReview`, `convertPullRequestToDraft`, `addPullRequestReviewThreadReply` | `node scripts/graphql-find.mjs <name>` each |
| E4 | `merge_commit_sha` is absent from PR objects at 2026-03-10 (research §1.1) | read the `pull-request` schema |
| E5 | Required checks for a branch can be read from rules (`required_status_checks` rule) and classic protection (`…/protection/required_status_checks`) | `node scripts/openapi-find.mjs "required status checks"` |

## 1. Decisions

**E1. "Required checks green at the exact head" is computed by the server**, in one helper
(`src/github/ci-state.js`, shared with `github_check_get_ci_state` in G-2): the required contexts are the union of the base
branch's ruleset `required_status_checks` rules and classic protection's required checks; each is matched against the
head SHA's check runs (latest per name, by app where the rule names one) and commit statuses; result per context:
`success` / `failure` / `pending` / `missing`. Overall green only when every required context is `success` (or
`neutral`/`skipped` where GitHub counts those as passing).

**E2. `github_pr_merge` merges only at an exact head and only when green.** Arguments: `expectedHeadSha` (required), `method`
(default `merge` — merge commits, Chris's rule), `title`/`message`. `plan` re-reads the PR: head ≠ expected → refused
("new commits arrived; evidence is stale"); not green per E1 → refused listing each non-green check; draft → refused;
mergeable false → refused with GitHub's reason. Then GitHub's own merge with `sha` = expected (GitHub rejects if the head
moved in between). Read-back: PR `merged: true`, base branch head = merge response `sha`. There is no "merge anyway"
argument; GitHub's rules still apply on top.

**E3. `github_pr_merge_async`** is the same contract over `merge-async` with `merge_action: 'direct_merge'`; returns `merged`,
`failed` (GitHub's message) or `pending` (the uuid; `github_pr_get` reports the result later — no polling loop).
**`bypass_rules` is never sent**, by any tool, including `github_api_write` (B-4/U).

**E4. Retargeting before merging a stack.** `github_pr_update` with a new `base` previews which commits the PR will then contain
(`github_commit_compare`). `github_workflow_merge_stack` (W-2) uses it; E-2 builds only the primitives.

**E5. Review threads are first-class.** `github_review_list_threads` returns, per thread: id, resolved, outdated, path, line
range, the latest comment and author (with `untrusted` marking), and a link. `github_review_resolve_thread` resolves only after
re-reading the thread (already resolved → `confirmed: true`, no write). `github_review_reply` uses
`addPullRequestReviewThreadReply`.

**E6. PR creation is idempotent and labelled.** `github_pr_create`: if an open PR already exists for the same head and base, it is
returned (`replayed: true`) instead of failing with 422; the body gets a one-line footer
`<!-- rmcp tool=github_pr_create run=<runId?> -->` so Batch V cleanup and the change log can find it. Drafts are supported.

**E7. Reviews by the App.** A review submitted with an installation token appears as the App's bot. The App cannot
approve PRs it opened itself (GitHub rule); the tool says so instead of failing obscurely.

**E8. Message guard applies** (B-4): requesting reviewers who are outsiders, mentioning outsiders, and any PR or review
in a repository outside Chris's accounts need `confirm`.

## 3. Operations per tool

| Tool | Operation(s) |
|---|---|
| `github_pr_list`, `github_pr_get` | `GET /repos/{o}/{r}/pulls`, `GET …/pulls/{n}`; GraphQL `pullRequest { reviewDecision, reviewThreads(first:100){ totalCount nodes { isResolved } } }`; E1 helper |
| `github_pr_get_diff`, `github_pr_list_files`, `github_pr_list_commits` | `GET …/pulls/{n}` (diff media type), `GET …/pulls/{n}/files`, `GET …/pulls/{n}/commits` |
| `github_pr_create`, `github_pr_update`, `github_pr_close` | `POST /repos/{o}/{r}/pulls`, `PATCH …/pulls/{n}` |
| `github_pr_set_draft` | GraphQL `convertPullRequestToDraft` / `markPullRequestReadyForReview` |
| `github_pr_update_branch` | `PUT …/pulls/{n}/update-branch` (`expected_head_sha`) |
| `github_pr_merge` | `PUT …/pulls/{n}/merge` |
| `github_pr_merge_async` | `PUT …/pulls/{n}/merge-async`, `GET …/merge-async/{uuid}` |
| `github_pr_set_auto_merge` | GraphQL `enablePullRequestAutoMerge` / `disablePullRequestAutoMerge` |
| `github_pr_list_stacks`, `github_pr_stack_manage` | `GET/POST /repos/{o}/{r}/stacks`, `GET …/stacks/{stack_number}`, `POST …/add`, `POST …/unstack` |
| `github_review_list`, `github_review_create`, `github_review_submit`, `github_review_dismiss` | `GET/POST …/pulls/{n}/reviews`, `POST …/reviews/{id}/events`, `PUT …/reviews/{id}/dismissals` |
| `github_review_list_threads`, `github_review_resolve_thread`, `github_review_reply` | GraphQL `reviewThreads`, `resolveReviewThread`/`unresolveReviewThread`, `addPullRequestReviewThreadReply` |
| `github_review_list_comments` | `GET …/pulls/{n}/comments` |
| `github_review_request_reviewers` | `POST`/`DELETE …/pulls/{n}/requested_reviewers` |

## 4. Work units

### E-1 — Pull requests: read, create, update (M)
Tests: existing open PR returned on create; body footer present; retarget preview lists the commit change; draft toggle
via GraphQL validated against the schema; `untrusted` marking on bodies by outsiders.
### E-2 — Merge, auto-merge, stacks (M, medium effort)
Tests: merge refused when head moved, when a required check is pending/failed/missing (each), when draft; merged at the
exact SHA with `merge_method: merge` by default; `bypass_rules` never present in any recorded request (grep test over
the fake-GitHub log of the whole suite); production base on a preview connection refused; `pr-only` repo merge allowed
only with green checks; async `pending` recorded with uuid.
### E-3 — Reviews and threads (M)
Tests: thread list with resolved/outdated; resolve is a no-op when already resolved; reply targets the thread; outsider
reviewer request needs confirm; App cannot approve its own PR → plain message.

## 5. Stop-and-ask points

1. Any E0 row false: amend before that card.
2. GitHub's merge accepts a merge although the server's E1 helper says not green (or the reverse) on a real repository in
   the X-2 smoke test: record both readings; never relax E2 without an amendment.

## 6. Acceptance mapping

| PLAN Batch E line | Evidence |
|---|---|
| Merge only at exact head and only green | `tests/unit/pr-merge.test.js` |
| `bypass_rules` never sent | grep test over the fake-GitHub request log |
| Threads list/reply/resolve | `tests/unit/review-threads.test.js` (GraphQL validated) |

## Amendments

(Dated entries only.)
