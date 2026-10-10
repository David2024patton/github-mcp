# Design — Batch F: Issues, labels, milestones, discussions, projects and search

Status: **APPROVED** (Chris, 2026-10-10). Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` →
Batch F. Cards F-1 … F-3. Depends on Batch C. Tool list: `docs/TOOL-CATALOG.md` sections Issues; Labels and milestones;
Discussions, projects and search.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| F1 | Sub-issues (`…/issues/{n}/sub_issues`, `…/sub_issue`, `…/sub_issues/priority`) and dependencies (`…/dependencies/blocked_by`, `…/blocking`) exist | `node scripts/openapi-find.mjs "sub-issue"` / `"blocked by"` |
| F2 | Issue `type` can be set on create/update for repositories in an org with issue types | `node scripts/openapi-find.mjs "create an issue"` (request schema) |
| F3 | Discussions and `transferIssue` are GraphQL only; Projects v2 has REST (`/orgs/{org}/projectsV2/…`, `/users/{username}/projectsV2/…`) and GraphQL | `node scripts/graphql-find.mjs createDiscussion`; `node scripts/openapi-find.mjs "project item"` |
| F4 | User-owned Projects are not reachable with App installation tokens (research §4) | availability data; record the result in the PR |

## 1. Decisions

**F1. Listing issues never drops rows after paging** (audit G7). `github_issue_list` uses `GET /repos/{o}/{r}/issues` and, when
pull requests must be excluded, the search API with `is:issue` qualifiers (or refills the page until it holds the
requested count), and says which it used.

**F2. "Not given" differs from "empty"** (audit G18): every update tool's schema distinguishes an omitted field from an
empty string or empty list; clearing a body or all labels is possible and previewed.

**F3. Message guard** (B-4) for `github_issue_create`, `github_issue_comment`, `github_issue_set_assignees`, `github_discussion_*`: `confirm` when
an outsider is mentioned or assigned, or the repository is outside Chris's accounts. The preview shows the exact text.

**F4. Labels are synced, not sprayed.** `github_label_sync(repos[], labels[], deleteOthers=false)` previews per repository every
create and change; deleting labels not in the set happens only with `deleteOthers: true` and `confirm`.

**F5. Projects.** Organization projects use the installation token; user-owned projects need Chris's user authorization
(`U`) — if F4 holds and even the user token cannot reach them, `github_project_*` on a user owner says so and points at
`github_graphql_read` with the optional classic token (IN-11) instead of failing obscurely.

**F6. One search tool.** `github_search_github(type, query, sort?)` with `type` in `code | issues | prs | commits | repos | users`;
qualifiers are GitHub's own; results are summaries; code search results never include file bodies beyond the matched
fragments.

## 3. Operations per tool

| Tool | Operation(s) (under `/repos/{owner}/{repo}` unless stated) |
|---|---|
| `github_issue_list`, `github_issue_get` | `GET /issues`, `GET /issues/{n}`, `…/sub_issues`, `…/dependencies/blocked_by`, `…/blocking`; `GET /search/issues` |
| `github_issue_create`, `github_issue_update`, `github_issue_lock` | `POST /issues`, `PATCH /issues/{n}`, `PUT`/`DELETE /issues/{n}/lock` |
| `github_issue_list_comments`, `github_issue_comment`, `github_issue_edit_comment` | `GET`/`POST /issues/{n}/comments`, `PATCH /issues/comments/{id}` |
| `github_issue_list_timeline` | `GET /issues/{n}/timeline` |
| `github_issue_set_labels` | `POST`/`PUT /issues/{n}/labels`, `DELETE /issues/{n}/labels/{name}` |
| `github_issue_set_assignees` | `POST`/`DELETE /issues/{n}/assignees` |
| `github_issue_set_sub_issue` | `POST /issues/{n}/sub_issues`, `DELETE /issues/{n}/sub_issue`, `PATCH …/sub_issues/priority` |
| `github_issue_set_dependency` | `POST /issues/{n}/dependencies/blocked_by`, `DELETE …/blocked_by/{issue_id}` |
| `github_issue_transfer` | GraphQL `transferIssue` |
| `github_issue_react` | `POST`/`DELETE` reactions on issues, issue comments and review comments |
| `github_label_*` | `GET/POST /labels`, `PATCH/DELETE /labels/{name}` |
| `github_milestone_*` | `GET/POST /milestones`, `PATCH/DELETE /milestones/{n}` |
| `github_discussion_*` | GraphQL `repository.discussions`, `discussion`, `createDiscussion`, `addDiscussionComment`, `markDiscussionCommentAsAnswer` |
| `github_project_*` | `GET /orgs/{org}/projectsV2[/…]`, `/users/{username}/projectsV2[/…]`, `…/items`, `…/fields`; GraphQL `addProjectV2ItemById`, `updateProjectV2ItemFieldValue`, `deleteProjectV2Item` |
| `github_search_github` | `GET /search/{code\|issues\|commits\|repositories\|users}` |

## 4. Work units

### F-1 — Issues (M)
Tests: page never short because of PRs (audit G7 regression); omitted vs empty body; outsider mention needs confirm;
transfer validated against the GraphQL schema; sub-issue and dependency summaries in `github_issue_get`.
### F-2 — Labels and milestones (S)
Tests: `github_label_sync` preview per repo; no deletion without `deleteOthers` + confirm; label colour validated (6 hex).
### F-3 — Discussions, projects, search (M)
Tests: discussion create/comment validated against the schema; user-owned project path gives the plain explanation when
not reachable; search types map to the right endpoint; code search fragments capped.

## 5. Stop-and-ask points

1. Any F0 row false: amend before that card.

## 6. Acceptance mapping

| PLAN Batch F line | Evidence |
|---|---|
| Every listed tool built, catalog marked | TOOL-CATALOG Card column |
| Audit G7 and G18 cannot recur | F-1 regression tests |
| Message guard on outsider mentions | `tests/unit/issues.test.js` |

## Amendments

(Dated entries only.)
