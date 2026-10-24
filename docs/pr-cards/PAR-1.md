# PAR-1 — close the gaps with GitHub's official MCP server (Copilot review, code quality, docs search, bulk project edits, stargazers)

**Batch FIN · Design:** this card · **Prerequisites:** none (independent of GOD-6 and PUB-5) · **Effort:** light–medium ·
**Split:** one PR (one outcome: "everything the official server does, ours does too"). **Expected agent time:** 3–4 h.

## Why (Chris, 2026-10-24)
Chris compared this connector with GitHub's official one (`github/github-mcp-server`, remote
`https://api.githubcopilot.com/mcp/`). A tool-by-tool comparison on 2026-10-24 found ours covers nearly everything (463
tools) except the five items below. Already covered, do NOT rebuild: repository tree (`github_content_get_tree`), PR
diff (`github_pr_get_diff`), failed-job logs (`github_actions_get_run_logs_summary`, `github_actions_get_job_log`),
reviews and threads (`github_review_*`), sub-issues, issue types/fields, discussions, projects, gists, notifications,
security alerts, search (`github_search_github`), Copilot agent tasks, multi-file commits (`github_content_push_files`).
Two "gaps" are already covered and only need their descriptions improved (step 6): finding organizations
(`github_search_github` with type `users` and `type:org` in the query) and a team's members (`github_team_get`).

**Not a tool gap (record only, no code):** the official integration in Claude Code also gives the agent's own computer
git clone/push, the `gh` command and pull-request notifications. An MCP connector cannot provide those (it lives in the
conversation, not on that computer, and that computer cannot reach this server). The owner checklist row in step 7 says
to keep the official integration connected for that, next to this connector.

## Read only these
- Read-tool pattern: `src/tools/security-read.js` (`securityListAlerts`, `defineRead`, `plain`, `readerFor`), and
  `src/tools/users-public.js` for a simple read.
- Write-tool pattern (REST): `src/tools/projects-write.js` (`projectSetItem`).
- Write-tool pattern (GraphQL): `src/tools/reviews-write.js` (`reviewReply`/`reviewResolve` use `graphql(...)`, and
  `requestReviewers` ~line 179 is the closest sibling).
- Setup read/write pattern: the code-scanning default setup tool in `src/tools/security-scanning-writes.js`
  (`grep -n "github_security_code_scanning_default_setup" src/tools/security-scanning-writes.js`).
