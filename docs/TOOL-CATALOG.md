# Tool catalog

Every tool this server will have, by area — the product scope. The implementing model builds exactly these; anything
else goes in `docs/ROADMAP.md` and the PR report, and the universal tools (last section) reach the rest of GitHub's API
on day one. Counts are checked by `python3 docs/count-catalog.py` (run by `npm run check` once A-1 exists). When a
tool merges, its Card cell gains `built #<PR>`.

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

Toolkit name mapping: `github_list_pull_requests` → `pr_list`, and so on; D-1 adds `docs/TOOLKIT-NAME-MAP.md` mapping
all 311 old names to new names or to "removed, because …".

## Server about itself (`github_*`) — 21

Card(s): A-5, B-2, B-3, B-8, C-1, C-2, R-1, O-1, X-1. Meta-tools, connection and safety settings. Compact listing (`docs/designs/BATCH-C.md`) starts here.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `github_whoami` | Which GitHub accounts this connection can use, mode (PREVIEW/PRODUCTION), profile, credential types present, API version, rate budget left, spend limit | — | N | I | B,O,Op | R | A-5 |
| `github_list_accounts` | Accounts (orgs and users) connected to the server: app installation, repo selection, user authorization, optional classic token, production on/off | — | N | I | O | R | A-5 |
| `github_set_default_account` | Which account a tool uses when `owner` is omitted | P | N | — | O | F | B-8 |
| `github_check_permissions` | Compare each installation's granted permissions with what every tool area needs; names the exact permission to add | — | N | I | O,B | R | B-8 |
| `github_rate_status` | Primary and secondary rate-limit state per account (from `GET /rate_limit` `resources.*` and recent response headers) | — | F | I | Op,B | R | B-8 |
| `github_list_connections` | Connector logins and passes: account scope, mode, profile, expiry, last used | — | N | — | O | R | B-8 |
| `github_revoke_connection` | Switch a connection or pass off at once | C | N | — | O | F | B-8 |
| `github_enable_production` | Allow production-mode connections for one account (needs the passphrase on the setup page as a second step) | C | N | — | O | F | B-2 |
| `github_disable_production` | Stop production-mode connections for one account immediately | C | N | — | O | F | B-2 |
| `github_set_spend_limit` | Lower the monthly spend this server may add for an account (raising it is only possible on the setup page) | C | N | — | O | F | B-8 |
| `github_list_protected_resources` | The repositories and installations this server refuses to change (its own repo, other Robinson servers) and at what level | — | N | — | O,B | R | B-3 |
| `github_recent_changes` | What was changed through this server (filter by repo, tool, account, date; previews hidden unless asked) | — | N | — | O,Op | R | B-8 |
| `github_undo_change` | Undo one change-log entry when it has a clean opposite; says plainly when it does not | C | N | I | Op | E | X-1 |
| `github_search_tools` | Find tools by plain words (and audience); one line each with safety marks | — | N | — | B,O,Op | R | C-2 |
| `github_describe_tool` | Full instructions and arguments for one tool | — | N | — | B,O,Op | R | C-2 |
| `github_call` | Run any tool in the profile by name, through the same guards | as the tool | N | — | B,O,Op | R | C-2 |
| `github_batch` | Up to 10 read calls in one round trip | — | N | — | B,O,Op | R | C-2 |
| `github_get_result` | Page through a big result kept on the server behind a handle | — | N | — | B,O,Op | R | C-1 |
| `github_create_pass` | Make a short-lived pass for the HTTPS API and Robinson's Toolkit (shown once on the setup page; preview, read-only, 24 h, $0 by default) | C | N | — | O | F | R-1 |
| `github_where_is_setting` | Structured steps (link, numbered actions, expected result, read-back check) for any GitHub setting with no API | — | N | — | O | R | B-8 |
| `github_admin_overview` | One-call owner review of an account: org/profile, plan, members and 2FA, security features, apps and tokens, usage and budgets, anything needing attention | — | N | I,U | O | R | O-1 |

## Repositories (`repo_*`) — 20

