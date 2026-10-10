# Design — Batch D: Repositories, code, branches and tags

Status: **DRAFT — awaiting Chris's approval (IN-00)**. Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` →
Batch D. Cards D-1 … D-3. Depends on Batches B and C. Tool list: `docs/TOOL-CATALOG.md` sections Repositories; Files,
commits and git data; Branches and tags.

"Port" means: take the matching tool in `Robinson-AI-Systems/robinsons-toolkit-mcp` `handlers/github.js` only as a
reminder of which GitHub call it makes; rebuild with `src/github/client.js` route strings. Never copy its `gh()` wrapper.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| D1 | Every operation in §3 exists at 2026-03-10 with the parameters named | `node scripts/openapi-find.mjs "<summary words>"` per row |
| D2 | `createCommitOnBranch` takes `branch`, `expectedHeadOid`, `fileChanges { additions, deletions }`, `message` | `node scripts/graphql-find.mjs createCommitOnBranch` |
| D3 | `updateRefs` accepts `refUpdates: [{ name, afterOid, beforeOid, force }]` | `node scripts/graphql-find.mjs updateRefs` |
| D4 | The stats endpoints still answer `202` while computing | `node scripts/openapi-find.mjs "commit activity"` (responses) |

## 1. Decisions

**D1. The default branch is read, never assumed** (audit G4): `github_branch_create` defaults to the repository's
`default_branch`; nothing in this batch contains the literal `main` as a default.

**D2. Writes to files are optimistic-concurrency safe.** `github_content_put_file` reads the file's current blob SHA (or its
absence) in `plan` and sends it; a changed file between preview and confirm → refused with "the file changed since the
preview" and the new SHA. `github_content_push_files` uses `createCommitOnBranch` with `expectedHeadOid` = the head read in
`plan`; GitHub signs the commit (shows "Verified") and attributes it to the App's bot.

**D3. Ref moves are compare-and-swap.** `github_git_update_ref` uses GraphQL `updateRefs` with `beforeOid` = the value read in
`plan`. `force: true` (non-fast-forward) is production on any production branch (B-2) and is always refused on a
`pr-only` protected repository's default branch (B-3). The preview shows how many commits would be dropped
(`github_commit_compare`).

**D4. Big reads are bounded.** `github_content_get` returns text up to C4's cap with a handle; binary files return size and a
download link only. `github_content_get_tree` uses `GET /repos/{o}/{r}/git/trees/{sha}?recursive=1`, reports `truncated` and
filters by glob server-side. Diffs/patches in `github_commit_get`/`github_commit_compare` are capped per file.

**D5. Repository settings are split by risk.** `github_repo_update_settings` changes description, homepage, topics, feature
switches and merge options (production only for merge options, since they change how code ships);
visibility, default branch, rename, archive, transfer and delete are separate tools, each production, each with its own
preview ("Making Robinson-AI-Systems/x **public**: anyone can read the code and its history, including old commits").
`github_repo_delete` and `github_repo_transfer` are destructive; `github_repo_transfer` needs Chris's user authorization (`U`).

**D6. Old-name map.** D-1 adds `docs/TOOLKIT-NAME-MAP.md`: every one of the old toolkit's 311 `github_*` names → new
name, or "removed, because …" (required workflows: GitHub retired the API; logs/artifacts as base64: replaced by
summaries and links; etc., from the research audit §2).

**D7. Inverses** (for Batch X): topics/description/feature switches → previous values; archive ↔ unarchive; visibility ↔
previous visibility; rename ↔ old name; default branch ↔ previous; file put → previous content by blob SHA (or delete if
it did not exist — fixes audit G17); branch create ↔ delete; branch delete ↔ recreate at the recorded SHA; tag create ↔
delete; star ↔ unstar. Delete repo and transfer have no inverse.

## 3. Operations per tool (method + path at 2026-03-10)