- Registration: `src/tools/index.js` (each file's `tools` / `handlers` exports are imported there).
- `docs/TOOL-CATALOG.md` rows for the files above (copy their column style); `python3 scripts/count-catalog.py`.
- Nine-check write test: `test/helpers/write-contract.js` + `tests/unit/o7-notifications-gists.test.js`.

## Drift check A (fill in the PR description before coding)

| Expected on main | How to check | Actual | Action |
|---|---|---|---|
| None of these tool names exist: `github_review_request_copilot`, `github_code_quality_list`, `github_code_quality_get`, `github_code_quality_setup`, `github_docs_search`, `github_project_set_items`, `github_repo_list_stargazers` | `grep -rn "<name>" src/tools \| head` for each | | |
| Pinned schema has `requestReviewsByLogin` with `botLogins` | `node scripts/graphql-find.mjs RequestReviewsByLoginInput` | | |
| Pinned REST has `GET /repos/{owner}/{repo}/code-quality/findings`, `.../findings/{finding_number}`, `GET`/`PATCH .../code-quality/setup` | `node scripts/openapi-find.mjs "code quality"` | | |
| Pinned REST has `GET /repos/{owner}/{repo}/stargazers` and `.../stargazers/count` | `node scripts/openapi-find.mjs "stargazers"` | | |
| Writes are spaced 1 per second per installation (`WRITE_SPACING_MS = 1000`, `src/github/rate.js`) and functions may run 60 s (`vercel.json`) | `grep -n WRITE_SPACING_MS src/github/rate.js` | | |

## 0. Registration
Already registered (work-index `PAR-1`, validator unit list, FINISH-PLAN row 12). Set the status to `IN_PROGRESS` in your
first commit and `MERGED` after merge.

## 1. `github_review_request_copilot` — ask Copilot to review a pull request (write)

File: `src/tools/reviews-write.js`, next to `requestReviewers`; add to `defs`.
- Arguments: `owner`, `repo`, `number` (same constants as `requestReviewers`). Nothing else.
- Declarations: `production: 'never'`; no `notifies` (no person is notified); `cred` as `requestReviewers`.
- `read`: `GET /repos/{owner}/{repo}/pulls/{pull_number}` → `node_id`, `state`; refuse when not open ("Copilot can only
  review an open pull request"). Then the GraphQL query below for current review requests and Copilot reviews:
  ```graphql
  query($id: ID!) { node(id: $id) { ... on PullRequest {
    reviewRequests(first: 30) { nodes { requestedReviewer { __typename ... on Bot { login } } } }
    reviews(last: 20) { nodes { author { login } submittedAt } } } } }
  ```
  `requested = nodes.some(n => n.requestedReviewer?.__typename === 'Bot' && /^copilot-pull-request-reviewer/i.test(n.requestedReviewer.login))`.
- `summarize`: "Ask Copilot to review pull request #<n> in <owner>/<repo>" (+ " again" when a Copilot review already
  exists).
- `apply`: GraphQL mutation (verified against the pinned schema; GitHub's docs say REST with
  `copilot-pull-request-reviewer[bot]` also works, but REST can answer 201 while dropping the bot, so use GraphQL):
  ```graphql
  mutation($input: RequestReviewsByLoginInput!) { requestReviewsByLogin(input: $input) { pullRequest { id } } }
  ```
  with `{ input: { pullRequestId: node_id, botLogins: ['copilot-pull-request-reviewer'], union: true } }`
  (`union: true` keeps the other requested reviewers).
- `readAfter`: the same query; `verify`: `requested` is true OR a review by a `copilot-pull-request-reviewer` author
  newer than before exists. If neither (GitHub accepted but shows nothing yet), the lifecycle reports unconfirmed; add
  to `present`: `note: 'Copilot usually posts its review within 3–10 minutes. Read the reviews again then.'`
- GitHub refusing (for example "Could not resolve bot", 403, 422): plain message "Copilot code review is not available
  on this repository (it needs a Copilot plan that includes code review, turned on for this account)."
- `inverse`: null (a review request to a bot cannot be taken back reliably); say so in the catalog row.
- Sources to cite in a code comment: https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review
  and the pinned GraphQL schema.

## 2. Code quality findings and setup (2 reads + 1 setup tool)

New file `src/tools/code-quality.js` (register in `src/tools/index.js`):
- `github_code_quality_list` (read): arguments `owner`, `repo`, `state` (copy the enum from the pinned description:
  `node -e` with `describeRest(restOperation('GET /repos/{owner}/{repo}/code-quality/findings'))`), `max` (1–100,
  default 30), `after`/`before` cursors (strings, passed through). Return per finding: `number`, `state`, `rule`
  (id/name/severity as the response names them), `path`, `start_line`, `message` (≤300 characters), `html_url`,
  `created_at`; plus `next` cursor when GitHub returns one. Takes `fields`/`detail` like `securityListAlerts`.
- `github_code_quality_get` (read): `owner`, `repo`, `number`; return the full finding shaped the same way, message
  ≤2,000 characters.
- `github_code_quality_setup` (write; copy the code-scanning default setup tool): `action: 'get' | 'set'`; for `set`,
  the body fields the pinned description lists (`state`, `runner_type`, `runner_label`, `languages`,
  `ai_findings_option`) with the same enums; `production: 'always'` (repository-level setting); read-before, PATCH,
  read-after, `verify` compares every field the caller named; `inverse` restores the previous values.
- 404/403 on any of them → plain "Code quality is not turned on for <owner>/<repo>, or this account cannot see it."
- Code-quality text comes from GitHub's analysis, not a person, so it is NOT marked untrusted; file paths and messages
  still pass through the normal result shaping (`shapeResult` redacts token-shaped text).

## 3. `github_docs_search` — search GitHub's own help pages (read, no GitHub credential)

New files: `src/github/docs-search.js` (the fetch) and `src/tools/docs-search.js` (the tool; register in `src/tools/index.js`).
- This is the ONE deliberate exception to "GitHub only through `src/github/client.js`": it is not the GitHub API, needs
  no credential and sends none. Fixed URL only:
  `https://docs.github.com/api/search/v1?version=dotcom&language=en&query=<q>&size=<n>` built with `URL` and
  `searchParams.set` (never string concatenation). `fetch(url, { redirect: 'error', headers: { accept:
  'application/json', 'user-agent': 'robinson-github-mcp' }, signal: AbortSignal.timeout(8000) })` using `ctx.fetch ??
  fetch`. Refuse any response whose `url` origin is not `https://docs.github.com`.
- Arguments: `query` (2–200 characters), `max` (1–10, default 5). Nothing from the person or their accounts is sent.
- Result: `meta.found.value` as `total`, and per hit `title`, `url` (must start `https://docs.github.com/`; drop others),
  `breadcrumbs`, `snippet` = first `highlights.content` entry with every HTML tag removed (`.replace(/<[^>]*>/g, '')`),
  ≤300 characters.
- Errors (timeout, non-200, bad JSON) → "GitHub's help search did not answer; try again or search
  https://docs.github.com yourself." Never retries more than once.
- Add one line to `docs/ARCHITECTURE.md` (outbound hosts) and to `docs/AI-PR-READ-FIRST.md` if it lists outbound
  hosts: "docs.github.com search (read-only, no credentials) — PAR-1".
- Checked 2026-10-24: the endpoint returns `{ meta: { found, took, page, size }, hits: [{ id, url, title, breadcrumbs,
  highlights: { title, content, content_explicit } }] }`. Re-check once before coding; if it changed, follow the new
  shape and note it.

## 4. `github_project_set_items` — edit many project items in one call (write)

File: `src/tools/projects-write.js`, next to `projectSetItem`; reuse its helpers (`getProject`, `readFull`, `p`, `FIELD`).
- Arguments: `owner`, `number` (project), `items`: array of 1–40 `{ itemId, fields: [FIELD, 1–20] }`; item ids unique.
  **Why 40, not the official 50:** writes are spaced one per second and a function may run 60 s; 40 updates plus the
  reads fit with room to spare. Put that reason in a comment.
- Declarations: `production: 'never'`, `confirm: 'always'` (same as `github_project_set_item`).
- `read`: project once (`getProject`), project fields once (`readFull` …`/fields`, max 200; capped → refuse), then each
  item (`GET …/items/{item_id}` with its field ids). Refuse the whole call before any change if any item or field id
  is not verified (name the first bad one). Keep each item's current values (`before`) for undo.
- `summarize`: "Update <k> items (<f> field values) in project #<n> of <owner> (approval required)".
- `apply`: for each item in order, `PATCH /orgs/{org}/projectsV2/{project_number}/items/{item_id}` with its `fields`.
  Stop at the first error; never retry (A8). Return `{ done: [ids], failed: { itemId, reason } | null, notTried: [ids] }`
  as the apply result (`response`).
- `readAfter`: re-read only the `done` items; `verify`: every done item has every requested value (`wantedValue`), and
  `failed === null`. When something failed, `present` says plainly "Updated <a> of <k> items; stopped at item <id>
  (<reason>); <b> not tried. Nothing was retried." so the person can re-run with the rest.
- `inverse`: `github_project_set_items` with the `before` values of the `done` items only.
- Tests: nine-check write contract; 3 items success; bad field id → refused before any PATCH; second PATCH fails →
  exactly 2 PATCH requests, first item reported done, third not tried, result says so; 41 items → schema refusal.

## 5. `github_repo_list_stargazers` (read)

File: `src/tools/users-public.js` (public repositories through `publicGet`), or the repository read file for connected
repositories if `publicGet` refuses private ones — use whichever the existing `github_user_list_repos` path uses for
the same owner kind, and document the choice.
- Arguments: `owner`, `repo`, `max` (1–100, default 30), `page`, `withDates` (boolean).
- Calls `GET /repos/{owner}/{repo}/stargazers/count` for `total`, then `GET /repos/{owner}/{repo}/stargazers`
  (`per_page`, `page`); with `withDates`, send header `accept: application/vnd.github.star+json` so each row has
  `starred_at`. Return `total`, `items: [{ login, type, starred_at? }]`, `page`.

## 6. Make two existing tools easier to find (descriptions only)
- `github_search_github` description: append "(find organizations with type users and `type:org` in the query)" —
  keep it ≤160 characters; shorten other words if needed.
- `github_team_get` description: make sure it says "members" first (for example "A team's members and roles, its
  repositories and permissions"). Update both `docs/TOOL-CATALOG.md` rows.

## 7. Docs and owner row
- `docs/TOOL-CATALOG.md`: a row for each of the 7 new tools in the right sections (copy neighbouring rows' columns:
  safety, credential, audience). `python3 scripts/count-catalog.py` must pass (total = the count on main before this PR + 7).
- `docs/OWNER-CHECKLIST.md`, new section "Using this connector in Claude Code":
  "- [ ] Keep the official GitHub integration connected in Claude Code as well. It is what lets agents copy repositories,
  push changes with git, use GitHub's command-line tool and get pull-request notifications. This connector cannot do
  those (it lives in the conversation, not on the agent's computer). Agents should use this connector for GitHub tools;
  the official one stays for git."
- `docs/pr-cards/SOL-GUIDE.md` "Rules that catch people out": add "Several files to commit? Use
  `github_content_push_files` (up to 50 files in one commit) — or git, when the session has it — never one
  `github_content_put_file` per file."
- Status note `docs/status/<date>-par-1.md` (plain English); `work-index.json` PAR-1 → MERGED after merge.

## Tests
- `tests/unit/par-1-parity.test.js` (fake GitHub; request shapes validated against the pinned schemas):
  1. Copilot review: GraphQL mutation sent with `botLogins: ['copilot-pull-request-reviewer']`, `union: true` and the PR
     `node_id`; readback with the bot in `reviewRequests` → done; readback empty → unconfirmed with the 3–10 minute note;
     closed PR → refused before any write; GitHub error → the plain "not available" message; nine-check contract.
  2. Code quality list/get: shaped fields, `next` cursor passed through, 404 → plain message; setup get/set with
     read-back comparison and inverse; nine-check contract for `set`.
  3. Docs search with a fake `fetch`: URL is exactly the fixed origin and path with encoded query; `<mark>` tags
     removed; a hit with a non-docs URL dropped; a redirect or other origin refused; timeout → the plain message.
  4. Project bulk edit: the cases listed in step 4.
  5. Stargazers: count + list, `withDates` sends the star header.
  6. Descriptions of `github_search_github` and `github_team_get` are ≤160 characters and contain "type:org" /
     "members".
- `npm run test:shapes` passes (new request shapes); `npm run check` passes.

## Done when
- [ ] 7 tools built and registered; catalog total up by 7; all tests above pass; `ci` and `release-policy` green at the
      exact head; self-review in the PR.
- [ ] Owner checklist, SOL-GUIDE and ARCHITECTURE lines added; status note written.
- [ ] After release (ACC-1 on scratch): docs search and stargazers called live; code-quality list called (a "not turned
      on" answer is a valid result); Copilot review request recorded as **unverified — needs a Copilot plan with code
      review** if the account has none (owner decision 2026-10-24: paid-plan checks are recorded, never blocking).

## Not in this card
GitHub's "insiders" experimental tools; the official server's per-toolset switches (this server already has profiles,
listing modes and `github_search_tools`); anything needing git on the agent's own computer.

## Follow-up (2026-10-24): two defects found by the first live test

- Docs search returned a total but no results, because GitHub's help search answers with site-relative links (`/en/rest/...`) and the filter only kept absolute ones. Links are now resolved against `https://docs.github.com` and anything pointing elsewhere is still dropped.
- Stargazers took its total from a separate count endpoint that did not answer live. The total now comes from the repository's own star count, which the public-repo check already reads. One fewer GitHub call.
- Approve page and My connection: a permanent "Install on another organization or account" button (value `*`) opens GitHub's install picker with no place pre-selected, so it does not depend on our own organization lookup.