Card(s): D-1.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `repo_list` | Repositories of an org or user (type, visibility, sort, archived filter) | — | C | I | B,Op | R | D-1 |
| `repo_get` | One repo: visibility, default branch, merge settings, protection summary, security features, custom properties | — | C | I | B,O,Op | R | D-1 |
| `repo_find` | Plain-words search across Chris's accounts (name, topic, description) | — | N | I | Op | R | D-1 |
| `repo_create` | New repository in an org or user account (private by default; public is access-widening) | P·A* | F | I | B | E | D-1 |
| `repo_create_from_template` | New repository from a template repository | P·A* | C | I | B | E | D-1 |
| `repo_update_settings` | Description, homepage, topics, features (issues, wiki, projects), merge options, delete-branch-on-merge, auto-merge allowed | P·Prod* | F | I | B,O | F | D-1 |
| `repo_set_visibility` | Make a repository private or public (public = access-widening) | C·Prod·A* | F | I | O | F | D-1 |
| `repo_set_default_branch` | Change the default branch | C·Prod | F | I | O | F | D-1 |
| `repo_rename` | Rename a repository (GitHub keeps a redirect) | C·Prod | N | I | O | F | D-1 |
| `repo_set_archived` | Archive (read-only) or unarchive a repository | C·Prod | F | I | O | F | D-1 |
| `repo_transfer` | Transfer a repository to another owner | C·D·Prod·A | F | U | O | F | D-1 |
| `repo_delete` | Delete a repository (cannot be undone by this server) | C·D·Prod | F | I | O | F | D-1 |
| `repo_get_insights` | Languages, contributors, community profile and commit activity in one summary (retries GitHub's 202 'computing' answer) | — | C | I | Op | R | D-1 |
| `repo_get_traffic` | Views, clones, top referrers and paths for the last 14 days | — | C | I | Op,O | R | D-1 |
| `repo_list_activity` | Pushes, force pushes, branch creations and deletions, merges — who and when | — | C | I | Op,O | R | D-1 |
| `repo_fork` | Fork a repository into an account | P | C | U | B | E | D-1 |
| `repo_sync_fork` | Bring a fork's branch up to date with its upstream | P·Prod* | C | I | B | E | D-1 |
| `repo_get_custom_properties` | Custom property values on a repository | — | N | I | O | R | D-1 |
| `repo_set_custom_properties` | Set custom property values on a repository | P | N | I | O | F | D-1 |
| `repo_star` | Star or unstar a repository as Chris | P | C | U | Op | E | D-1 |

## Files, commits and git data (`content_*, commit_*, git_*`) — 14

Card(s): D-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `content_get` | A file's text (size-capped, handle for big files) or a directory listing, at any ref | — | F | I | B,Op | R | D-2 |
| `content_get_tree` | Whole-repo file list at a ref (recursive tree), filtered by a glob | — | C | I | B | R | D-2 |
| `content_put_file` | Create or update one file with a commit (checks the file's current version first) | P·Prod* | F | I | B | E | D-2 |
| `content_delete_file` | Delete one file with a commit | C·Prod* | C | I | B | E | D-2 |
| `content_push_files` | Commit several file changes at once on a branch, signed by GitHub (GraphQL `createCommitOnBranch`, expected head checked) | P·Prod* | N | I | B | E | D-2 |
| `content_get_archive_link` | Short-lived download link for a tarball or zipball of a ref | — | N | I | B | R | D-2 |
| `commit_list` | Commits on a branch or path, by author or date | — | C | I | B,Op | R | D-2 |
| `commit_get` | One commit: message, author, files changed with stats (patch capped) | — | C | I | B,Op | R | D-2 |
| `commit_compare` | Compare two refs: ahead/behind, commits, files (patches capped) | — | C | I | B,Op | R | D-2 |
| `commit_list_prs` | Pull requests that contain a commit | — | C | I | B,Op | R | D-2 |
| `commit_comment` | Comment on a commit (optionally on a line) | P·M | C | I | B | E | D-2 |
| `git_get_ref` | One ref (branch or tag pointer) and its target | — | C | I | B | R | D-2 |
| `git_update_ref` | Move a branch to another commit; force moves need `force: true` and are refused on production branches without a production connection | C·Prod* | F | I | B | F | D-2 |
| `git_get_commit` | Low-level commit object (tree, parents, verification) | — | C | I | B | R | D-2 |

## Branches and tags (`branch_*, tag_*`) — 9

Card(s): D-3.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `branch_list` | Branches with head SHA, protected flag and whether rules apply | — | F | I | B,Op | R | D-3 |
| `branch_get` | One branch: head commit, protection, and every ruleset rule that applies (`GET /rules/branches/{branch}`) | — | C | I | B,Op | R | D-3 |
| `branch_create` | New branch from any ref (default: the repo's default branch, not a guessed `main`) | P | F | I | B | E | D-3 |
| `branch_rename` | Rename a branch (open PRs are retargeted by GitHub) | C·Prod* | C | I | B | F | D-3 |
| `branch_delete` | Delete a branch (default branch always refused; protected needs production) | C·D·Prod* | F | I | B | E | D-3 |
| `branch_merge` | Merge one branch into another directly (no PR) | P·Prod* | C | I | B | E | D-3 |
| `tag_list` | Tags with their commits | — | C | I | B,Op | R | D-3 |
| `tag_create` | Create a lightweight or annotated tag | C·Prod | N | I | B | F | D-3 |
| `tag_delete` | Delete a tag | C·D·Prod | N | I | B | F | D-3 |

## Pull requests (`pr_*`) — 15

Card(s): E-1, E-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `pr_list` | Pull requests by state, base, head branch, author, label | — | C | I | B,Op | R | E-1 |
| `pr_get` | One PR: state, draft, head SHA, mergeable, review decision, required checks at head, unresolved thread count | — | C | I | B,Op | R | E-1 |
| `pr_get_diff` | The PR's diff (capped; handle for the rest) | — | C | I | B | R | E-1 |
| `pr_list_files` | Files changed with additions/deletions (patches capped) | — | C | I | B | R | E-1 |
| `pr_list_commits` | Commits in the PR | — | C | I | B | R | E-1 |
| `pr_create` | Open a pull request (draft option; body footer records the tool and run) | P·M | C | I | B | E | E-1 |
| `pr_update` | Title, body, base branch (retarget), state open/closed | P | F | I | B | E | E-1 |
| `pr_set_draft` | Convert to draft or mark ready for review (GraphQL) | P | N | I | B | E | E-1 |
| `pr_close` | Close without merging (head branch kept) | C | C | I | B | E | E-1 |
| `pr_update_branch` | Bring the PR branch up to date with its base (expected head SHA checked) | P | C | I | B | E | E-1 |
| `pr_merge` | Merge at an exact head SHA; refuses unless every required check is green at that SHA; production base needs a production connection | C·Prod* | F | I | B | E | E-2 |
| `pr_merge_async` | Same as `pr_merge` using GitHub's asynchronous merge (returns merged / failed / pending); `bypass_rules` is always refused | C·Prod* | N | I | B | E | E-2 |
| `pr_set_auto_merge` | Turn auto-merge on (merges when GitHub's rules pass) or off (GraphQL) | C·Prod* | N | I | B | E | E-2 |
| `pr_list_stacks` | Pull request stacks in a repo, or one stack with its PRs in order | — | N | I | B | R | E-2 |
| `pr_stack_manage` | Create a stack, add PRs to it, or unstack PRs | P | N | I | B | E | E-2 |

## Reviews and review threads (`review_*`) — 9

Card(s): E-3.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `review_list` | Reviews on a PR (state, author, submitted at) | — | C | I | B,Op | R | E-3 |
| `review_list_threads` | Review threads with resolved/outdated state, file and line, every comment (GraphQL) | — | N | I | B | R | E-3 |
| `review_list_comments` | Inline review comments (REST), filterable by file | — | C | I | B | R | E-3 |
| `review_create` | Start or submit a review: comment, approve or request changes, with inline comments | P·M | C | I | B | E | E-3 |
| `review_submit` | Submit a pending review | P·M | C | I | B | E | E-3 |
| `review_dismiss` | Dismiss a review with a message | C·M | C | I | B | F | E-3 |
| `review_reply` | Reply in a review thread | P·M | C | I | B | E | E-3 |
| `review_resolve_thread` | Resolve or unresolve a review thread (GraphQL) | P | N | I | B | E | E-3 |
| `review_request_reviewers` | Request or remove reviewers (users or teams) | P·M | C | I | B | E | E-3 |

## Issues (`issue_*`) — 15

Card(s): F-1.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `issue_list` | Issues by state, label, assignee, milestone, type (pull requests excluded by query, not by dropping rows) | — | F | I | B,Op | R | F-1 |
| `issue_get` | One issue with sub-issue and dependency summary | — | C | I | B,Op | R | F-1 |
| `issue_create` | New issue (labels, assignees, milestone, type) | P·M | C | I | B,Op | E | F-1 |
| `issue_update` | Title, body, state with reason, milestone, type | P | F | I | B,Op | E | F-1 |
| `issue_lock` | Lock or unlock conversation | P | C | I | Op | E | F-1 |
| `issue_list_comments` | Comments on an issue or PR | — | C | I | B,Op | R | F-1 |
| `issue_comment` | Comment on an issue or PR | P·M | C | I | B,Op | E | F-1 |
| `issue_edit_comment` | Edit a comment | P | C | I | B,Op | E | F-1 |
| `issue_list_timeline` | Everything that happened to an issue (events, references, cross-links) | — | C | I | Op | R | F-1 |
| `issue_set_labels` | Add, remove or replace labels on an issue or PR | P | F | I | B,Op | E | F-1 |
| `issue_set_assignees` | Add or remove assignees | P·M | C | I | Op | E | F-1 |
| `issue_set_sub_issue` | Add, remove or reorder a sub-issue | P | N | I | Op | E | F-1 |
| `issue_set_dependency` | Add or remove a 'blocked by' link | P | N | I | Op | E | F-1 |
| `issue_transfer` | Move an issue to another repository (GraphQL) | C | N | I | Op | F | F-1 |
| `issue_react` | Add or remove a reaction on an issue, comment or review comment | P | C | I | Op | E | F-1 |

## Labels and milestones (`label_*, milestone_*`) — 7

Card(s): F-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `label_list` | Labels in a repository | — | C | I | B,Op | R | F-2 |
| `label_save` | Create or update a label by name | P | C | I | B,Op | E | F-2 |
| `label_delete` | Delete a label (removes it from every issue) | C | C | I | Op | E | F-2 |
| `label_sync` | Make several repositories carry the same label set (preview lists every add/change; never deletes unless asked) | P | N | I | O,Op | F | F-2 |
| `milestone_list` | Milestones with progress | — | C | I | Op | R | F-2 |
| `milestone_save` | Create, update or close a milestone | P | C | I | Op | E | F-2 |
| `milestone_delete` | Delete a milestone | C | C | I | Op | E | F-2 |

## Discussions, projects and search (`discussion_*, project_*, search_*`) — 10

Card(s): F-3.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `discussion_list` | Discussions in a repository by category (GraphQL) | — | C | I | Op | R | F-3 |
| `discussion_get` | One discussion with its comments and answer (GraphQL) | — | C | I | Op | R | F-3 |
| `discussion_create` | Start a discussion (GraphQL) | P·M | N | I | Op | E | F-3 |
| `discussion_comment` | Comment on a discussion or mark a comment as the answer (GraphQL) | P·M | N | I | Op | E | F-3 |
| `project_list` | Projects (v2) of an org or user | — | N | I,U | Op | R | F-3 |
| `project_get` | One project: fields, views, item counts | — | N | I,U | Op | R | F-3 |
| `project_list_items` | Items in a project with field values | — | N | I,U | Op | R | F-3 |
| `project_set_item` | Add an issue/PR to a project or set an item's field value | P | N | I,U | Op | E | F-3 |
| `project_remove_item` | Remove an item from a project | C | N | I,U | Op | E | F-3 |
| `search_github` | Search code, issues, pull requests, commits, repositories or users with GitHub's search syntax (type chosen by argument) | — | C | I | B,Op | R | F-3 |

## Actions: workflows, runs, jobs and logs (`actions_*`) — 12

Card(s): G-1.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `actions_list_workflows` | Workflows in a repository with state and file path | — | C | I | B,Op | R | G-1 |
| `actions_set_workflow_enabled` | Enable or disable a workflow | P·Prod* | C | I | B | F | G-1 |
| `actions_dispatch` | Start a workflow (`workflow_dispatch`) on a ref with inputs; returns the run (API 2026-03-10) | P·Prod* | F | I | B,Op | E | G-1 |
| `actions_list_runs` | Runs by workflow, branch, event, status, actor, head SHA | — | C | I | B,Op | R | G-1 |
| `actions_get_run` | One run: status, conclusion, jobs and steps, attempt, billable timing | — | C | I | B,Op | R | G-1 |
| `actions_get_job_log` | A job's log: failed steps first, tail lines, error lines; never a raw base64 dump | — | F | I | B,Op | R | G-1 |
| `actions_get_run_logs_summary` | Download a run's log archive server-side and return failing steps, error lines and annotations | — | F | I | B,Op | R | G-1 |
| `actions_rerun` | Re-run a whole run, only its failed jobs, or one job | P·Prod* | C | I | B,Op | E | G-1 |
| `actions_cancel_run` | Cancel a run (force-cancel needs confirm) | P | C | I | B,Op | E | G-1 |
| `actions_delete_run` | Delete a run, or only its logs | C·D | C | I | Op | F | G-1 |
| `actions_list_pending_deployments` | Runs waiting for an environment approval | — | N | I | Op | R | G-1 |
| `actions_review_pending_deployment` | Approve or reject a waiting deployment | C·Prod* | N | U | Op | F | G-1 |

## Checks, statuses, artifacts and caches (`check_*, status_*, artifact_*, cache_*`) — 10

Card(s): G-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `check_get_ci_state` | CI state at a commit or PR head: every check run and status, which are required by rules, overall green/red/pending | — | N | I | B,Op | R | G-2 |
| `check_get_run` | One check run with output summary and annotations | — | C | I | B | R | G-2 |
| `check_create_run` | Create a check run on a commit (GitHub App only) | P | C | I | B | E | G-2 |
| `check_update_run` | Update or complete a check run | P | C | I | B | E | G-2 |
| `status_create` | Set a commit status (pending/success/failure/error) with a context | P | C | I | B | E | G-2 |
| `artifact_list` | Artifacts of a run or repository with size and expiry | — | C | I | B | R | G-2 |
| `artifact_get_link` | Short-lived download link for an artifact (bytes never pass through chat) | — | F | I | B | R | G-2 |
| `artifact_delete` | Delete an artifact | C·D | C | I | Op | E | G-2 |
| `cache_list` | Actions caches and total cache usage for a repository | — | N | I | B,Op | R | G-2 |
| `cache_delete` | Delete caches by key or ID | C | N | I | B | E | G-2 |

## Secrets and variables (`secret_*, variable_*`) — 7

Card(s): G-3. Covers Actions, Dependabot, Codespaces and agent secrets at repository, environment and organization level. **Secret values never pass through a tool:** Chris types them on the setup page, or the server generates them.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `secret_list` | Secret names, kind, scope, last updated, which repos can use an org secret (never values) | — | F | I | B,O | R | G-3 |
| `secret_set` | Create or update a secret; the value is typed by Chris on the setup page (link returned) or generated by the server; encrypted with the scope's public key | C·Prod* | N | I | B,O | F | G-3 |
| `secret_delete` | Delete a secret | C·D·Prod* | C | I | B,O | F | G-3 |
| `secret_set_repo_access` | Choose which repositories may use an organization secret | C·A·Prod | N | I | O | F | G-3 |
| `variable_list` | Variables with values (variables are not secret) | — | C | I | B | R | G-3 |
| `variable_set` | Create or update a variable | P·Prod* | F | I | B | E | G-3 |
| `variable_delete` | Delete a variable | C·Prod* | C | I | B | E | G-3 |

## Environments and deployments (`env_*, deploy_*`) — 7

Card(s): G-4.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `env_list` | Environments with protection rules, branch policies and counts of secrets/variables | — | C | I | B,O | R | G-4 |
| `env_get` | One environment in full (reviewers, wait timer, branch and tag policies, custom rules) | — | C | I | B,O | R | G-4 |
| `env_save` | Create or update an environment, its protection rules and branch policies | C·Prod* | F | I | B,O | F | G-4 |
| `env_delete` | Delete an environment (its secrets and variables go with it) | C·D·Prod* | C | I | O | F | G-4 |
| `deploy_list` | Deployments with their latest status, by environment and ref | — | C | I | B,Op | R | G-4 |
| `deploy_create` | Create a deployment for a ref and environment | C·Prod* | C | I | B | E | G-4 |
| `deploy_set_status` | Add a status to a deployment (in progress, success, failure, inactive) | P·Prod* | C | I | B | E | G-4 |

## Releases (`release_*`) — 6

Card(s): G-5.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `release_list` | Releases with tag, draft/prerelease flags and asset counts | — | C | I | B,Op | R | G-5 |
| `release_get` | One release by ID, tag or 'latest', with assets | — | C | I | B,Op | R | G-5 |
| `release_create` | Create a release (draft by default) with generated notes; publishing creates the tag | C·Prod·M | F | I | B | F | G-5 |
| `release_update` | Edit notes, name, flags; publish a draft | C·Prod | C | I | B | F | G-5 |
| `release_delete` | Delete a release (the tag is kept unless asked) | C·D·Prod | C | I | B | F | G-5 |
| `release_upload_asset` | Attach a file to a release from a public URL (downloaded server-side, size-capped; no bytes in chat) | P·Prod* | F | I | B | F | G-5 |

## Pages and packages (`pages_*, package_*`) — 6

Card(s): G-6.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `pages_get` | Pages site settings, custom domain, HTTPS state and the latest build | — | C | I | B,O | R | G-6 |
| `pages_save` | Turn on Pages or change source branch/path, custom domain, HTTPS | C·Prod·A* | C | I | B,O | F | G-6 |
| `pages_disable` | Turn off a Pages site | C·D·Prod | C | I | O | F | G-6 |
| `package_list` | Packages of an org or user with versions | — | C | I | B | R | G-6 |
| `package_delete_version` | Delete a package version (restorable for 30 days) | C·D | C | I | B | F | G-6 |
| `package_restore_version` | Restore a deleted package version | P | N | I | B | F | G-6 |

## Developer tools (`dev_*`) — 15

Card(s): V-1 … V-5. Preview-only (contract §10): every `dev_*` tool refuses production targets before reading anything, records every object it creates in a run, and tags it `rtc_run=<runId>` (`docs/designs/BATCH-V.md`).

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dev_list_scenarios` | Named scenarios dev_seed can build (e.g. repo-with-failing-ci, open-pr-with-review-threads, release-train) | — | N | — | B | R | V-1 |
| `dev_seed` | Build a scenario in the scratch account or on test branches: repos, branches, commits, PRs, issues, labels, workflow files; preview lists every object | P | N | I | B | E | V-1 |
| `dev_list_runs` | Runs with their recorded objects and cleanup state | — | N | — | B | R | V-1 |
| `dev_create_scratch_repo` | Throwaway repository in the scratch account, tagged with the run | P | N | I | B | E | V-1 |
| `dev_cleanup` | Remove exactly the objects a run created (preview, then confirm); reports per object | C | N | I | B | E | V-2 |
| `dev_create_test_branch` | Branch `rtc/<run>/<name>` from any ref in an allowed repo (never production) | P | N | I | B | E | V-3 |
| `dev_open_test_pr` | Draft PR from a test branch, labelled with the run | P | N | I | B | E | V-3 |
| `dev_dispatch_and_wait` | Start a workflow on a test ref and wait up to 45 s; returns the run, or a handle to check later | P | N | I | B | E | V-3 |
| `dev_set_check_run` | Create or complete a check run on a run-created commit to simulate a passing/failing check | P | N | I | B | E | V-3 |
| `dev_create_test_webhook` | Webhook in a scratch repo pointing at an app under development (public HTTPS only; secret shown once on the setup page) | P | N | I | B | E | V-4 |
| `dev_create_forwarder` | Register an app-under-development URL and a signing secret (shown once) to replay GitHub deliveries into | P | N | — | B | E | V-4 |
| `dev_list_forwarders` | Forwarders with target and last use | — | N | — | B | R | V-4 |
| `dev_delete_forwarder` | Remove a forwarder | C | N | — | B | E | V-4 |
| `dev_forward_deliveries` | Send real past webhook deliveries to a forwarder with a valid `X-Hub-Signature-256`; reports each status code | P | N | I | B | E | V-4 |
| `dev_check_integration` | Is GitHub set up for an app being built (app permissions, webhook events, secrets present, workflows, rules)? Exact steps for anything missing | — | N | I | B | R | V-5 |

## Branch protection and rulesets (`protection_*, ruleset_*`) — 9

Card(s): H-1.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `protection_get` | Classic branch protection on a branch, in plain words | — | C | I | B,O | R | H-1 |
| `protection_set` | Change branch protection by reading it first and changing only what was asked (GitHub's PUT replaces everything) | C·Prod | F | I | O | F | H-1 |
| `protection_set_required_checks` | Add or remove required status checks, keeping the rest | C·Prod | F | I | B,O | F | H-1 |
| `protection_remove` | Remove branch protection | C·D·Prod | C | I | O | F | H-1 |
| `ruleset_list` | Rulesets of a repository or organization with enforcement and targets | — | C | I | B,O | R | H-1 |
| `ruleset_get` | One ruleset in plain words, optionally with its history | — | C | I | B,O | R | H-1 |
| `ruleset_save` | Create or update a ruleset (read-merge-write for updates) | C·Prod | F | I | O | F | H-1 |
| `ruleset_delete` | Delete a ruleset | C·D·Prod | C | I | O | F | H-1 |
| `ruleset_list_rule_suites` | Recent rule evaluations: which push or merge was blocked by which rule, and why | — | N | I | B,O | R | H-1 |

## Webhooks (`webhook_*`) — 8

Card(s): H-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `webhook_list` | Repository or organization webhooks (URL host, events, active; secrets never shown) | — | C | I | B,O | R | H-2 |
| `webhook_get` | One webhook's configuration and recent delivery health | — | C | I | B,O | R | H-2 |
| `webhook_save` | Create or update a webhook; a new signing secret is generated and shown once on the setup page | C·Prod | F | I | B,O | F | H-2 |
| `webhook_delete` | Delete a webhook | C·D·Prod | C | I | O | F | H-2 |
| `webhook_list_deliveries` | Recent deliveries (status, event, duration), or one delivery's request/response (payload capped) | — | N | I | B,Op | R | H-2 |
| `webhook_redeliver` | Redeliver one past delivery | C·Prod* | N | I | B,Op | E | H-2 |
| `webhook_ping` | Send a ping (or a test push event) to a webhook | P | C | I | B | E | H-2 |
| `webhook_rotate_secret` | Replace a webhook's signing secret (new one shown once on the setup page) | C·Prod | N | I | O | F | H-2 |

## Collaborators and deploy keys (`collab_*, deploykey_*`) — 7

Card(s): H-3.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `collab_list` | Collaborators with permission and how they got it, plus pending invitations | — | C | I | O,Op | R | H-3 |
| `collab_add` | Invite a collaborator or change their permission | C·A·M | F | I | O | F | H-3 |
| `collab_remove` | Remove a collaborator | C | C | I | O | F | H-3 |
| `collab_manage_invitation` | Change or cancel a pending repository invitation | C·A* | C | I | O | F | H-3 |
| `deploykey_list` | Deploy keys with read-only/write flag and last use | — | C | I | O | R | H-3 |
| `deploykey_add` | Add a deploy key (public key only; write access is access-widening and production) | C·A·Prod* | F | I | O | F | H-3 |
| `deploykey_delete` | Remove a deploy key | C | C | I | O | F | H-3 |

## Security features and alerts; Actions settings (`security_*, actions_*settings`) — 8

Card(s): H-4.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `security_get_settings` | Repository security features: secret scanning, push protection, Dependabot alerts/updates, code security, private vulnerability reporting | — | F | I | O,B | R | H-4 |
| `security_set_feature` | Turn a security feature on or off (paid features on private repositories raise spend) | C·Prod·$* | F | I | O | F | H-4 |
| `security_list_alerts` | Dependabot, code scanning or secret scanning alerts for a repo or org (kind chosen by argument) | — | C | I | O,B,Op | R | H-4 |
| `security_get_alert` | One alert in plain words (secret scanning: the secret itself is never returned) | — | F | I | O,B | R | H-4 |
| `security_update_alert` | Dismiss, resolve or reopen an alert with a reason | P | C | I | O,B | E | H-4 |
| `security_list_advisories` | Repository security advisories, or global advisories by package | — | C | I | O,B | R | H-4 |
| `actions_get_settings` | Repository Actions settings: allowed actions, default token permissions, fork PR approval, retention | — | N | I | O,B | R | H-4 |
| `actions_set_settings` | Change repository Actions settings | C·Prod | N | I | O | F | H-4 |

## Owner: organization and members (`org_*`) — 12

Card(s): O-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `org_get` | Organization profile, plan, seats, settings (default permission, who may create repos/pages/forks, 2FA requirement state) | — | C | I | O | R | O-2 |
| `org_update_settings` | Change organization profile and member privileges (each field previewed; widening privileges is access-widening) | C·Prod·A* | N | I | O | F | O-2 |
| `org_list_members` | Members with role and 2FA state; outside collaborators on request | — | C | I | O | R | O-2 |
| `org_invite_member` | Invite someone by username or email with a role and teams | C·A·M | N | I | O | F | O-2 |
| `org_list_invitations` | Pending and failed invitations | — | N | I | O | R | O-2 |
| `org_cancel_invitation` | Cancel a pending invitation | C·M | N | I | O | F | O-2 |
| `org_set_member_role` | Make a member an owner or a member | C·A* | N | I | O | F | O-2 |
| `org_remove_member` | Remove a member (they lose access to private repositories) | C·D | N | I | O | F | O-2 |
| `org_set_outside_collaborator` | Convert a member to outside collaborator, or remove an outside collaborator | C | N | I | O | F | O-2 |
| `org_set_blocked` | Block or unblock a user for the organization; list blocked users | P | N | I | O | F | O-2 |
| `org_custom_properties` | Read or define the organization's custom properties (schema) | P | N | I | O | F | O-2 |
| `org_set_immutable_releases` | Require immutable releases for all or selected repositories | C·Prod | N | I | O | F | O-2 |

## Owner: teams and roles (`team_*, role_*`) — 9

Card(s): O-3.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `team_list` | Teams with privacy, parent and member counts | — | C | I | O | R | O-3 |
| `team_get` | One team: members and roles, repositories and permissions | — | C | I | O | R | O-3 |
| `team_save` | Create or update a team (name, description, privacy, parent) | P | C | I | O | F | O-3 |
| `team_delete` | Delete a team | C·D | C | I | O | F | O-3 |
| `team_set_member` | Add a member, change member/maintainer role, or remove | C·A*·M | C | I | O | F | O-3 |
| `team_set_repo_access` | Give, change or remove a team's access to a repository | C·A* | C | I | O | F | O-3 |
| `role_list` | Organization roles and custom repository roles (where the plan has them), with who holds each | — | N | I | O | R | O-3 |
| `role_assign` | Give a user or team an organization role | C·A | N | I | O | F | O-3 |
| `role_remove` | Take an organization role away from a user or team | C | N | I | O | F | O-3 |

## Owner: billing, budgets, Copilot and Codespaces (`billing_*, copilot_*, codespace_*`) — 13

Card(s): O-4. Spend guard (`docs/designs/BATCH-B.md` B-4): `$` tools show a dollar estimate from `src/github/prices.js` (dated, sourced), always need `confirm`, and are refused while the account's spend limit is $0.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `billing_get_usage` | Usage and cost for an org or user by product (Actions, Packages, Codespaces, Copilot, LFS) and period, in dollars; premium requests on request | — | N | I,U | O | R | O-4 |
| `billing_list_budgets` | Organization budgets with amount, spent so far and whether usage stops at the limit | — | N | I | O | R | O-4 |
| `billing_save_budget` | Create or change a budget (raising or removing a limit raises spend) | C·$* | N | I | O | F | O-4 |
| `billing_delete_budget` | Delete a budget (removes a spending cap) | C·$ | N | I | O | F | O-4 |
| `billing_list_marketplace` | Marketplace apps Chris pays for (plan, price, next billing date); buying is guided only | — | N | U | O | R | O-4 |
| `copilot_get_billing` | Copilot plan, seat counts and seat assignments with last activity | — | C | I | O | R | O-4 |
| `copilot_add_seats` | Give users or teams Copilot seats (about $19 per seat per month, prorated) | C·$·A | F | I | O | F | O-4 |
| `copilot_remove_seats` | Remove Copilot seats (effective at the end of the billing cycle) | C | C | I | O | F | O-4 |
| `codespace_list` | Codespaces of the user or org with machine, state and who pays | — | C | I,U | O,B | R | O-4 |
| `codespace_create` | Create a codespace for a repo and branch (hourly compute plus storage) | C·$ | C | U | B | F | O-4 |
| `codespace_set_state` | Start (billed) or stop (saves money) a codespace | P·$* | C | U | B | E | O-4 |
| `codespace_delete` | Delete a codespace (unpushed work is lost) | C·D | C | U | B | F | O-4 |
| `codespace_set_org_access` | Choose who may use codespaces at the organization's expense | C·$·A | N | I | O | F | O-4 |

## Owner: apps and fine-grained tokens (`app_*, pat_*`) — 7

Card(s): O-5.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `app_list_installations` | GitHub Apps installed on an org or on Chris's account, with permissions and repo selection | — | C | I,U | O | R | O-5 |
| `app_get_installation` | One installation: permissions, events, selected repositories, suspended state | — | C | I | O | R | O-5 |
| `app_set_installation_repos` | Add or remove a repository from an app installation | C·A* | N | U | O | F | O-5 |
| `pat_list_requests` | Pending requests from fine-grained tokens to access the organization | — | N | I | O | R | O-5 |
| `pat_review_request` | Approve or deny a fine-grained token's access request | C·A* | N | I | O | F | O-5 |
| `pat_list_tokens` | Fine-grained tokens that can reach the organization, with owner, repositories and expiry | — | N | I | O | R | O-5 |
| `pat_revoke_access` | Revoke a fine-grained token's access to the organization | C | N | I | O | F | O-5 |

## Owner: personal account (`account_*`) — 9

Card(s): O-6. Needs Chris's user authorization (`U`); installation tokens cannot reach personal settings.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `account_get` | Chris's profile, plan, organizations, emails (primary/verified/visibility) and two-factor state | — | C | U | O | R | O-6 |
| `account_update_profile` | Name, bio, company, blog, location, hireable, social handle | P | N | U | O | F | O-6 |
| `account_manage_email` | Add or remove an email address, or set primary email visibility | C·M* | N | U | O | F | O-6 |
| `account_list_keys` | SSH authentication keys, SSH signing keys and GPG keys (fingerprints only) | — | N | U | O | R | O-6 |
| `account_add_key` | Add an SSH, signing or GPG public key | C·A | N | U | O | F | O-6 |
| `account_delete_key` | Delete an SSH, signing or GPG key | C | N | U | O | F | O-6 |
| `account_set_blocked` | Block or unblock a user; list blocked users | P | N | U | O | F | O-6 |
| `account_list_invitations` | Repository invitations waiting for Chris | — | N | U | O | R | O-6 |
| `account_respond_invitation` | Accept or decline a repository invitation | C·A* | N | U | O | F | O-6 |

## Owner: notifications and gists (`notify_*, gist_*`) — 7

Card(s): O-7. Notifications need the optional classic token (`K`, `notifications` scope only — GitHub offers no other token for them; IN-11).

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `notify_list` | Unread (or all) notifications, by repository and reason | — | C | K | Op | R | O-7 |
| `notify_mark` | Mark one thread, a repository or everything as read or done | P | C | K | Op | E | O-7 |
| `notify_set_subscription` | Watch, ignore or unsubscribe from a thread or repository | P | C | K | Op | E | O-7 |
| `gist_list` | Chris's gists | — | C | U | B | R | O-7 |
| `gist_get` | One gist's files (size-capped) | — | C | U | B | R | O-7 |
| `gist_save` | Create or update a gist (public gists are access-widening) | P·A* | C | U | B | E | O-7 |
| `gist_delete` | Delete a gist | C·D | C | U | B | F | O-7 |

## Owner and administration: guided settings (`admin_*`) — 3

Card(s): O-1. Every GitHub settings page is in the dashboard map (`src/data/dashboard-map.js`); settings with no API return structured steps from `github_where_is_setting` (contract §11).

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `admin_list_guided_settings` | Every setting with no API, by page, with its current value when GitHub lets it be read | — | N | — | O | R | O-1 |
| `admin_check_setting` | Read back one setting after Chris (or a browser agent) changed it; never reports a guided setting done without a read-back or Chris saying so | — | N | I,U | O | R | O-1 |
| `admin_review_security` | Security review of an org or the personal account: 2FA, SSO (plan-dependent), token policies, apps, deploy keys with write, push protection coverage, outside collaborators | — | N | I,U | O | R | O-1 |

## Project profiles (`project_*`) — 3

Card(s): P-1 … P-3. Optional (`docs/designs/BATCH-P.md`). The readiness and setup workflows are listed under Workflows.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `project_list_profiles` | Project profiles the server knows (Appliance Desk, the Robinson servers, drafts) | — | N | — | B,O | R | P-1 |
| `project_get_profile` | One profile: repos, production branches and environments, required checks, workflows with write access, owned settings | — | N | — | B,O | R | P-1 |
| `project_draft_profile` | Turn what an agent found in a codebase (workflows, branches, environments, required checks) into a draft profile and APP-NEEDS text | — | N | — | B | R | P-3 |

## Workflows (`workflow_*`) — 17

Card(s): P-2, P-3, W-1 … W-7. Whole jobs in one call, answered in plain English with `structuredContent` (`docs/designs/BATCH-W.md`).

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `workflow_pr_status` | Everything about a PR in one answer: CI at head (required vs optional), mergeable, review decision, unresolved threads, stack position, next action | — | N | I | B,Op | R | W-1 |
| `workflow_open_pr` | Push nothing; open a PR from an existing branch with a plain description, labels and draft choice; returns the CI state so far | P·M | N | I | B | E | W-1 |
| `workflow_merge_when_green` | Merge at the exact head SHA only when required checks are green there and no review thread is unresolved; otherwise says what is missing | C·Prod* | F | I | B | E | W-2 |
| `workflow_merge_stack` | Merge a stack bottom-up: retarget each PR to the default branch, require fresh green CI at its head, merge; stops at the first PR that is not ready | C·Prod* | N | I | B | E | W-2 |
| `workflow_review_threads` | Unresolved review threads with file context; after fixes, reply and resolve each one verified at the current head | P·M | N | I | B | E | W-3 |
| `workflow_ci_failure_summary` | Why CI failed: failed jobs and steps, error lines, annotations, likely cause, same failure on the default branch? | — | N | I | B,Op | R | W-4 |
| `workflow_rerun_failed_ci` | Re-run only failed jobs once; refuses a second automatic re-run of the same failure (two-strikes rule) | P | N | I | B,Op | E | W-4 |
| `workflow_repo_health` | Protection and rules, CI pass rate, open PRs and staleness, security alerts, secret scanning/push protection, Actions settings | — | F | I | O,Op | R | W-5 |
| `workflow_security_review` | Open alerts across an org or account by severity, features off, push protection bypasses | — | F | I | O | R | W-5 |
| `workflow_access_review` | Who can reach what: members, outside collaborators, teams, deploy keys, apps, fine-grained tokens; flags anything unusual | — | N | I | O | R | W-5 |
| `workflow_release` | Cut a release from a tag or branch head with generated notes; draft first, publish with confirm | C·Prod·M | F | I | B | F | W-6 |
| `workflow_cleanup_branches` | Branches whose PR merged or closed (merge-commit and squash both detected), never default/protected/profile branches; preview then confirm | C | F | I | B,Op | E | W-6 |
| `workflow_new_repo` | Create a repository the standard way: default branch, ruleset requiring `ci`, secret scanning and push protection, merge commits only, delete branch on merge | C·A* | N | I | B,O | F | W-7 |
| `workflow_find` | Find anything from plain words: repo, PR, issue, run, release, commit | — | N | I | Op | R | W-7 |
| `workflow_weekly_digest` | Last 7 days across accounts: merged PRs, CI failure rate, open alerts, Actions/Copilot spend, pending invitations | — | N | I,U | O,Op | R | W-7 |
| `workflow_app_readiness` | Is GitHub set up for a profiled project (or an inline spec)? Each row done / fixed with confirm / needs you (steps) / needs a decision | P | N | I | B,O | R | P-2 |
| `workflow_project_setup` | Set up GitHub for a new project from a short description: repo, rules, environments, labels, security features; idempotent | C·A* | N | I | B,O | F | P-3 |

## Everything else on GitHub: the universal tools (`api_*, graphql_*`) — 6

Card(s): U-1, U-2.

| Tool | What it does | Safety | Origin | Cred | Audience | Profile | Card |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `api_search` | Find REST operations by plain words: method, path, summary, and whether it reads, writes, is production, widens access, notifies people or spends | — | N | — | B,O,Op | R | U-1 |
| `api_describe` | Parameters for one operation, trimmed, from GitHub's own description at the pinned version | — | N | — | B,O,Op | R | U-1 |
| `api_read` | Any GET operation, with the same summaries, `fields`, size cap and handles as every other read | — | N | I,U | B,O,Op | R | U-1 |
| `api_write` | Any POST/PUT/PATCH/DELETE operation through the full safety layer | C (always) | N | I,U | B,O,Op | F | U-1 |
| `graphql_read` | Any GraphQL query, validated against GitHub's published schema; cost estimated before sending | — | N | I,U | B,O,Op | R | U-2 |
| `graphql_write` | Any GraphQL mutation, validated against the schema, through the full safety layer | C (always) | N | I,U | B,O,Op | F | U-2 |

How `api_write` and `graphql_write` stay safe (`docs/designs/BATCH-U.md`):

- **Always `confirm: true`**, `dryRun` supported; the preview names the operation in plain words, the exact
  parameters, and the object as it is now when the path names one.
- **Only what GitHub describes.** Every request is checked against the vendored OpenAPI description (REST) or the
  vendored schema (GraphQL) at the pinned version; unknown operations, parameters or fields are refused in words.
- **Classification table** (`src/github/operation-classes.js`): production, access-widening, notifies-people and spend
  marks for every operation, seeded from GitHub's own `x-github.triggersNotification` flags and the guard rules of
  B-2/B-4. **An unlisted operation that creates, deletes, transfers, invites, enables, assigns seats or changes
  settings is treated as production + access-widening until classified** — the safe default.
- **Hand-built tools win**: if a hand-built tool covers the operation, the universal tool refuses and names it.
- **Never** `bypass_rules`, never a secret value in a request (secret endpoints are refused; use `secret_set`), never
  a raw credential in a result.
- Same production guard, self-protection, profile ownership, change log, read-back (`confirmed: null` when nothing
  can be read back), passes need `allow_writes`, `full` profile only.

## Things GitHub has no API for

Handled by `github_where_is_setting` with structured steps and, where GitHub lets the value be read, a read-back
(`admin_check_setting`); never faked: requiring two-factor authentication for an organization; SAML single sign-on
(Enterprise Cloud); changing the plan or buying seats for the plan; buying Marketplace apps; personal password, passkeys
and recovery codes; creating a GitHub App or OAuth app by hand (the setup page uses the manifest flow instead);
OAuth app access policy; fine-grained token policy for the organization; Copilot policies at the personal level;
notification email routing; the personal security log; Sponsors; deleting the organization or the account; transferring
an organization; scheduled reminders; interaction limits beyond 6 months. The full page-by-page map is built in O-1.

## Totals

**Totals:** 301 tools: 295 hand-built + 6 universal (`api_*`, `graphql_*`), plus guided settings for every
dashboard-only owner setting. By profile (lowest profile that has the tool): read_only 131, everyday adds 81
(everyday lists 212), full adds 89 (full lists 301). In compact mode (`docs/designs/BATCH-C.md`) an agent
loads only about 25 tools up front (meta-tools, whoami, universal search, workflows) and reaches the rest through
`github_search_tools` / `github_call`.

| Section | Tools |
| --- | --- |
| Server about itself | 21 |
| Repositories | 20 |
| Files, commits and git data | 14 |
| Branches and tags | 9 |
| Pull requests | 15 |
| Reviews and review threads | 9 |
| Issues | 15 |
| Labels and milestones | 7 |
| Discussions, projects and search | 10 |
| Actions: workflows, runs, jobs and logs | 12 |
| Checks, statuses, artifacts and caches | 10 |
| Secrets and variables | 7 |
| Environments and deployments | 7 |
| Releases | 6 |
| Pages and packages | 6 |
| Developer tools | 15 |
| Branch protection and rulesets | 9 |
| Webhooks | 8 |
| Collaborators and deploy keys | 7 |
| Security features and alerts; Actions settings | 8 |
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
| **Total** | **301** |