| Tool | Operation(s) |
|---|---|
| `github_repo_list` | `GET /orgs/{org}/repos`, `GET /users/{username}/repos`, `GET /user/repos` (U) |
| `github_repo_get` | `GET /repos/{owner}/{repo}`; protection summary via `GET /repos/{o}/{r}/rules/branches/{default}` |
| `github_repo_find` | `GET /search/repositories` with `user:`/`org:` qualifiers for each allowed account |
| `github_repo_create` | `POST /orgs/{org}/repos`, `POST /user/repos` |
| `github_repo_create_from_template` | `POST /repos/{template_owner}/{template_repo}/generate` |
| `github_repo_update_settings` | `PATCH /repos/{owner}/{repo}`, `PUT /repos/{owner}/{repo}/topics` |
| `github_repo_set_visibility`, `github_repo_set_default_branch`, `github_repo_rename`, `github_repo_set_archived` | `PATCH /repos/{owner}/{repo}` (one field each) |
| `github_repo_transfer` | `POST /repos/{owner}/{repo}/transfer` (U) |
| `github_repo_delete` | `DELETE /repos/{owner}/{repo}` |
| `github_repo_get_insights` | `GET …/languages`, `GET …/contributors`, `GET …/community/profile`, `GET …/stats/commit_activity` |
| `github_repo_get_traffic` | `GET …/traffic/views`, `…/traffic/clones`, `…/traffic/popular/referrers`, `…/traffic/popular/paths` |
| `github_repo_list_activity` | `GET /repos/{owner}/{repo}/activity` |
| `github_repo_fork` | `POST /repos/{owner}/{repo}/forks` (U) |
| `github_repo_sync_fork` | `POST /repos/{owner}/{repo}/merge-upstream` |
| `github_repo_get_custom_properties`, `github_repo_set_custom_properties` | `GET`/`PATCH /repos/{owner}/{repo}/properties/values` |
| `github_repo_star` | `PUT`/`DELETE /user/starred/{owner}/{repo}` (U) |
| `github_content_get` | `GET /repos/{owner}/{repo}/contents/{path}` |
| `github_content_get_tree` | `GET /repos/{owner}/{repo}/git/trees/{tree_sha}` (`recursive=1`) |
| `github_content_put_file`, `github_content_delete_file` | `PUT`/`DELETE /repos/{owner}/{repo}/contents/{path}` |
| `github_content_push_files` | GraphQL `createCommitOnBranch` |
| `github_content_get_archive_link` | `GET /repos/{owner}/{repo}/tarball/{ref}` / `zipball/{ref}` (redirect URL only) |
| `github_commit_list`, `github_commit_get` | `GET /repos/{owner}/{repo}/commits`, `GET …/commits/{ref}` |
| `github_commit_compare` | `GET /repos/{owner}/{repo}/compare/{basehead}` |
| `github_commit_list_prs` | `GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls` |
| `github_commit_comment` | `POST /repos/{owner}/{repo}/commits/{commit_sha}/comments` |
| `github_git_get_ref`, `github_git_get_commit` | `GET /repos/{owner}/{repo}/git/ref/{ref}`, `GET …/git/commits/{commit_sha}` |
| `github_git_update_ref` | GraphQL `updateRefs` (`beforeOid`) |
| `github_branch_list`, `github_branch_get` | `GET /repos/{owner}/{repo}/branches`, `GET …/branches/{branch}`, `GET …/rules/branches/{branch}` |
| `github_branch_create` | `POST /repos/{owner}/{repo}/git/refs` |
| `github_branch_rename` | `POST /repos/{owner}/{repo}/branches/{branch}/rename` |
| `github_branch_delete` | `DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}` |
| `github_branch_merge` | `POST /repos/{owner}/{repo}/merges` |
| `github_tag_list` | `GET /repos/{owner}/{repo}/tags` |
| `github_tag_create` | `POST …/git/tags` (annotated) + `POST …/git/refs` |
| `github_tag_delete` | `DELETE /repos/{owner}/{repo}/git/refs/tags/{tag}` |

## 4. Work units (each: unit tests, write-contract for every write, request-shape test for every call, TOOL-CATALOG marks)

### D-1 — Repositories (M) — includes `docs/TOOLKIT-NAME-MAP.md`
Extra tests: visibility to public → access-widening confirm + production; `github_repo_delete` on a `pr-only` repo refused;
`github_repo_get_insights` retries a 202 at most 3 times within budget, then says "GitHub is still computing; try again".
### D-2 — Files, commits, git data (M, medium effort)
Extra tests: file changed between preview and confirm refused; `github_content_push_files` sends `expectedHeadOid`; force move
on the default branch refused on a preview connection; path with spaces/`#` encoded; update inverse restores previous
content (audit G17 regression).
### D-3 — Branches and tags (S)
Extra tests: default branch delete always refused; `github_branch_create` defaults to the real default branch (audit G4
regression); tag create is production; `github_branch_list` never sends an empty `protected=` (audit G9 regression).

## 5. Stop-and-ask points

1. Any D0 row false: amend before that card.
2. GitHub refuses a documented operation for App installation tokens: record GitHub's answer; mark the tool `U` in the
   catalog in the same PR, or drop it and point `github_where_is_setting`/Batch U at it.

## 6. Acceptance mapping

| PLAN Batch D line | Evidence |
|---|---|
| Every listed tool built, catalog marked | TOOL-CATALOG Card column `built #n` |
| No literal default branch; concurrency-safe file writes and ref moves | D-2/D-3 regression tests |
| Name map complete | `docs/TOOLKIT-NAME-MAP.md` has 311 rows (test counts them) |

## Amendments

(Dated entries only.)
