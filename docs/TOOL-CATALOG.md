# Tool catalog

Every tool this server will have, by area — the product scope. The implementing model builds exactly these; anything
else goes in `docs/ROADMAP.md` and the PR report, and the universal tools (last section) reach the rest of GitHub's API
on day one. Counts are checked by `python3 scripts/count-catalog.py` (run by `npm run check` and CI since A-1, #1). When a
tool merges, its Card cell gains `built #<PR>`. Built so far: **119 tools** (`github_search_tools`, `github_describe_tool`, `github_call`, `github_batch`, `github_get_result`, `github_check_permissions`, `github_rate_status`, `github_where_is_setting`, `github_whoami`, `github_list_accounts`, `github_list_protected_resources`, `github_list_connections`, `github_recent_changes`, `github_enable_production`, `github_disable_production`, `github_set_spend_limit`, `github_set_default_account`, `github_revoke_connection`, `github_repo_list`, `github_repo_get`, `github_repo_find`, `github_repo_get_insights`, `github_repo_get_traffic`, `github_repo_list_activity`, `github_repo_get_custom_properties`, `github_repo_create`, `github_repo_create_from_template`, `github_repo_update_settings`, `github_repo_set_visibility`, `github_repo_set_default_branch`, `github_repo_rename`, `github_repo_set_archived`, `github_repo_transfer`, `github_repo_delete`, `github_repo_fork`, `github_repo_sync_fork`, `github_repo_set_custom_properties`, `github_repo_star`, `github_content_get`, `github_content_get_tree`, `github_content_get_archive_link`, `github_content_check_codeowners`, `github_commit_list`, `github_commit_get`, `github_commit_compare`, `github_commit_list_prs`, `github_git_get_ref`, `github_git_get_commit`, `github_content_put_file`, `github_content_delete_file`, `github_content_push_files`, `github_commit_comment`, `github_git_update_ref`, `github_branch_list`, `github_branch_get`, `github_branch_create`, `github_branch_rename`, `github_branch_delete`, `github_branch_merge`, `github_tag_list`, `github_tag_create`, `github_tag_delete`, `github_pr_list`, `github_pr_get`, `github_pr_get_diff`, `github_pr_list_files`, `github_pr_list_commits`, `github_review_list`, `github_review_list_threads`, `github_review_list_comments`, `github_review_create`, `github_review_submit`, `github_review_dismiss`, `github_review_reply`, `github_review_resolve_thread`, `github_review_request_reviewers`, `github_actions_list_workflows`, `github_actions_list_runs`, `github_actions_get_run`, `github_actions_get_job_log`, `github_actions_get_run_logs_summary`, `github_actions_list_pending_deployments`, `github_actions_set_workflow_enabled`, `github_actions_dispatch`, `github_actions_rerun`, `github_actions_cancel_run`, `github_actions_delete_run`, `github_actions_review_pending_deployment`, `github_check_get_ci_state`, `github_check_get_run`, `github_artifact_list`, `github_artifact_get_link`, `github_cache_list`, `github_check_create_run`, `github_check_update_run`, `github_status_create`, `github_artifact_delete`, `github_cache_delete`, `github_variable_list`, `github_secret_list`, `github_variable_set`, `github_variable_delete`, `github_pr_create`, `github_pr_update`, `github_pr_close`, `github_pr_set_draft`, `github_pr_update_branch`, `github_pr_merge`, `github_pr_merge_async`, `github_pr_set_auto_merge`, `github_secret_set`, `github_secret_delete`, `github_secret_set_repo_access`, `github_pr_list_stacks`, `github_pr_stack_manage`, `github_env_list`, `github_env_get`, `github_env_save`, `github_env_delete`) — the registry (`src/tools/index.js`) exists
and holds the two A-5 tools, the B-3 protected-list reader the two B-2 production-switch tools and the B-4 spend-limit tool. Since B-5 every result of these tools is shaped (`src/tools/util.js`) and failures are explained by `src/tools/errors.js`. Since B-6 a connection sees only the tools its profile allows (`tools/list` and by-name calls). Every write tool below will be built with `defineGithubWrite` (B-1, #16, `src/tools/define-github-write.js`) and pass the nine write-contract checks (`test/helpers/write-contract.js`); the two B-2 tools are the first (`src/tools/server.js`).

**Safety** (enforced by the trust layer, `docs/designs/BATCH-B.md`):
`—` reads only · `P` preview available (`dryRun`), no confirmation needed for ordinary targets · `C` always needs
`confirm: true` · `D` destructive or irreversible · `Prod` always production (needs a production connection and
`confirm`) · `Prod*` production only when the target is (default branch, protected branch, production environment, org
scope — B-2 decides) · `A` widens someone's access (always `confirm`; `A*` only for some uses, e.g. making something
public) · `M` notifies people (`confirm` when it reaches anyone outside Chris's own accounts; B-4) · `$` raises spend
(dollar estimate, `confirm`, refused while the account's spend limit is $0; `$*` only for some uses).

**Origin:** `C` the old toolkit had it (`robinsons-toolkit-mcp` namespace `github`; port to the new conventions, never
copy code) · `F` the old toolkit had it **with a bug or a missing guard**, fixed here (`docs/audits/2026-10-10-research.md`
§2) · `N` new.
**Cred** (which credential GitHub accepts for it, `docs/designs/BATCH-A.md` A5): `I` the GitHub App installation token
(default) · `U` Chris's user authorization of the App (personal settings and a few user-only operations) · `I,U` either ·
`K` the optional classic token (notifications only) · `—` no GitHub call.
**Audience** (contract §3): `B` builder · `O` owner/administrator · `Op` day-to-day operator.
**Profile:** `R` read_only and up · `E` everyday and up · `F` full only.

**Names:** every tool starts with the service prefix `github_` (`github_<area>_<verb>`; DECISIONS 2026-10-10), so it
never collides with the Vercel or Neon server's tools in the same chat; `scripts/count-catalog.py` enforces it.


## Server about itself (`github_*`) — 21

Card(s): A-5, B-2, B-3, B-8, C-1, C-2, R-1, O-1, X-1. Meta-tools, connection and safety settings. Compact listing (`docs/designs/BATCH-C.md`) starts here.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_whoami` | Which GitHub accounts this connection can use, mode (PREVIEW/PRODUCTION), profile, credential types present, API version, rate budget left, spend limit | — | N | I | B,O,Op | R | A-5 built #13 |
| `github_list_accounts` | Accounts (orgs and users) connected to the server: app installation, repo selection, user authorization, optional classic token, production on/off | — | N | I | O | R | A-5 built #13 |
| `github_set_default_account` | Which account a tool uses when `owner` is omitted | P | N | — | O | F | B-8 built #23 |
| `github_check_permissions` | Compare each installation's granted permissions with what every tool area needs; names the exact permission to add | — | N | — | O,B | R | B-8 built #24 |
| `github_rate_status` | Primary and secondary rate-limit state per account (from `GET /rate_limit` `resources.*` and recent response headers) | — | F | I | Op,B | R | B-8 built #24 |
| `github_list_connections` | Connector logins and passes: account scope, mode, profile, expiry, last used | — | N | — | O | R | B-8 built #23 |
| `github_revoke_connection` | Switch a connection or pass off at once | C | N | — | O | F | B-8 built #23 |
| `github_enable_production` | Allow production-mode connections for one account (needs the passphrase on the setup page as a second step) | C·A | N | — | O | F | B-2 built #18 |
| `github_disable_production` | Stop production-mode connections for one account immediately | C | N | — | O | F | B-2 built #18 |
| `github_set_spend_limit` | Lower the monthly spend this server may add for an account (raising it is only possible on the setup page) | C | N | — | O | F | B-8 built #20 |
| `github_list_protected_resources` | The repositories and installations this server refuses to change (its own repo, other Robinson servers) and at what level | — | N | — | O,B | R | B-3 built #19 |
| `github_recent_changes` | What was changed through this server (filter by repo, tool, account, date; previews hidden unless asked) | — | N | — | O,Op | R | B-8 built #23 |
| `github_undo_change` | Undo one change-log entry when it has a clean opposite; says plainly when it does not | C | N | I | Op | E | X-1 |
| `github_search_tools` | Find tools by plain words (and audience); one line each with safety marks | — | N | — | B,O,Op | R | C-2 built #26 |
| `github_describe_tool` | Full instructions and arguments for one tool | — | N | — | B,O,Op | R | C-2 built #26 |
| `github_call` | Run any tool in the profile by name, through the same guards | as the tool | N | — | B,O,Op | R | C-2 built #26 |
| `github_batch` | Up to 10 read calls in one round trip | — | N | — | B,O,Op | R | C-2 built #26 |
| `github_get_result` | Page through a big result kept on the server behind a handle | — | N | — | B,O,Op | R | C-1 built #25 |
| `github_create_pass` | Make a short-lived pass for the HTTPS API and Robinson's Toolkit (shown once on the setup page; preview, read-only, 24 h, $0 by default) | C | N | — | O | F | R-1 |
| `github_where_is_setting` | Structured steps (link, numbered actions, expected result, read-back check) for any GitHub setting with no API | — | N | — | O | R | B-8 built #24 |
| `github_admin_overview` | One-call owner review of an account: org/profile, plan, members and 2FA, security features, apps and tokens, usage and budgets, anything needing attention | — | N | I,U | O | R | O-1 |

## Repositories (`github_repo_*`) — 20

Card(s): D-1.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_repo_list` | Repositories of an org or user (type, visibility, sort, archived filter) | — | C | I | B,Op | R | D-1 built #27 |
| `github_repo_get` | One repo: visibility, default branch, merge settings, protection summary, security features, custom properties | — | C | I | B,O,Op | R | D-1 built #27 |
| `github_repo_find` | Plain-words search across Chris's accounts (name, topic, description) | — | N | I | Op | R | D-1 built #27 |
| `github_repo_create` | New repository in an org or user account (private by default; public is access-widening) | P·A* | F | I | B | E | D-1 built #29 |
| `github_repo_create_from_template` | New repository from a template repository | P·A* | C | I | B | E | D-1 built #29 |
| `github_repo_update_settings` | Description, homepage, topics, features (issues, wiki, projects), merge options, delete-branch-on-merge, auto-merge allowed | P·Prod* | F | I | B,O | F | D-1 built #29 |
| `github_repo_set_visibility` | Make a repository private or public (public = access-widening) | C·Prod·A* | F | I | O | F | D-1 built #29 |
| `github_repo_set_default_branch` | Change the default branch | C·Prod | F | I | O | F | D-1 built #29 |
| `github_repo_rename` | Rename a repository (GitHub keeps a redirect) | C·Prod | N | I | O | F | D-1 built #29 |
| `github_repo_set_archived` | Archive (read-only) or unarchive a repository | C·Prod | F | I | O | F | D-1 built #29 |
| `github_repo_transfer` | Transfer a repository to another owner | C·D·Prod·A | F | U | O | F | D-1 built #29 |
| `github_repo_delete` | Delete a repository (cannot be undone by this server) | C·D·Prod | F | I | O | F | D-1 built #29 |
| `github_repo_get_insights` | Languages, contributors, community profile and commit activity in one summary (retries GitHub's 202 'computing' answer) | — | C | I | Op | R | D-1 built #27 |
| `github_repo_get_traffic` | Views, clones, top referrers and paths for the last 14 days | — | C | I | Op,O | R | D-1 built #27 |
| `github_repo_list_activity` | Pushes, force pushes, branch creations and deletions, merges — who and when | — | C | I | Op,O | R | D-1 built #27 |
| `github_repo_fork` | Fork a repository into an account | P | C | U | B | E | D-1 built #29 |
| `github_repo_sync_fork` | Bring a fork's branch up to date with its upstream | P·Prod* | C | I | B | E | D-1 built #29 |
| `github_repo_get_custom_properties` | Custom property values on a repository | — | N | I | O | R | D-1 built #27 |
| `github_repo_set_custom_properties` | Set custom property values on a repository | P | N | I | O | F | D-1 built #29 |
| `github_repo_star` | Star or unstar a repository as Chris | P | C | U | Op | E | D-1 built #29 |

## Files, commits and git data (`github_content_*, github_commit_*, github_git_*`) — 15

Card(s): D-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_content_get` | A file's text (size-capped, handle for big files) or a directory listing, at any ref | — | F | I | B,Op | R | D-2 built #30 |
| `github_content_get_tree` | Whole-repo file list at a ref (recursive tree), filtered by a glob | — | C | I | B | R | D-2 built #30 |
| `github_content_put_file` | Create or update one file with a commit (checks the file's current version first) | P·Prod* | F | I | B | E | D-2 built #32 |
| `github_content_delete_file` | Delete one file with a commit | C·Prod* | C | I | B | E | D-2 built #32 |
| `github_content_push_files` | Commit several file changes at once on a branch, signed by GitHub (GraphQL `createCommitOnBranch`, expected head checked) | P·Prod* | N | I | B | E | D-2 built #32 |
| `github_content_get_archive_link` | Short-lived download link for a tarball or zipball of a ref | — | N | I | B | R | D-2 built #30 |
| `github_content_check_codeowners` | Problems GitHub found in a CODEOWNERS file on a branch (bad lines, unknown users or teams), in plain words | — | C | I | B,O | R | D-2 built #30 |
| `github_commit_list` | Commits on a branch or path, by author or date | — | C | I | B,Op | R | D-2 built #30 |
| `github_commit_get` | One commit: message, author, files changed with stats (patch capped) | — | C | I | B,Op | R | D-2 built #30 |
| `github_commit_compare` | Compare two refs: ahead/behind, commits, files (patches capped) | — | C | I | B,Op | R | D-2 built #30 |
| `github_commit_list_prs` | Pull requests that contain a commit | — | C | I | B,Op | R | D-2 built #30 |
| `github_commit_comment` | Comment on a commit (optionally on a line) | P·M | C | I | B | E | D-2 built #32 |
| `github_git_get_ref` | One ref (branch or tag pointer) and its target | — | C | I | B | R | D-2 built #30 |
| `github_git_update_ref` | Move a branch to another commit; force moves need `force: true` and are refused on production branches without a production connection | C·Prod* | F | I | B | F | D-2 built #32 |
| `github_git_get_commit` | Low-level commit object (tree, parents, verification) | — | C | I | B | R | D-2 built #30 |

## Branches and tags (`github_branch_*, github_tag_*`) — 9

Card(s): D-3.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_branch_list` | Branches with head SHA, protected flag and whether rules apply | — | F | I | B,Op | R | D-3 built #33 |
| `github_branch_get` | One branch: head commit, protection, and every ruleset rule that applies (`GET /rules/branches/{branch}`) | — | C | I | B,Op | R | D-3 built #33 |
| `github_branch_create` | New branch from any ref (default: the repo's default branch, not a guessed `main`) | P | F | I | B | E | D-3 built #33 |
| `github_branch_rename` | Rename a branch (open PRs are retargeted by GitHub) | C·Prod* | C | I | B | F | D-3 built #33 |
| `github_branch_delete` | Delete a branch (default branch always refused; protected needs production) | C·D·Prod* | F | I | B | E | D-3 built #33 |
| `github_branch_merge` | Merge one branch into another directly (no PR) | P·Prod* | C | I | B | E | D-3 built #33 |
| `github_tag_list` | Tags with their commits | — | C | I | B,Op | R | D-3 built #33 |
| `github_tag_create` | Create a lightweight or annotated tag | C·Prod | N | I | B | F | D-3 built #33 |
| `github_tag_delete` | Delete a tag | C·D·Prod | N | I | B | F | D-3 built #33 |

## Pull requests (`github_pr_*`) — 15

Card(s): E-1, E-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_pr_list` | Pull requests by state, base, head branch, author, label | — | C | I | B,Op | R | E-1 (built #35) |
| `github_pr_get` | One PR: state, draft, head SHA, mergeable, review decision, required checks at head, unresolved thread count | — | C | I | B,Op | R | E-1 (built #35) |
| `github_pr_get_diff` | The PR's diff (capped; handle for the rest) | — | C | I | B | R | E-1 (built #35) |
| `github_pr_list_files` | Files changed with additions/deletions (patches capped) | — | C | I | B | R | E-1 (built #35) |
| `github_pr_list_commits` | Commits in the PR | — | C | I | B | R | E-1 (built #35) |
| `github_pr_create` | Open a pull request (draft option; body footer records the tool and run) | P·M | C | I | B | E | E-1 (built #40) |
| `github_pr_update` | Title, body, base branch (retarget), state open/closed | P·M | F | I | B | E | E-1 (built #40) |
| `github_pr_set_draft` | Convert to draft or mark ready for review (GraphQL) | P | N | I | B | E | E-1 (built #40) |
| `github_pr_close` | Close without merging (head branch kept) | C | C | I | B | E | E-1 (built #40) |
| `github_pr_update_branch` | Bring the PR branch up to date with its base (expected head SHA checked) | P | C | I | B | E | E-1 (built #40) |
| `github_pr_merge` | Merge at an exact head SHA; refuses unless every required check is green at that SHA; production base needs a production connection | C·Prod* | F | I | B | E | E-2 (built #46) |
| `github_pr_merge_async` | Same as `github_pr_merge` using GitHub's asynchronous merge (returns merged / failed / pending); `bypass_rules` is always refused | C·Prod* | N | I | B | E | E-2 (built #46) |
| `github_pr_set_auto_merge` | Turn auto-merge on (merges when GitHub's rules pass) or off (GraphQL) | C·Prod* | N | I | B | E | E-2 (built #46) |
| `github_pr_list_stacks` | Pull request stacks in a repo, or one stack with its PRs in order | — | N | I | B | R | E-2 built #48 |
| `github_pr_stack_manage` | Create a stack, add PRs to it, or unstack PRs | P | N | I | B | E | E-2 built #48 |

## Reviews and review threads (`github_review_*`) — 9

Card(s): E-3.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_review_list` | Reviews on a PR (state, author, submitted at) | — | C | I | B,Op | R | E-3 built #37 |
| `github_review_list_threads` | Review threads with resolved/outdated state, file and line, every comment (GraphQL) | — | N | I | B | R | E-3 built #37 |
| `github_review_list_comments` | Inline review comments (REST), filterable by file | — | C | I | B | R | E-3 built #37 |
| `github_review_create` | Start or submit a review: comment, approve or request changes, with inline comments | P·M | C | I | B | E | E-3 built #38 |
| `github_review_submit` | Submit a pending review | P·M | C | I | B | E | E-3 built #38 |
| `github_review_dismiss` | Dismiss a review with a message | C·M | C | I | B | F | E-3 built #38 |
| `github_review_reply` | Reply in a review thread | P·M | C | I | B | E | E-3 built #38 |
| `github_review_resolve_thread` | Resolve or unresolve a review thread (GraphQL) | P | N | I | B | E | E-3 built #38 |
| `github_review_request_reviewers` | Request or remove reviewers (users or teams) | P·M | C | I | B | E | E-3 built #38 |

## Issues (`github_issue_*`) — 15

Card(s): F-1.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_issue_list` | Issues by state, label, assignee, milestone, type (pull requests excluded by query, not by dropping rows) | — | F | I | B,Op | R | F-1 |
| `github_issue_get` | One issue with sub-issue and dependency summary | — | C | I | B,Op | R | F-1 |
| `github_issue_create` | New issue (labels, assignees, milestone, type) | P·M | C | I | B,Op | E | F-1 |
| `github_issue_update` | Title, body, state with reason, milestone, type | P | F | I | B,Op | E | F-1 |
| `github_issue_lock` | Lock or unlock conversation | P | C | I | Op | E | F-1 |
| `github_issue_list_comments` | Comments on an issue or PR | — | C | I | B,Op | R | F-1 |
| `github_issue_comment` | Comment on an issue or PR | P·M | C | I | B,Op | E | F-1 |
| `github_issue_edit_comment` | Edit a comment | P | C | I | B,Op | E | F-1 |
| `github_issue_list_timeline` | Everything that happened to an issue (events, references, cross-links) | — | C | I | Op | R | F-1 |
| `github_issue_set_labels` | Add, remove or replace labels on an issue or PR | P | F | I | B,Op | E | F-1 |
| `github_issue_set_assignees` | Add or remove assignees | P·M | C | I | Op | E | F-1 |
| `github_issue_set_sub_issue` | Add, remove or reorder a sub-issue | P | N | I | Op | E | F-1 |
| `github_issue_set_dependency` | Add or remove a 'blocked by' link | P | N | I | Op | E | F-1 |
| `github_issue_transfer` | Move an issue to another repository (GraphQL) | C | N | I | Op | F | F-1 |
| `github_issue_react` | Add or remove a reaction on an issue, comment or review comment | P | C | I | Op | E | F-1 |

## Labels and milestones (`github_label_*, github_milestone_*`) — 7

Card(s): F-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_label_list` | Labels in a repository | — | C | I | B,Op | R | F-2 |
| `github_label_save` | Create or update a label by name | P | C | I | B,Op | E | F-2 |
| `github_label_delete` | Delete a label (removes it from every issue) | C | C | I | Op | E | F-2 |
| `github_label_sync` | Make several repositories carry the same label set (preview lists every add/change; never deletes unless asked) | P | N | I | O,Op | F | F-2 |
| `github_milestone_list` | Milestones with progress | — | C | I | Op | R | F-2 |
| `github_milestone_save` | Create, update or close a milestone | P | C | I | Op | E | F-2 |
| `github_milestone_delete` | Delete a milestone | C | C | I | Op | E | F-2 |

## Discussions, projects and search (`github_discussion_*, github_project_*, github_search_*`) — 10

Card(s): F-3.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_discussion_list` | Discussions in a repository by category (GraphQL) | — | C | I | Op | R | F-3 |
| `github_discussion_get` | One discussion with its comments and answer (GraphQL) | — | C | I | Op | R | F-3 |
| `github_discussion_create` | Start a discussion (GraphQL) | P·M | N | I | Op | E | F-3 |
| `github_discussion_comment` | Comment on a discussion or mark a comment as the answer (GraphQL) | P·M | N | I | Op | E | F-3 |
| `github_project_list` | Projects (v2) of an org or user | — | N | I,U | Op | R | F-3 |
| `github_project_get` | One project: fields, views, item counts | — | N | I,U | Op | R | F-3 |
| `github_project_list_items` | Items in a project with field values | — | N | I,U | Op | R | F-3 |
| `github_project_set_item` | Add an issue/PR to a project or set an item's field value | P | N | I,U | Op | E | F-3 |
| `github_project_remove_item` | Remove an item from a project | C | N | I,U | Op | E | F-3 |
| `github_search_github` | Search code, issues, pull requests, commits, repositories or users with GitHub's search syntax (type chosen by argument) | — | C | I | B,Op | R | F-3 |

## Actions: workflows, runs, jobs and logs (`github_actions_*`) — 12

Card(s): G-1.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_actions_list_workflows` | Workflows in a repository with state and file path | — | C | I | B,Op | R | G-1 built #39 |
| `github_actions_set_workflow_enabled` | Enable or disable a workflow | P·Prod* | C | I | B | F | G-1 built #41 |
| `github_actions_dispatch` | Start a workflow (`workflow_dispatch`) on a ref with inputs; returns the run (API 2026-03-10) | P·Prod* | F | I | B,Op | E | G-1 built #41 |
| `github_actions_list_runs` | Runs by workflow, branch, event, status, actor, head SHA | — | C | I | B,Op | R | G-1 built #39 |
| `github_actions_get_run` | One run: status, conclusion, jobs and steps, attempt, billable timing | — | C | I | B,Op | R | G-1 built #39 |
| `github_actions_get_job_log` | A job's log: failed steps first, tail lines, error lines; never a raw base64 dump | — | F | I | B,Op | R | G-1 built #39 |
| `github_actions_get_run_logs_summary` | Download a run's log archive server-side and return failing steps, error lines and annotations | — | F | I | B,Op | R | G-1 built #39 |
| `github_actions_rerun` | Re-run a whole run, only its failed jobs, or one job | P·Prod* | C | I | B,Op | E | G-1 built #41 |
| `github_actions_cancel_run` | Cancel a run (force-cancel needs confirm) | P | C | I | B,Op | E | G-1 built #41 |
| `github_actions_delete_run` | Delete a run, or only its logs | C·D | C | I | Op | F | G-1 built #41 |
| `github_actions_list_pending_deployments` | Runs waiting for an environment approval | — | N | I | Op | R | G-1 built #39 |
| `github_actions_review_pending_deployment` | Approve or reject a waiting deployment | C·Prod* | N | U | Op | F | G-1 built #41 |

## Checks, statuses, artifacts and caches (`github_check_*, github_status_*, github_artifact_*, github_cache_*`) — 10

Card(s): G-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_check_get_ci_state` | CI state at a commit or PR head: every check run and status, which are required by rules, overall green/red/pending | — | N | I | B,Op | R | G-2 built #42 |
| `github_check_get_run` | One check run with output summary and annotations | — | C | I | B | R | G-2 built #42 |
| `github_check_create_run` | Create a check run on a commit (GitHub App only) | P | C | I | B | E | G-2 built #43 |
| `github_check_update_run` | Update or complete a check run | P | C | I | B | E | G-2 built #43 |
| `github_status_create` | Set a commit status (pending/success/failure/error) with a context | P | C | I | B | E | G-2 built #43 |
| `github_artifact_list` | Artifacts of a run or repository with size and expiry | — | C | I | B | R | G-2 built #42 |
| `github_artifact_get_link` | Short-lived download link for an artifact (bytes never pass through chat) | — | F | I | B | R | G-2 built #42 |
| `github_artifact_delete` | Delete an artifact | C·D | C | I | Op | E | G-2 built #43 |
| `github_cache_list` | Actions caches and total cache usage for a repository | — | N | I | B,Op | R | G-2 built #42 |
| `github_cache_delete` | Delete caches by key or ID | C | N | I | B | E | G-2 built #43 |

## Secrets and variables (`github_secret_*, github_variable_*`) — 7

Card(s): G-3. Covers Actions, Dependabot, Codespaces and agent secrets at repository, environment and organization level. **Secret values never pass through a tool:** Chris types them on the setup page, or the server generates them.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_secret_list` | Secret names, kind, scope, last updated, which repos can use an org secret (never values) | — | F | I | B,O | R | G-3 built #44 |
| `github_secret_set` | Create or update a secret; the value is typed by Chris on the setup page (link returned) or generated by the server; encrypted with the scope's public key | C·Prod* | N | I | B,O | F | G-3 built #45 |
| `github_secret_delete` | Delete a secret | C·D·Prod* | C | I | B,O | F | G-3 built #45 |
| `github_secret_set_repo_access` | Choose which repositories may use an organization secret | C·A·Prod | N | I | O | F | G-3 built #45 |
| `github_variable_list` | Variables with values (variables are not secret) | — | C | I | B | R | G-3 built #44 |
| `github_variable_set` | Create or update a variable | P·Prod* | F | I | B | E | G-3 built #44 |
| `github_variable_delete` | Delete a variable | C·Prod* | C | I | B | E | G-3 built #44 |

## Environments and deployments (`github_env_*, github_deploy_*`) — 10

Card(s): G-4.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_env_list` | Environments with protection rules, branch policies and counts of secrets/variables | — | C | I | B,O | R | G-4 built #49 |
| `github_env_get` | One environment in full (reviewers, wait timer, branch and tag policies, custom rules) | — | C | I | B,O | R | G-4 built #49 |
| `github_env_save` | Create or update an environment, its protection rules and branch policies | C·Prod* | F | I | B,O | F | G-4 built #50 |
| `github_env_delete` | Delete an environment (its secrets and variables go with it) | C·D·Prod* | C | I | O | F | G-4 built #50 |
| `github_env_policy_create` | Add a custom branch/tag deployment pattern | C·A·Prod* | C | I | O | F | G-4 built #53 |
| `github_env_policy_update` | Rename an existing deployment branch/tag pattern | C·A·Prod* | C | I | O | F | G-4 built #53 |
| `github_env_policy_delete` | Remove a deployment branch/tag pattern | C·A·Prod* | C | I | O | F | G-4 built #53 |
| `github_deploy_list` | Deployments with their latest status, by environment and ref | — | C | I | B,Op | R | G-4 built #51 |
| `github_deploy_create` | Create a deployment for a ref and environment | C·Prod* | C | I | B | E | G-4 built #52 |
| `github_deploy_set_status` | Add a status to a deployment (in progress, success, failure, inactive) | P·Prod* | C | I | B | E | G-4 built #52 |

## Releases (`github_release_*`) — 7

Card(s): G-5.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_release_list` | Releases with tag, draft/prerelease flags and asset counts | — | C | I | B,Op | R | G-5 built #54 |
| `github_release_get` | One release by ID, tag or 'latest', with assets | — | C | I | B,Op | R | G-5 built #54 |
| `github_release_create` | Create a release (draft by default) with optional generated-notes preview; publishing creates the tag | C·Prod·M | F | I | B | F | G-5 built #55 |
| `github_release_update` | Edit notes, name, flags; publish a draft | C·Prod·M | C | I | B | F | G-5 built #55 |
| `github_release_delete` | Delete a release (Git tag preserved) | C·D·Prod | C | I | B | F | G-5 built #55 |
| `github_release_upload_asset` | Attach a file to a release from a public URL (downloaded server-side, size-capped; no bytes in chat) | P·Prod* | F | I | B | F | G-5 built #59 |
| `github_release_delete_asset` | Remove a file attached to a release (a wrong or outdated build); production when the release is published | C·D·Prod* | C | I | B | F | G-5 built #56 |

## Pages and packages (`github_pages_*, github_package_*`) — 7

Card(s): G-6.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_pages_get` | Pages site settings, custom domain, HTTPS state and the latest build | — | C | I | B,O | R | G-6 built #60 |
| `github_pages_save` | Turn on Pages or change source branch/path, custom domain, HTTPS | C·Prod·A* | C | I | B,O | F | G-6 built #61 |
| `github_pages_disable` | Turn off a Pages site | C·D·Prod | C | I | O | F | G-6 built #61 |
| `github_package_list` | Packages of an org or user with versions | — | C | I | B | R | G-6 built #60 |
| `github_package_delete_version` | Delete a package version (restorable for 30 days) | C·D·Prod | C | I | B | F | G-6 built #62 |
| `github_package_delete` | Delete a whole package with all its versions (restorable for 30 days; GitHub refuses public packages with over 5,000 downloads) | C·D·Prod | C | I | B | F | G-6 built #63 |
| `github_package_restore_version` | Restore a deleted package or package version (within 30 days) | C·Prod | C | I | B | F | G-6 built #64 |

## Developer tools (`github_dev_*`) — 15

Card(s): V-1 … V-5. The owner alone can enable an exact Organization as `is_scratch` through the authenticated setup page after live All-repositories App verification; no connection/tool argument can elevate this flag. Preview-only (contract §10): every `github_dev_*` tool refuses production targets before reading anything, records every object it creates in a run, and tags it `rtc_run=<runId>` (`docs/designs/BATCH-V.md`).

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_dev_list_scenarios` | Named scenarios github_dev_seed can build (e.g. repo-with-failing-ci, open-pr-with-review-threads, release-train) | — | N | — | B | R | V-1 built #68 |
| `github_dev_seed` | Build a scenario in the scratch account or on test branches: repos, branches, commits, PRs, issues, labels, workflow files; preview lists every object | P | N | I | B | E | V-1 built #70–#80; initial scratch SHA #102; exact marker #90; resume commit provenance #124 (six scratch scenarios; webhook-target pending V-4) |
| `github_dev_list_runs` | Connection-scoped runs, exact objects/intents, per-scenario type-checked progress and fail-closed cursor-paged journal cleanup previews (never remote acceptance or deletion) | — | N | — | B | R | V-1 #68; V-2 #93; truthful scenario and preview #123 |
<!-- #106: all-runs cleanup preview includes at-most-five run proposals; each still needs fresh verification and explicit per-run confirmation. -->
| `github_dev_create_scratch_repo` | Throwaway repository in the scratch account, tagged with the run | P | N | I | B | E | V-1 built #69; initial scratch SHA #102 |
| `github_dev_cleanup` | Clean confirmed run-owned scratch repositories, or exact unprotected standalone test PRs/branches; reject foreign scratch resources, enforce a single executable scenario's finite resource types/counts, then independently verify ownership before deletion; never delete host repositories | C | N | I | B | E | V-2 built #85–#90; two-way resource inventory #121; finite scenario limits #122; connected scratch acceptance pending |
| `github_dev_create_test_branch` | Branch `rtc/<run>/<name>` from any ref in an allowed repo (never production) | P | N | I | B | E | V-3 |
| `github_dev_open_test_pr` | Draft PR from a test branch, labelled with the run | P | N | I | B | E | V-3 |
| `github_dev_dispatch_and_wait` | Start a workflow on a test ref and wait up to 45 s; returns the run, or a handle to check later | P | N | I | B | E | V-3 |
| `github_dev_set_check_run` | Create or complete a check run on a run-created commit to simulate a passing/failing check | P | N | I | B | E | V-3 |
| `github_dev_create_test_webhook` | Webhook in a scratch repo pointing at an app under development (public HTTPS only; secret shown once on the setup page) | P | N | I | B | E | V-4 |
| `github_dev_create_forwarder` | Register an app-under-development URL and a signing secret (shown once) to replay GitHub deliveries into | P | N | — | B | E | V-4 |
| `github_dev_list_forwarders` | Forwarders with target and last use | — | N | — | B | R | V-4 |
| `github_dev_delete_forwarder` | Remove a forwarder | C | N | — | B | E | V-4 |
| `github_dev_forward_deliveries` | Send real past webhook deliveries to a forwarder with a valid `X-Hub-Signature-256`; reports each status code | P | N | I | B | E | V-4 |
| `github_dev_check_integration` | Is GitHub set up for an app being built (app permissions, webhook events, secrets present, workflows, rules)? Exact steps for anything missing | — | N | I | B | R | V-5 |

## Branch protection and rulesets (`github_protection_*, github_ruleset_*`) — 9

Card(s): H-1.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_protection_get` | Classic branch protection on a branch, in plain words | — | C | I | B,O | R | H-1 |
| `github_protection_set` | Change branch protection by reading it first and changing only what was asked (GitHub's PUT replaces everything) | C·Prod | F | I | O | F | H-1 |
| `github_protection_set_required_checks` | Add or remove required status checks, keeping the rest | C·Prod | F | I | B,O | F | H-1 |
| `github_protection_remove` | Remove branch protection | C·D·Prod | C | I | O | F | H-1 |
| `github_ruleset_list` | Rulesets of a repository or organization with enforcement and targets | — | C | I | B,O | R | H-1 |
| `github_ruleset_get` | One ruleset in plain words, optionally with its history | — | C | I | B,O | R | H-1 |
| `github_ruleset_save` | Create or update a ruleset (read-merge-write for updates) | C·Prod | F | I | O | F | H-1 |
| `github_ruleset_delete` | Delete a ruleset | C·D·Prod | C | I | O | F | H-1 |
| `github_ruleset_list_rule_suites` | Recent rule evaluations: which push or merge was blocked by which rule, and why | — | N | I | B,O | R | H-1 |

## Webhooks (`github_webhook_*`) — 8

Card(s): H-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_webhook_list` | Repository or organization webhooks (URL host, events, active; secrets never shown) | — | C | I | B,O | R | H-2 |
| `github_webhook_get` | One webhook's configuration and recent delivery health | — | C | I | B,O | R | H-2 |
| `github_webhook_save` | Create or update a webhook; a new signing secret is generated and shown once on the setup page | C·Prod | F | I | B,O | F | H-2 |
| `github_webhook_delete` | Delete a webhook | C·D·Prod | C | I | O | F | H-2 |
| `github_webhook_list_deliveries` | Recent deliveries (status, event, duration), or one delivery's request/response (payload capped) | — | N | I | B,Op | R | H-2 |
| `github_webhook_redeliver` | Redeliver one past delivery | C·Prod* | N | I | B,Op | E | H-2 |
| `github_webhook_ping` | Send a ping (or a test push event) to a webhook | P | C | I | B | E | H-2 |
| `github_webhook_rotate_secret` | Replace a webhook's signing secret (new one shown once on the setup page) | C·Prod | N | I | O | F | H-2 |

## Collaborators and deploy keys (`github_collab_*, github_deploykey_*`) — 7

Card(s): H-3.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_collab_list` | Collaborators with permission and how they got it, plus pending invitations | — | C | I | O,Op | R | H-3 |
| `github_collab_add` | Invite a collaborator or change their permission | C·A·M | F | I | O | F | H-3 |
| `github_collab_remove` | Remove a collaborator | C | C | I | O | F | H-3 |
| `github_collab_manage_invitation` | Change or cancel a pending repository invitation | C·A* | C | I | O | F | H-3 |
| `github_deploykey_list` | Deploy keys with read-only/write flag and last use | — | C | I | O | R | H-3 |
| `github_deploykey_add` | Add a deploy key (public key only; write access is access-widening and production) | C·A·Prod* | F | I | O | F | H-3 |
| `github_deploykey_delete` | Remove a deploy key | C | C | I | O | F | H-3 |

## Security features and alerts; Actions settings (`github_security_*, github_actions_*settings`) — 9

Card(s): H-4.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_security_get_settings` | Repository security features: secret scanning, push protection, Dependabot alerts/updates, code security, private vulnerability reporting | — | F | I | O,B | R | H-4 |
| `github_security_set_feature` | Turn a security feature on or off (paid features on private repositories raise spend) | C·Prod·$* | F | I | O | F | H-4 |
| `github_security_list_alerts` | Dependabot, code scanning or secret scanning alerts for a repo or org (kind chosen by argument) | — | C | I | O,B,Op | R | H-4 |
| `github_security_get_alert` | One alert in plain words (secret scanning: the secret itself is never returned) | — | F | I | O,B | R | H-4 |
| `github_security_update_alert` | Dismiss, resolve or reopen an alert with a reason | P | C | I | O,B | E | H-4 |
| `github_security_list_advisories` | Repository security advisories, or global advisories by package | — | C | I | O,B | R | H-4 |
| `github_security_compare_dependencies` | Dependencies added, removed or changed between two commits or branches (a PR), with known vulnerabilities and licences | — | N | I | B,O | R | H-4 |
| `github_actions_get_settings` | Repository Actions settings: allowed actions, default token permissions, fork PR approval, retention | — | N | I | O,B | R | H-4 |
| `github_actions_set_settings` | Change repository Actions settings | C·Prod | N | I | O | F | H-4 |

## Owner: organization and members (`github_org_*`) — 12

Card(s): O-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_org_get` | Organization profile, plan, seats, settings (default permission, who may create repos/pages/forks, 2FA requirement state) | — | C | I | O | R | O-2 |
| `github_org_update_settings` | Change organization profile and member privileges (each field previewed; widening privileges is access-widening) | C·Prod·A* | N | I | O | F | O-2 |
| `github_org_list_members` | Members with role and 2FA state; outside collaborators on request | — | C | I | O | R | O-2 |
| `github_org_invite_member` | Invite someone by username or email with a role and teams | C·A·M | N | I | O | F | O-2 |
| `github_org_list_invitations` | Pending and failed invitations | — | N | I | O | R | O-2 |
| `github_org_cancel_invitation` | Cancel a pending invitation | C·M | N | I | O | F | O-2 |
| `github_org_set_member_role` | Make a member an owner or a member | C·A* | N | I | O | F | O-2 |
| `github_org_remove_member` | Remove a member (they lose access to private repositories) | C·D | N | I | O | F | O-2 |
| `github_org_set_outside_collaborator` | Convert a member to outside collaborator, or remove an outside collaborator | C | N | I | O | F | O-2 |
| `github_org_set_blocked` | Block or unblock a user for the organization; list blocked users | P | N | I | O | F | O-2 |
| `github_org_custom_properties` | Read or define the organization's custom properties (schema) | P | N | I | O | F | O-2 |
| `github_org_set_immutable_releases` | Require immutable releases for all or selected repositories | C·Prod | N | I | O | F | O-2 |

## Owner: teams and roles (`github_team_*, github_role_*`) — 9

Card(s): O-3.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_team_list` | Teams with privacy, parent and member counts | — | C | I | O | R | O-3 |
| `github_team_get` | One team: members and roles, repositories and permissions | — | C | I | O | R | O-3 |
| `github_team_save` | Create or update a team (name, description, privacy, parent) | P | C | I | O | F | O-3 |
| `github_team_delete` | Delete a team | C·D | C | I | O | F | O-3 |
| `github_team_set_member` | Add a member, change member/maintainer role, or remove | C·A*·M | C | I | O | F | O-3 |
| `github_team_set_repo_access` | Give, change or remove a team's access to a repository | C·A* | C | I | O | F | O-3 |
| `github_role_list` | Organization roles and custom repository roles (where the plan has them), with who holds each | — | N | I | O | R | O-3 |
| `github_role_assign` | Give a user or team an organization role | C·A | N | I | O | F | O-3 |
| `github_role_remove` | Take an organization role away from a user or team | C | N | I | O | F | O-3 |

## Owner: billing, budgets, Copilot and Codespaces (`github_billing_*, github_copilot_*, github_codespace_*`) — 13

Card(s): O-4. Spend guard (`docs/designs/BATCH-B.md` B-4): `$` tools show a dollar estimate from `src/github/prices.js` (dated, sourced), always need `confirm`, and are refused while the account's spend limit is $0.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_billing_get_usage` | Usage and cost for an org or user by product (Actions, Packages, Codespaces, Copilot, LFS) and period, in dollars; premium requests on request | — | N | I,U | O | R | O-4 |
| `github_billing_list_budgets` | Organization budgets with amount, spent so far and whether usage stops at the limit | — | N | I | O | R | O-4 |
| `github_billing_save_budget` | Create or change a budget (raising or removing a limit raises spend) | C·$* | N | I | O | F | O-4 |
| `github_billing_delete_budget` | Delete a budget (removes a spending cap) | C·$ | N | I | O | F | O-4 |
| `github_billing_list_marketplace` | Marketplace apps Chris pays for (plan, price, next billing date); buying is guided only | — | N | U | O | R | O-4 |
| `github_copilot_get_billing` | Copilot plan, seat counts and seat assignments with last activity | — | C | I | O | R | O-4 |
| `github_copilot_add_seats` | Give users or teams Copilot seats (about $19 per seat per month, prorated) | C·$·A | F | I | O | F | O-4 |
| `github_copilot_remove_seats` | Remove Copilot seats (effective at the end of the billing cycle) | C | C | I | O | F | O-4 |
| `github_codespace_list` | Codespaces of the user or org with machine, state and who pays | — | C | I,U | O,B | R | O-4 |
| `github_codespace_create` | Create a codespace for a repo and branch (hourly compute plus storage) | C·$ | C | U | B | F | O-4 |
| `github_codespace_set_state` | Start (billed) or stop (saves money) a codespace | P·$* | C | U | B | E | O-4 |
| `github_codespace_delete` | Delete a codespace (unpushed work is lost) | C·D | C | U | B | F | O-4 |
| `github_codespace_set_org_access` | Choose who may use codespaces at the organization's expense | C·$·A | N | I | O | F | O-4 |

## Owner: apps and fine-grained tokens (`github_app_*, github_tokenpolicy_*`) — 7

Card(s): O-5.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_app_list_installations` | GitHub Apps installed on an org or on Chris's account, with permissions and repo selection | — | C | I,U | O | R | O-5 |
| `github_app_get_installation` | One installation: permissions, events, selected repositories, suspended state | — | C | I | O | R | O-5 |
| `github_app_set_installation_repos` | Add or remove a repository from an app installation | C·A* | N | U | O | F | O-5 |
| `github_tokenpolicy_list_requests` | Pending requests from fine-grained tokens to access the organization | — | N | I | O | R | O-5 |
| `github_tokenpolicy_review_request` | Approve or deny a fine-grained token's access request | C·A* | N | I | O | F | O-5 |
| `github_tokenpolicy_list_tokens` | Fine-grained tokens that can reach the organization, with owner, repositories and expiry | — | N | I | O | R | O-5 |
| `github_tokenpolicy_revoke_access` | Revoke a fine-grained token's access to the organization | C | N | I | O | F | O-5 |

## Owner: personal account (`github_account_*`) — 9

Card(s): O-6. Needs Chris's user authorization (`U`); installation tokens cannot reach personal settings.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_account_get` | Chris's profile, plan, organizations, emails (primary/verified/visibility) and two-factor state | — | C | U | O | R | O-6 |
| `github_account_update_profile` | Name, bio, company, blog, location, hireable, social handle | P | N | U | O | F | O-6 |
| `github_account_manage_email` | Add or remove an email address, or set primary email visibility | C·M* | N | U | O | F | O-6 |
| `github_account_list_keys` | SSH authentication keys, SSH signing keys and GPG keys (fingerprints only) | — | N | U | O | R | O-6 |
| `github_account_add_key` | Add an SSH, signing or GPG public key | C·A | N | U | O | F | O-6 |
| `github_account_delete_key` | Delete an SSH, signing or GPG key | C | N | U | O | F | O-6 |
| `github_account_set_blocked` | Block or unblock a user; list blocked users | P | N | U | O | F | O-6 |
| `github_account_list_invitations` | Repository invitations waiting for Chris | — | N | U | O | R | O-6 |
| `github_account_respond_invitation` | Accept or decline a repository invitation | C·A* | N | U | O | F | O-6 |

## Owner: notifications and gists (`github_notify_*, github_gist_*`) — 7

Card(s): O-7. Notifications need the optional classic token (`K`, `notifications` scope only — GitHub offers no other token for them; IN-11).

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_notify_list` | Unread (or all) notifications, by repository and reason | — | C | K | Op | R | O-7 |
| `github_notify_mark` | Mark one thread, a repository or everything as read or done | P | C | K | Op | E | O-7 |
| `github_notify_set_subscription` | Watch, ignore or unsubscribe from a thread or repository | P | C | K | Op | E | O-7 |
| `github_gist_list` | Chris's gists | — | C | U | B | R | O-7 |
| `github_gist_get` | One gist's files (size-capped) | — | C | U | B | R | O-7 |
| `github_gist_save` | Create or update a gist (public gists are access-widening) | P·A* | C | U | B | E | O-7 |
| `github_gist_delete` | Delete a gist | C·D | C | U | B | F | O-7 |

## Owner and administration: guided settings (`github_admin_*`) — 3

Card(s): O-1. Every GitHub settings page is in the dashboard map (`src/data/dashboard-map.js`); settings with no API return structured steps from `github_where_is_setting` (contract §11).

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_admin_list_guided_settings` | Every setting with no API, by page, with its current value when GitHub lets it be read | — | N | — | O | R | O-1 |
| `github_admin_check_setting` | Read back one setting after Chris (or a browser agent) changed it; never reports a guided setting done without a read-back or Chris saying so | — | N | I,U | O | R | O-1 |
| `github_admin_review_security` | Security review of an org or the personal account: 2FA, SSO (plan-dependent), token policies, apps, deploy keys with write, push protection coverage, outside collaborators | — | N | I,U | O | R | O-1 |

## Project profiles (`github_profile_*`) — 3

Card(s): P-1 … P-3. Optional (`docs/designs/BATCH-P.md`). The readiness and setup workflows are listed under Workflows.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_profile_list` | Project profiles the server knows (Appliance Desk, the Robinson servers, drafts) | — | N | — | B,O | R | P-1 |
| `github_profile_get` | One profile: repos, production branches and environments, required checks, workflows with write access, owned settings | — | N | — | B,O | R | P-1 |
| `github_profile_draft` | Turn what an agent found in a codebase (workflows, branches, environments, required checks) into a draft profile and APP-NEEDS text | — | N | — | B | R | P-3 |

## Workflows (`github_workflow_*`) — 17

Card(s): P-2, P-3, W-1 … W-7. Whole jobs in one call, answered in plain English with `structuredContent` (`docs/designs/BATCH-W.md`).

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_workflow_pr_status` | Everything about a PR in one answer: CI at head (required vs optional), mergeable, review decision, unresolved threads, stack position, next action | — | N | I | B,Op | R | W-1 |
| `github_workflow_open_pr` | Push nothing; open a PR from an existing branch with a plain description, labels and draft choice; returns the CI state so far | P·M | N | I | B | E | W-1 |
| `github_workflow_merge_when_green` | Merge at the exact head SHA only when required checks are green there and no review thread is unresolved; otherwise says what is missing | C·Prod* | F | I | B | E | W-2 |
| `github_workflow_merge_stack` | Merge a stack bottom-up: retarget each PR to the default branch, require fresh green CI at its head, merge; stops at the first PR that is not ready | C·Prod* | N | I | B | E | W-2 |
| `github_workflow_review_threads` | Unresolved review threads with file context; after fixes, reply and resolve each one verified at the current head | P·M | N | I | B | E | W-3 |
| `github_workflow_ci_failure_summary` | Why CI failed: failed jobs and steps, error lines, annotations, likely cause, same failure on the default branch? | — | N | I | B,Op | R | W-4 |
| `github_workflow_rerun_failed_ci` | Re-run only failed jobs once; refuses a second automatic re-run of the same failure (two-strikes rule) | P | N | I | B,Op | E | W-4 |
| `github_workflow_repo_health` | Protection and rules, CI pass rate, open PRs and staleness, security alerts, secret scanning/push protection, Actions settings | — | F | I | O,Op | R | W-5 |
| `github_workflow_security_review` | Open alerts across an org or account by severity, features off, push protection bypasses | — | F | I | O | R | W-5 |
| `github_workflow_access_review` | Who can reach what: members, outside collaborators, teams, deploy keys, apps, fine-grained tokens; flags anything unusual | — | N | I | O | R | W-5 |
| `github_workflow_release` | Cut a release from a tag or branch head with generated notes; draft first, publish with confirm | C·Prod·M | F | I | B | F | W-6 |
| `github_workflow_cleanup_branches` | Branches whose PR merged or closed (merge-commit and squash both detected), never default/protected/profile branches; preview then confirm | C | F | I | B,Op | E | W-6 |
| `github_workflow_new_repo` | Create a repository the standard way: default branch, ruleset requiring `ci`, secret scanning and push protection, merge commits only, delete branch on merge | C·A* | N | I | B,O | F | W-7 |
| `github_workflow_find` | Find anything from plain words: repo, PR, issue, run, release, commit | — | N | I | Op | R | W-7 |
| `github_workflow_weekly_digest` | Last 7 days across accounts: merged PRs, CI failure rate, open alerts, Actions/Copilot spend, pending invitations | — | N | I,U | O,Op | R | W-7 |
| `github_workflow_app_readiness` | Is GitHub set up for a profiled project (or an inline spec)? Each row done / fixed with confirm / needs you (steps) / needs a decision | P | N | I | B,O | R | P-2 |
| `github_workflow_project_setup` | Set up GitHub for a new project from a short description: repo, rules, environments, labels, security features; idempotent | C·A* | N | I | B,O | F | P-3 |

## Everything else on GitHub: the universal tools (`github_api_*, github_graphql_*`) — 6

Card(s): U-1, U-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_api_search` | Find REST operations by plain words: method, path, summary, and whether it reads, writes, is production, widens access, notifies people or spends | — | N | — | B,O,Op | R | U-1 |
| `github_api_describe` | Parameters for one operation, trimmed, from GitHub's own description at the pinned version | — | N | — | B,O,Op | R | U-1 |
| `github_api_read` | Any GET operation, with the same summaries, `fields`, size cap and handles as every other read | — | N | I,U | B,O,Op | R | U-1 |
| `github_api_write` | Any POST/PUT/PATCH/DELETE operation through the full safety layer | C (always) | N | I,U | B,O,Op | F | U-1 |
| `github_graphql_read` | Any GraphQL query, validated against GitHub's published schema; cost estimated before sending | — | N | I,U | B,O,Op | R | U-2 |
| `github_graphql_write` | Any GraphQL mutation, validated against the schema, through the full safety layer | C (always) | N | I,U | B,O,Op | F | U-2 |

How `github_api_write` and `github_graphql_write` stay safe (`docs/designs/BATCH-U.md`):

- **Always `confirm: true`**, `dryRun` supported; the preview names the operation in plain words, the exact
  parameters, and the object as it is now when the path names one.
- **Only what GitHub describes.** Every request is checked against the vendored OpenAPI description (REST) or the
  vendored schema (GraphQL) at the pinned version; unknown operations, parameters or fields are refused in words.
- **Classification table** (`src/github/operation-classes.js`): production, access-widening, notifies-people and spend
  marks for every operation, seeded from GitHub's own `x-github.triggersNotification` flags and the guard rules of
  B-2/B-4. **An unlisted operation that creates, deletes, transfers, invites, enables, assigns seats or changes
  settings is treated as production + access-widening until classified** — the safe default.
- **Hand-built tools win**: if a hand-built tool covers the operation, the universal tool refuses and names it.
- **Never** `bypass_rules`, never a secret value in a request (secret endpoints are refused; use `github_secret_set`), never
  a raw credential in a result.
- Same production guard, self-protection, profile ownership, change log, read-back (`confirmed: null` when nothing
  can be read back), passes need `allow_writes`, `full` profile only.

## Things GitHub has no API for

Handled by `github_where_is_setting` with structured steps and, where GitHub lets the value be read, a read-back
(`github_admin_check_setting`); never faked: requiring two-factor authentication for an organization; SAML single sign-on
(Enterprise Cloud); changing the plan or buying seats for the plan; buying Marketplace apps; personal password, passkeys
and recovery codes; creating a GitHub App or OAuth app by hand (the setup page uses the manifest flow instead);
OAuth app access policy; fine-grained token policy for the organization; Copilot policies at the personal level;
notification email routing; the personal security log; Sponsors; deleting the organization or the account; transferring
an organization; scheduled reminders; interaction limits beyond 6 months. The full page-by-page map is built in O-1.

## Totals

**Totals:** 308 tools: 302 hand-built + 6 universal (`github_api_*`, `github_graphql_*`), plus guided settings for every
dashboard-only owner setting. By profile (lowest profile that has the tool): read_only 133, everyday adds 81
(everyday lists 214), full adds 94 (full lists 308). In compact mode (`docs/designs/BATCH-C.md`) an agent
loads only about 25 tools up front (meta-tools, whoami, universal search, workflows) and reaches the rest through
`github_search_tools` / `github_call`.

| Section | Tools |
| --- | --- |
| Server about itself | 21 |
| Repositories | 20 |
| Files, commits and git data | 15 |
| Branches and tags | 9 |
| Pull requests | 15 |
| Reviews and review threads | 9 |
| Issues | 15 |
| Labels and milestones | 7 |
| Discussions, projects and search | 10 |
| Actions: workflows, runs, jobs and logs | 12 |
| Checks, statuses, artifacts and caches | 10 |
| Secrets and variables | 7 |
| Environments and deployments | 10 |
| Releases | 7 |
| Pages and packages | 7 |
| Developer tools | 15 |
| Branch protection and rulesets | 9 |
| Webhooks | 8 |
| Collaborators and deploy keys | 7 |
| Security features and alerts; Actions settings | 9 |
| Owner: organization and members | 12 |
| Owner: teams and roles | 9 |
| Owner: billing, budgets, Copilot and Codespaces | 13 |
| Owner: apps and fine-grained tokens | 7 |
| Owner: personal account | 9 |
| Owner: notifications and gists | 7 |
| Owner and administration: guided settings | 3 |
| Project profiles | 3 |
| Workflows | 17 |
| Everything else on GitHub: the universal tools | 6 |
| **Total** | **308** |

<!-- #108: experimental RTC HTTPS reader bridges only server/meta read tools using existing guarded dispatch; RTC 1 certification is not claimed. -->

<!-- #110: RTC pass-issued server/meta reads have persistent immutable no-writes / $0 scopes; large result handle is top-level for Hub SDK. Full RTC 1 remains incomplete. -->
