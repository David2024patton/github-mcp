# STATUS — current work, blockers and next action

Updated 2026-10-11. **The foundation is built (A-1, PR #1), its database schema exists (A-2, PR #7), the connector login is built (A-3a, PR #8; A-3b, PR #9) the GitHub client exists (A-4, PR #10) the encrypted credential store exists (A-5a, PR #11) and the private setup page exists (A-5b, PR #12) the App webhook and first two tools exist (A-5c, PR #13) the deployment guide is written (A-6, PR #15) the write safety layer exists (B-1, PR #16) the production guard with the two-step production switch exists (B-2, PR #18) the protected list with project ownership exists (B-3, PR #19) the people and spend guards exist (B-4, PR #20) plain-English errors with result shaping exist (B-5, PR #21) and profiles with downscoped tokens exist (B-6, PR #22):** Node 24
package with a committed lockfile, a fake GitHub for tests, the check scripts, throwaway-Postgres database tests, CI with
one `ci` merge gate, `src/db.js` creating the 13 foundation tables plus the owner settings table and storing connector logins, the OAuth endpoints and `/api/mcp` (two read-only tools, `github_whoami` and `github_list_accounts`), and `src/github/client.js` (pinned API version, request keys, write spacing, rate blocks, ETag cache) with GitHub's REST and GraphQL descriptions vendored, and `src/github/credentials.js` (encrypted Apps, installation tokens, user authorization, pasted tokens) with one-time secrets. Two read-only tools exist; no deployment exists. No GitHub App, credential, Vercel project or Neon database exists for this server; nothing here touches Chris's real
repositories.

## Next

- **Batch E — pull requests and reviews** (`docs/designs/BATCH-E.md`). E-1 is finished (reads #35 with the shared `ciState` helper; create/update/close/set_draft/update_branch #40). E-3 (review reads and changes) is built (PRs #37 and #38). E-2 is complete: exact-head merge tools (#46), plus list/create/append/unstack pull request stacks (#48). G-4 deployment reads are built (#51); deployment create/status writes are built (#52); G-4 branch/tag policies completed (#53); G-4 is complete. G-5 release metadata reads built in #54; next: guarded release lifecycle and asset operations. Batch D is finished.
- Batches A, B, C, D finished. Real GitHub steps need IN-02…IN-05 (`docs/DEPLOY.md`).
- **Known follow-ups:** port the empty-passphrase fix in `secretsMatch` to stripe-mcp and the hub core (other repos: tell Chris, do not edit); the manifest's permission names are unverified until the first real App creation.
- **Answered 2026-10-10 (Chris):** IN-00 — plan approved ("I approve the plans"); IN-01 — **no automated review** ("I don't want the automated review at this time"); the repository stays public as Chris created it; the implementer self-reviews every diff.
- **Queue:** A → B → C → D → E → G → V → F → H → O → P → W → U → R → X (`MASTER-ROADMAP.md`).

## Environment

- Repo: `Robinson-AI-Systems/github-mcp` (public), default branch `main`. Every change goes through an `ai/*` branch and
  a PR; the `ci` check is the merge gate.
- Runtime: Node 24.x (`package.json` engines, every CI job). GitHub REST API version to pin: `2026-03-10` (still the
  newest on 2026-10-10).
- Dev commands (all finish by themselves): `npm ci`, `npm run check`, `npm test` (unit), `npm run test:db` (throwaway
  Postgres: CI service, or local binaries — works as root), `npm run test:shapes` (Octokit against the fake GitHub).
- Vercel project, Neon database, GitHub Apps: not created yet (IN-02, IN-03, IN-04, IN-05).

## Recent changes (newest first)

**2026-10-11 — G-5 part 1, release reads (PR #54):** `github_release_list` pages release metadata and `github_release_get` retrieves by exact ID, tag or latest published release. Both include draft/prerelease status, asset counts/metadata and public download links, never asset bytes. No release publication or tag change. G-5 remains IN_PROGRESS for guarded lifecycle and asset tools.


**2026-10-11 — G-4 part 3c, environment deployment branch/tag patterns (PR #53):** `github_env_policy_create/update/delete` are separately guarded from environment PUT. Require custom-policy mode and verified prior policy state, prevent duplicates and incomplete list interpretation, classify existing environment protection, demand confirmation and report only verified read-back. Full-profile owner tools, production and access guards retained. G-4 complete. Next: G-5 release reads, lifecycle and assets.


**2026-10-11 — G-4 part 3b, guarded deployments (PR #52):** `github_deploy_create` prevents GitHub auto-merges, preserves required checks, guards existing/proposed production targets and verifies a created ID; 202 cannot masquerade as a deployment. `github_deploy_set_status` derives environment/ref from GitHub, guards production and verifies the exact new status ID. Three-door write contracts and denial fixtures added. No live deployment or credentials. Next: separate branch/tag policies; G-4 remains IN_PROGRESS.

**2026-10-11 — G-4 part 3a, deployment reads (PR #51):** `github_deploy_list` lists deployment records with bounded paging, ref/environment/task/SHA filters and each deployment's latest status (or explicit null). `includeLatestStatus: false` avoids extra calls. No deployment is created, status changed or production action taken. Next: guarded deployment writes and separate environment branch/tag policy CRUD; G-4 remains IN_PROGRESS.

**2026-10-11 — G-4 part 2, environment settings (PR #50):** `github_env_save` preserves omitted reviewers, wait timers and branch-policy mode, verifies read-back and refuses unsupported custom rules; `github_env_delete` is confirm-always, irreversible, and retains existing production safeguards. No deployment is started. Next: G-4 part 3, deployments and separate branch/tag patterns.

**2026-10-11 — G-4 part 1, environments reads (PR #49):** list environments with truthful paging/protection metadata and optional secrets/variables *counts only*; get environment reviewers, wait timers and distinct branch/tag patterns, preserving unknown protections as visible. No mutations or secret values. Next: environment settings writes (#50) and deployments.

**2026-10-11 — E-2 part 2, pull request stacks (PR #48):** `github_pr_list_stacks` pages or inspects ordered stacks; `github_pr_stack_manage` creates, adds or un-stacks, verifies the exact PR branch chain and read-back, never merges or edits branches. Batch E is complete; G-4 (environment settings, deployments) is next.

**2026-10-11 — Implementation detail for faster Sol 5.6 execution (planning):**
`docs/implementation-contracts/IMPLEMENTATION-DETAIL.md` defines concrete JIT packets; `TOOL-RECIPES.md` maps
inspected helpers and test contracts; `REMAINING-WORK.md` adds edit sequences and regression anchors for the 41
non-merged units at baseline `ed60e19`; `G-4-PACKET.md` supplies a worked request/state/test map. Entry points link
them. No implementation card, queue, index status, owner input, runtime code or CI gate changed. E-2 (#46) and
G-3 part 2 (#45) were in flight at inspection; their implementers reconcile this guidance at the PR boundary.

**2026-10-11 — G-3 part 2, secrets (PR #45):** `github_secret_set` (Chris types the value on the private setup page via a link, or the server generates one), `github_secret_delete`, `github_secret_set_repo_access`; new table `secret_entry_requests`; values are sealed with GitHub's public key on the server and never stored, logged or shown to Claude. G-3 is complete; G-4 (environments and deployments) is next.

**2026-10-11 — G-3 part 1, variables and the secret list (PR #44):** `github_variable_list`, `_set`, `_delete` (repository, environment or organization; the old value is kept for undo) and `github_secret_list` (names and dates only, never values). Sealed secret entry through the setup page (part 2) is next; G-3 stays in progress until then.

**2026-10-11 — G-2 part 2, check, status, artifact and cache changes (PR #43):** `github_check_create_run` / `_update_run` (GitHub App only; a token is told so plainly), `github_status_create` (undo restores the previous state), `github_artifact_delete`, `github_cache_delete` (by id or exact key). Found and fixed a real bug class: a DELETE's extra parameters were sent as a body that GitHub ignores. G-2 is complete.

**2026-10-11 — G-2 part 1, check, artifact and cache reads (PR #42):** `github_check_get_ci_state` (the Batch E helper as a tool: each check and status, required or not, overall green / red / pending / unknown), `github_check_get_run` (with annotations), `github_artifact_list`, `github_artifact_get_link` (link only, never the file), `github_cache_list`. Creating checks and statuses and deleting artifacts/caches follow in part 2.

**2026-10-11 — G-1 part 2, Actions changes (PR #41):** `github_actions_set_workflow_enabled`, `_dispatch` (returns the run; production when the workflow file deploys to a production environment, or cannot be read), `_rerun`, `_cancel_run` (force needs confirm), `_delete_run`, `_review_pending_deployment` (owner's own sign-in). G-1 is complete.

**2026-10-11 — G-1 part 1, Actions reads (PR #39):** `github_actions_list_workflows/list_runs/get_run`, `github_actions_get_job_log` and `_get_run_logs_summary` (short form only: failed steps first, error lines, last lines; long encoded text never returned), `_list_pending_deployments`. Starting, rerunning, cancelling and approving follow in part 2.

**2026-10-11 — E-3 part 2, review changes (PR #38):** `github_review_create/submit/dismiss`, `github_review_reply`, `github_review_resolve_thread` (also reopens; no-op when already in that state), `github_review_request_reviewers`. Messages reaching outsiders ask first; an account approving its own pull request gets a plain explanation. E-3 is complete.

**2026-10-11 — E-3 part 1, review reads (PR #37):** `github_review_list`, `github_review_list_threads` (resolved/outdated, file and lines, latest comment; open threads only on request), `github_review_list_comments`. Review writes (create, submit, dismiss, reply, resolve, request reviewers) follow in part 2.

**2026-10-11 — D-3 branches and tags (PR #33):** `github_branch_list/get`, `github_tag_list` (reads; an empty `protected=` is never sent), `github_branch_create` (starts from the repository's real default branch), `_rename`, `_delete` (the default branch is always refused; the undo recreates it at the recorded commit), `_merge`, `github_tag_create` (lightweight or annotated) and `_delete` (tags are always production). Batch D is complete.

**2026-10-11 — D-2 part 2, file and ref changes (PR #32):** `github_content_put_file` / `_delete_file` (branch always named; refused if the file changed since the preview; undo restores the previous text), `github_content_push_files` (GitHub-signed commit, branch head checked), `github_commit_comment` (notifies mentioned outsiders), `github_git_update_ref` (compare-and-swap; dropping commits needs force and the preview counts them). D-2 is complete.

**2026-10-11 — D-2 part 1, code and commit reads (PR #30):** `github_content_get` (text, directory listing, binary files show size and link only, long text kept behind a handle), `github_content_get_tree` (real default branch, glob filter, GitHub's truncation reported), `github_content_get_archive_link` (the redirect link only), `github_content_check_codeowners` (line, column, kind and a plain fix; 'no CODEOWNERS file' is not 'no errors'), `github_commit_list/get/compare/list_prs` (patches cut at 1,500 characters per file), `github_git_get_ref`, `github_git_get_commit`. D-1 is merged (#27, #29).

**2026-10-11 — D-1 part 2, repository changes (PR #29):** create, create from template, settings (merge options are production), visibility (public names its risk), default branch, rename, archive, transfer, delete, fork, sync fork, custom properties, star. Delete and transfer cannot be undone; the others record how to undo them. All nine write-contract checks pass through every door for every tool. D-1 is complete.

**2026-10-11 — D-1 part 1, repository reads (PR #27):** `github_repo_list` (organization or user, archived filter, capped), `github_repo_get` (merge options, rules on the real default branch, custom properties), `github_repo_find` (searches only this connection's accounts; typed `user:`/`org:` qualifiers are stripped), `github_repo_get_insights` (GitHub's 202 'still computing' asked at most 3 times), `github_repo_get_traffic`, `github_repo_list_activity`, `github_repo_get_custom_properties`. Read tools now receive the credentials (before, only writes did). Tests: 13 new, 650 unit total green.

**2026-10-10 — C-2 listing modes, meta-tools, budgets (PR #26):** a connection now gets either the full catalog or a compact list (4 meta-tools, whoami, the result reader — 816 tokens today); the other listing can be asked for with `?listing=` on the endpoint. `github_search_tools`, `github_describe_tool`, `github_call` (runs any tool you may use, through exactly the same safety checks — every write-contract test now also runs through it) and `github_batch` (reads only). Budgets are enforced in CI with a pinned tokenizer; dangerous tools are listed with PRODUCTION / SPENDS MONEY first; every tool must declare its audience, checked against the catalog. Batch C is complete.

**2026-10-10 — C-1 small results (PR #25):** every read result is shaped, then cut to size: long text is cut at 4,000 characters (logs keep their last 400 lines), a result over 8 KB becomes a preview, and anything cut is kept whole for 24 hours behind a `res_…` handle that only the same connection can read with the new `github_get_result` (pages, fields, more text). 29 summary forms for GitHub objects, `defineRead` for new read tools, a 16th table `result_store`.

**2026-10-10 — B-8b diagnostics (PR #24):** `github_check_permissions` (compares each App installation's permissions with what 21 tool areas need and names the exact permission to add; fine-grained-token accounts are reported, not guessed), `github_rate_status` (what the server last saw, any block, and GitHub's live numbers; works even while a block is in force), `github_where_is_setting` (16 seeded settings GitHub has no API for, with link, numbered steps, what you should see and a read-back check where one exists). Batch B is complete.

**2026-10-10 — B-7 check-writes + first half of B-8 (PR #23):** the write-safety check now compares every registered tool with its row in the tool catalog (production, access, notify, spend, confirm, credential, profile) and fails a tool with no row or a spend tool with no price function; `defineWrite` takes a `price` function that decides what a paid change costs (a failure refuses). New tools: `github_list_connections`, `github_recent_changes` (reads), `github_set_default_account`, `github_revoke_connection` (writes, full profile). `github_set_spend_limit` is now confirm-always and full-profile as the catalog said. Connection "last used" is recorded. Not built yet: B-8b.

**2026-10-10 — A-5a credential store (PR #11):** every GitHub credential is encrypted at rest with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`), each value sealed with a context that ties
it to its account, App, installation and scope, so a copied ciphertext cannot be reused elsewhere; a wrong or missing key gives a plain message and never a secret. `createCredentials`
supplies the client's `token({ account, cred, scope })`: installation tokens minted with a hand-signed App JWT, cached until five minutes before expiry and downscoped per connection (each
scope its own token); the owner's user token refreshed ten minutes before expiry (a lost refresh race uses the other instance's new tokens, a refused refresh asks for sign-in again); a
fine-grained token for accounts that use one (cannot be narrowed — says so); the classic notifications token only for `K`. `storeApp` keeps the manifest flow's key, client secret and
webhook secret as ciphertext. One-time secrets (ten minutes, read-and-delete) and setup states (single use, bound to a purpose) are stored. `listAccounts` never returns ciphertext.
Also fixed A-4's test helper: nested body schemas now validate and JSON bodies are no longer type-coerced. Tests: 174 unit, database and request-shape suites green. No setup page yet (A-5b);
no real credential exists.

**2026-10-10 — A-4 GitHub client (PR #10):** `src/github/client.js` is the only file that imports `@octokit/*`. `githubFor(ctx, { owner, cred, scope })`
refuses an account outside the connection (`outside_scope`) or without a credential (`no_credentials`), sends `X-GitHub-Api-Version: 2026-03-10` on
every call, never retries a write (or a GraphQL mutation) after an error, spaces writes one second apart per installation across instances
(`claimWriteSlot`, one atomic statement), records GitHub's rate headers per account and resource and refuses calls while blocked with the
reset time in Denver time (`rate_limited`), honours `retry-after` only inside a 20-second budget, and can cache a polled read by ETag
(`request: { etag: true }`; a 304 returns the stored body). `requestKey` gives writes their retry-proof key; `listAll` follows `Link` to a cap and
says when it stopped. Vendored: GitHub's REST description for 2026-03-10 (rest-api-description @ 58b1e0c0, 1,232 operations) and GraphQL schema
(github/docs @ be38ec5d), each with `SOURCE.md`; `scripts/openapi-find.mjs` and `scripts/graphql-find.mjs` search them. The fake GitHub now knows every
operation and rejects any request that does not match the description (including unknown body fields) or any GraphQL document that does not match the
schema. The secret scan skips only the two vendored data files (their examples contain token-shaped text). Tests: 138 unit, 38 database, 15 request-shape.
No real GitHub call was made; no credential exists.

**2026-10-10 — A-3b connector login endpoints (PR #9):** `api/oauth/{register,authorize,token}`, `api/well-known/*` (rewritten
from `/.well-known/*` by `vercel.json`), `api/mcp.js`, `api/index.js`. Contract-generic `src/core/{http,oauth-handlers,mcp-auth,
mcp-server}.js` take an injected policy; the GitHub rules are in `src/oauth/policy.js`: the authorize page lists the accounts
(checkboxes + default), mode, profile, listing and the passphrase; **production is refused unless the deployment is the production
one and every selected account has `production_enabled`**; settings are examined only after the passphrase is right; a missing
`ADMIN_PASSPHRASE` fails closed; the code → token grant copies every connection setting from the issuing row, refresh rotates on the
same row. `/api/mcp` authenticates the bearer and lists the registry's tools (none yet); every `tools/call` is refused by the default
dispatcher until Batch B supplies a guarded one. `src/runtime.js` creates the schema once per instance. Tests: handler round trips,
production refusals, lockout, escaping, MCP over a local HTTP server, and one full flow on throwaway Postgres.
Nothing was run against a deployed server (none exists; IN-02).

**2026-10-10 — A-3a connector login store (PR #8):** `src/core/oauth.js` (copied from `stripe-mcp` @ 90a49c0: token hashing,
PKCE S256, redirect validation, client address, 5-failures-in-15-minutes lockout) with one fix — an empty submitted
passphrase used to crash the login check instead of counting as wrong (port back to the source and the hub core).
`src/db.js` gained `checkConnection` (refuses a connection with no accounts, a default outside the list, or an unknown
mode, profile or listing) and the store: clients, single-use codes, access tokens, atomic refresh on the same row for the
same client, revocation, login-attempt counting, `listAccountsForLogin`. Codes, tokens and client secrets are hashed. Fake
database mirrors it; one shared contract (`test/contract/oauth-contract.js`) runs against the fake and real Postgres.
Tests: `tests/unit/oauth-core.test.js`, `tests/unit/oauth-store.test.js`, `tests/db/oauth.test.js`. No endpoints yet (A-3b).

**2026-10-10 — A-2 foundation schema (PR #7):** `src/db.js` — `SCHEMA_TABLES` (13 tables), `CONNECTION_FIELDS` and
`connectionSettings(row)`, `productionSql()` (lazy Neon client, plain error when `DATABASE_URL` is missing, nothing at
import time), `createDb(sql)` → `{ initSchema(), listTables() }`; `initSchema()` runs the §2 `CREATE … IF NOT EXISTS`
statements one per call, in order (idempotent, no drops, no data). Fake database gained `initSchema`/`listTables`.
Tests: `tests/unit/schema.test.js`, `tests/db/schema.test.js` (exact table set, idempotence, defaults, keys, no plaintext
secret column). The two expiry timestamps `user_token_expires_at` / `user_refresh_expires_at` are allow-listed in that
scan. No Neon database exists yet (IN-02); nothing was run against a real one.

**2026-10-10 — CI cadence (docs + CI config PR #5):** never push while a PR's CI run is in progress (SESSION-START §6,
PLAYBOOK Step 5); obsolete PR runs are cancelled, runs on `main` never are. Next action unchanged.

**2026-10-10 — A-1 foundation merged (PR #1):** `package.json` (Node 24.x, pinned dependencies, lockfile), ESLint,
three Vitest suites (unit, db, shapes), `scripts/check-secrets.mjs` (scans tracked files for GitHub tokens, PEM keys,
non-local database URLs, Neon/Vercel identifiers, committed `.env`), `check-docs-updated`, `check-writes` and
`check-budgets` (starting form), `check-core-imports`, `count-catalog.py` and the index validator in `npm run check`;
`scripts/local-postgres-test.sh`; `test/helpers/fake-github.js`; CI jobs check, unit, db, shapes and the aggregate `ci`.
A deliberately failing test turned `unit` and `ci` red once (https://github.com/Robinson-AI-Systems/github-mcp/actions/runs/38077330755), then was removed; the final run is green at the
exact head (linked in PR #1). Actions pinned to `actions/checkout@v7` and `actions/setup-node@v7` (Node 24 runtimes). Cards A-2 and A-3
written.


**2026-10-10 — Gap check against prior toolkits (local commit):** every GitHub tool name Chris built or planned in
`robinsons-toolkit-mcp`, `robinsonai-mcp-servers` and `robinsons-toolkit-api` (528 names) mapped to this plan in
`docs/audits/2026-10-10-prior-tools.md`: 432 covered by hand-built tools, 59 by the universal tools, 34 dropped with
evidence (GitHub retired the endpoint, Enterprise-only, or out of scope), and 4 gaps added — `github_content_check_codeowners`,
`github_release_delete_asset`, `github_package_delete`, `github_security_compare_dependencies`. Catalog now 305 tools
(299 hand-built + 6 universal). Cortiware, oldReplit and Household-Assistant were checked for GitHub needs too.

**2026-10-10 — Plan completed (local commits):** process and acceptance files (PLAN, MASTER-ROADMAP, STATUS,
AI-PR-READ-FIRST, ARCHITECTURE, GO-LIVE-CHECKLIST, DECISIONS, ROADMAP, OWNER-GUIDE), the Appliance Desk profile
(`APP-NEEDS-APPLIANCE-DESK.md`, rows G1–G20), drift protocol and archive index. The catalog counter moved to
`scripts/count-catalog.py`; profile tools renamed `github_profile_*` so they no longer share a prefix with GitHub
Projects tools; a dated amendment lets a profile allow its own agent steps on an owned branch (Appliance Desk's
`transfer/**`).

**2026-10-10 — Plan written (initial commits):** AGENTS, START-HERE, SESSION-START, PLAYBOOK, research audit (GitHub API,
credentials, old toolkit's 311 tools and 20 bugs, official connector comparison), 15 batch designs, TOOL-CATALOG (301 tools:
295 hand-built + 6 universal, every name `github_…`), owner inputs IN-00 … IN-14, work index (64 cards since the old-toolkit decision note was dropped) with validator,
first card A-1.

## Blocked

Nothing in engineering. IN-00 and IN-01 answered; owner inputs IN-02 … IN-13 (`OWNER-INPUTS.md`; IN-14 answered: not needed)
are open and none blocks A-4.

## Unverified (each has an owner card)

- Paid security feature prices per active committer (O-4 §0 row O4) — read GitHub's pricing page before O-4 and H-4 merge.
- Whether Appliance Desk's `main` ruleset also blocks force pushes and deletion (APP-NEEDS row G3) — P-2 reads it.
- That `2026-03-10` is still the newest REST version when A-4 starts (BATCH-A §0 row A2).
