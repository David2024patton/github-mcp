# Design — Batch Y: Gap closure ("an agent can do anything I could do on github.com")

Status: **APPROVED DESIGN — implement from this document** (owner request, Chris, 2026-10-16: audit for capability
gaps and plan the missing work in enough detail that a smaller model can build it). Written 2026-10-16 against `main`
`d743313` (merge of #225) by Claude. Cards Y-1 … Y-9. Scope and acceptance: `docs/PLAN.md` → Batch Y.

**Owner correction 2026-10-16 — product capability versus development constraints.** Read [END-USER-AUTHORITY.md](../END-USER-AUTHORITY.md). Y3's historical default-$0 / "no provider ceiling" refusal applies to the developer's autonomous work, **not** as a permanent blocker on actual end users and their delegated agents. For unknown future metered charges, inform the end user that no maximum is guaranteed and honor that user's own chosen authorization/budget policy; where GitHub provides a supported write API, Y-9 must implement the callable action instead of leaving a website guide. Keep developer/test $0 and independent access/consent/security checks; this owner decision supersedes earlier conflicting product interpretations and is not acceptance evidence.

**Plain-English summary for Chris.** The server already has 310 tools and "universal" tools meant to catch everything
else. The audit found the universal tools are much narrower than advertised, and about 40 things you can do on
github.com that an agent still cannot. Batch Y closes them in nine cards, ordered so each card unlocks the next.
Three things need your decision (IN-15, IN-16, IN-17 in `docs/OWNER-INPUTS.md`); everything else can be built now.
Nothing in Batch Y turns production on, spends money, or relaxes any guard.

## 0. Verify before starting

| # | Assumption about the code | How to check |
|---|---|---|
| Y0-1 | `spendWords` regex in `src/github/operation-classes.js` line 5 makes `classifyUniversal(op).spendRisk` true for ~128 write operations (runners, retention, deployments, pages, packages, codespaces, copilot, billing, code-security) and `universalPrice` throws for them | `sed -n 1,16p src/github/operation-classes.js` |
| Y0-2 | `ownerFor()` in `src/tools/universal.js` (line 19) refuses any `owner/org/username/account` that is not in `c.connection.accounts` | `sed -n 19,28p src/tools/universal.js` |
| Y0-3 | `targetWrite()` in `src/tools/universal-graphql.js` (line 121) accepts only `updateProjectV2ItemFieldValue` with one `value`, or a mutation whose only change is a string `title` | `sed -n 121,138p src/tools/universal-graphql.js` |
| Y0-4 | `SCOPE_QUERY` (line 18) resolves only Repository, Issue, PullRequest, Discussion, Release, Milestone, Label, Commit, comments and ProjectV2 types | `grep -n SCOPE_QUERY src/tools/universal-graphql.js` |
| Y0-5 | `curated` in `src/github/mutation-classes.js` maps `changeUserStatus` to `github_account_update_profile`, which has no status support | `grep -n status src/tools/user-account.js` |
| Y0-6 | `MANIFEST_PERMISSIONS` in `src/github/app-manifest.js` lacks `packages`, `merge_queues`, `organization_packages`, `organization_self_hosted_runners`, the user permissions and others | `grep -n "packages\|merge_queues\|self_hosted\|followers\|profile" src/github/app-manifest.js` |
| Y0-7 | Registry is 310 tools; catalog check passes | `python3 scripts/count-catalog.py` |
| Y0-8 | Universal REST rejects `mediaType`, `headers`, `baseUrl` and non-JSON bodies (`reserved` set in `resolve()` of `universal.js`) | `grep -n reserved src/tools/universal.js` |

If any row is false, stop and report; the design may need amending.

## 1. Decisions (made — do not re-open)

**Y1. Fix the universal tools before adding tools.** Reason: one precise table (Y-1) unlocks many operations for free,
and a registry-consistency test prevents the "curated tool that does not exist" deadlock from returning. New hand-built
tools are only for things the universal route cannot do safely (money, secrets, cross-account, binary, multi-step logic).

**Y2. Per-route spend table, not a smarter regex.** `src/github/spend-classes.js` holds an explicit `FREE_ROUTES` set
keyed `"METHOD /path/template"`. `spendRisk` stays true for any operation matching `spendWords` unless its key is in the
set. Every key is checked against the vendored OpenAPI in a unit test (a typo cannot silently fail open) and the
total of still-blocked operations is pinned in a test (an accidental unlock turns CI red). Reason: the safe default
("a miss stays blocked") is the repository's rule (U-1); only reviewed routes move.

**Y3. Cost that cannot be computed is never guessed.** Operations that can raise a bill by an unknown amount (cache
and artifact retention increases, hosted runners, org code-security attach to private repositories, Copilot, Sponsors)
stay behind the spend guard: they run only when the account's spend limit is above $0 **and** the owner confirms, and
the preview says "cost not calculable". At the default $0 limit they are refused with the existing spend message.
Reducing a limit or retention is free and not blocked.

**Y4. GraphQL writes become spec-driven (Y-2).** `github_graphql_write` gains `WRITE_SPECS`, one reviewed entry per
mutation: how to find the owning repository/account, what the "before" and "after" read looks like, whether it has an
inverse, and its classification. A mutation without a spec stays refused ("use the specialised tool"). Reason: the
current two-shape rule makes the tool nearly useless; per-mutation specs keep the "independently verified read-back"
guarantee that U-2 was built on.

**Y5. Acting as the viewer on someone else's public object is a different shape from owning it.** Following a person,
starring/watching a repository and reading another account's public data target objects the connected account does not
own. These are hand-built tools (Y-3) with an explicit `actor`-only scope check: the *actor credential* (U) must be an
enrolled account; the *target* must be a public user/org/repo and is never written to. The universal tools keep
refusing non-enrolled owners (no weakening).

**Y6. No new secret ever passes through a tool.** Runner registration tokens and just-in-time runner configs are secrets:
Y-6 returns them only through the existing one-time page (`src/core/one-time-secrets.js`), never in a tool result.
Private-registry values, custom secret-scanning regex patterns that contain secret-like words, and credential-leak
reports are handled the same way or refused.

**Y7. Binary and large payloads go through server-side handles.** Upload sources are (a) a public HTTPS URL (existing),
(b) a workflow artifact on a repo the connection owns, downloaded server-side, (c) a stored result handle. Downloads
return a bounded text extract plus a handle, never raw bytes in a tool result.

**Y8. New tools are `full`-profile first.** The everyday catalog budget is 22,000 tokens (`scripts/check-budgets.mjs`).
Each card adds its tools to the `full` profile and to `everyday` only if the budget check still passes; otherwise they stay
`full`-only and are reachable through `github_search_tools` / `github_call`. Do not raise a budget without a DECISIONS entry.

**Y9. Adding GitHub App permissions is an owner action on github.com.** GitHub does not let an API change an existing
App's permissions, and an installation owner must accept each upgrade. The manifest change (Y-1) covers Apps created
later; for the existing App the server gives Chris an exact checklist (Y-1 WU-Y1b). No tool ever claims a permission
exists that the installation has not accepted.

**Y10. Money tools are decisions, not defaults.** Sponsors, hosted/larger runners, Copilot administration and premium
Copilot reports are built only after IN-16; until then they stay guided (`github_where_is_setting`) and the plan below
marks them `OWNER-GATED`.

## 2. Schema changes (additive only)

Only Y-6 and Y-8 add tables:

```sql
-- Y-6: pending one-time runner credentials are stored by the existing one_time_secrets table; no new table.
-- Y-8: async job tracking for slow GitHub operations (SBOM generation, code-scanning autofix, migrations, advisory forks).
CREATE TABLE IF NOT EXISTS gh_async_jobs (
  id text PRIMARY KEY,                 -- 'job_' + 16 random hex
  connection_id text NOT NULL,
  owner text NOT NULL,
  repo text,
  kind text NOT NULL,                  -- 'sbom' | 'autofix' | 'migration' | 'advisory_fork' | 'pages_build'
  provider_ref text,                   -- GitHub's uuid / number / id for polling
  state text NOT NULL DEFAULT 'pending', -- pending | ready | failed | expired
  result_handle text,                  -- result-store handle when ready
  detail text,                         -- plain-English status, <= 200 chars
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS gh_async_jobs_connection_idx ON gh_async_jobs (connection_id, state);
```

Add the table name to `SCHEMA_TABLES` in `src/db.js` and a row to `docs/ARCHITECTURE.md`. `tests/unit/schema.test.js`
already allows additive statements.

## 3. Shared primitives

**3.1 `src/github/spend-classes.js`** (Y-1)

```js
/** @type {ReadonlySet<string>} keys like 'POST /orgs/{org}/actions/runners/registration-token' */
export const FREE_ROUTES;
/** @param {{method:string,path:string}} op @returns {boolean} true when reviewed free */
export const isReviewedFree = (op) => FREE_ROUTES.has(`${op.method} ${op.path}`);
```

`classifyUniversal` sets `spendRisk: spendWords.test(s) && !isReviewedFree(op)`.

**3.2 `src/github/graphql-writes.js`** (Y-2) — see WU-Y2a for the shape of `WRITE_SPECS`.

**3.3 `src/tools/async-jobs.js`** (Y-8) — `startJob(ctx,{kind,owner,repo,providerRef,ttlMinutes})`,
`pollJob(ctx,id)` (calls GitHub at most once per call, never loops, respects the 50-second budget), `jobResult(ctx,id)`.
Tools never sleep: they return `{job_id, state:'pending', next:'call github_job_status'}`.

**3.4 `src/tools/public-read.js`** (Y-3) — shared by the cross-account read tools: allowlist of GET operations whose
path root is `/users/{username}`, public `/orgs/{org}` GETs and `/repos/{owner}/{repo}` GETs, resolved with the
connected U token when present, else the installation token; every result carries `untrusted: true` for free text
(bios, READMEs, issue bodies) and is capped by the normal 8 KB / handle rules.

## 4. Work units (in order; one commit each; each card = its WUs)

Conventions for every new tool (do not repeat per unit): built with `defineGithubWrite`/`defineRead`; name starts with
`github_`; description ≤160 characters; passes the nine write-contract checks through all three doors for writes;
request shapes validated by the fake GitHub against the vendored description; row added to `docs/TOOL-CATALOG.md`
(counted by `scripts/count-catalog.py`) and the area entry in `src/data/permission-needs.js`; summaries added in
`src/tools/summaries.js`; `npm run check` passes (budgets included). Reads take `fields` and `detail`.

### Card Y-1 — Unblock the universal tools and fix the contradictions (L)
Closes: audit findings 1–6 (bugs), gaps 4, 10 (partly), 11 (partly), 13, 14, 21 (partly).

#### WU-Y1a — Per-route spend table
Files: `src/github/spend-classes.js` (new), `src/github/operation-classes.js`, `tests/unit/spend-classes.test.js` (new).
Change: create `FREE_ROUTES` with exactly these reviewed-free keys (verify each with `node scripts/openapi-find.mjs`):
runner management on organizations **and** repositories — `GET/DELETE .../actions/runners[/{runner_id}]`,
`POST .../actions/runners/registration-token`, `POST .../actions/runners/remove-token`,
`POST .../actions/runners/generate-jitconfig`, `GET/POST/PUT/DELETE .../actions/runners/{runner_id}/labels[/{name}]`
(self-hosted runners cost nothing to GitHub); runner groups — `POST/PATCH/DELETE /orgs/{org}/actions/runner-groups[/{id}]`,
`PUT/POST/DELETE .../runner-groups/{id}/repositories[/{repo_id}]`, `PUT/POST/DELETE .../runner-groups/{id}/runners[/{runner_id}]`;
`PUT /orgs/{org}/actions/permissions/self-hosted-runners` and `.../selected-repositories`;
`PUT /repos|orgs/.../actions/oidc/customization/sub`, `POST/DELETE /orgs/{org}/actions/oidc/customization/properties/repo[/{name}]`;
`POST /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments` and `.../deployment_protection_rule`;
`POST/DELETE /repos/{owner}/{repo}/environments/{environment_name}/deployment_protection_rules[/{id}]`;
`DELETE /user|orgs/.../packages/{package_type}/{package_name}[/versions/{id}]` and the `/restore` routes (deleting never adds cost);
`POST /repos/{owner}/{repo}/pages/builds`; org artifact-metadata record routes.
**Do not** add: hosted runners, runner images, cache/artifact retention and storage-limit routes (Y3 rule), Codespaces, Copilot,
Copilot Spaces, billing, code-security configuration routes, Marketplace.
Tests: (1) every key exists in the vendored description (use `restOperation` lookup helpers in `src/github/openapi-index.js`);
(2) `classifyUniversal` returns `spendRisk:false` for each key and `true` for a representative blocked route per excluded family;
(3) pinned count: `blockedCount === <number printed by the test the first time, then committed>`; changing it needs a DECISIONS line.
Done when: `universalPrice` no longer throws for the free keys; the three-door write test for `github_api_write` still passes for one free key.

#### WU-Y1b — App permissions and the permission checklist
Files: `src/github/app-manifest.js`, `src/data/permission-needs.js`, `src/data/dashboard-sections.js` (+ `dashboard-map.js` if the page id is new), `src/tools/server-diagnostics.js` (`github_check_permissions`), `tests/unit/app-manifest.test.js`, `tests/unit/diagnostic-tools.test.js`.
Change: add to `MANIFEST_PERMISSIONS` (each name must exist in the vendored `app-permissions` schema; the existing test enforces it):
repository — `packages: write`, `merge_queues: write`, `repository_advisories: write` (only if present in the schema; otherwise note "needs
`security_events`" and skip), `artifact_metadata: write`; organization — `organization_packages: write`,
`organization_self_hosted_runners: write`, `organization_events: read`, `organization_custom_roles: read` (if present); user —
`email_addresses: read`, `git_ssh_keys: read`, `gpg_keys: read`, `profile: write`, `followers: write`, `starring: write`, `interaction_limits: write`
(ONLY if the manifest endpoint accepts user permissions; the file's header comment says it does not yet request them, and the vendored schema says whether a
`default_permissions` user key is valid. If it is rejected, record that in DECISIONS and keep the OAuth user route (cred `U`) as the way to reach them).
Add `permission-needs` rows: `packages` (area packages: `{packages:'write', organization_packages:'write'}`), `runners`, `merge-queue`.
Add a guided setting `app-permissions-review` listing, per account, the exact permission names to approve on github.com → Settings → Developer
settings → GitHub Apps → *the App* → Permissions & events, plus "then accept the new permissions on each installation".
`github_check_permissions` (server-diagnostics) compares the **stored installation permissions** (already saved at install time) with `permission-needs`
and reports `missing` / `requested_not_accepted` per area; it must never say "ok" for a permission absent from the stored map.
Tests: manifest names ⊆ schema; every permission-needs name ⊆ manifest; `check_permissions` with a fake installation lacking `packages` reports `missing`.
Done when: `github_check_permissions` names the packages gap in a fixture, and `docs/GO-LIVE-CHECKLIST.md` has an owner row "Approve the new App permissions" (IN-15).

#### WU-Y1c — Registry consistency test and the status deadlock
Files: `tests/unit/registry-consistency.test.js` (new), `src/tools/user-account.js`, `src/github/mutation-classes.js`, `src/github/hand-built-map.js`.
Change: the test imports `curated` targets from `mutation-classes.js` (export a read-only `curatedTargets()` helper) and every `maps` entry from `hand-built-map.js`, and asserts each tool name is in the registry.
Add `github_account_set_status` (cred `U`, safety: writes, notifies:false) using GraphQL `changeUserStatus(input:{emoji,message,expiresAt,limitedAvailability,organizationId})`;
`message` ≤80 chars; `expiresAt` ISO-8601 and in the future; clearing = empty message and no emoji. Read-back: `viewer{status{emoji message expiresAt indicatesLimitedAvailability}}` compared field by field. Inverse: previous status read before the write.
Point `changeUserStatus` in `curated` at `github_account_set_status`.
Tests: the registry test; write-contract nine checks; request shape for `changeUserStatus`.
Done when: `changeUserStatus` via `github_graphql_write` says "use github_account_set_status" and that tool exists.

#### WU-Y1d — Truth in the docs
Files: `docs/TOOL-CATALOG.md` (universal section), `docs/OWNER-GUIDE.md`, `src/data/dashboard-sections.js` notes on gists/follow.
Change: state plainly what the universal tools cannot do (non-enrolled owners, non-JSON, spend-routes not in `FREE_ROUTES`), and that gist routes need `cred:'U'` (`/gists/*` has no `/user` prefix so the default credential `I` cannot reach it).
Done when: no document says follow is "universal" until Y-3 ships it.

### Card Y-2 — Spec-driven GraphQL writes (L) — the hardest card
Closes: gaps 16 (pins), 17 (partly), 18 (partly), 20, 21, long tail of GraphQL-only mutations. Depends on Y-1.

#### WU-Y2a — The spec table
Files: `src/github/graphql-writes.js` (new), `tests/unit/graphql-writes.test.js` (new).
Shape (literal):

```js
/**
 * @typedef {Object} WriteSpec
 * @property {'repo'|'org'|'user'|'viewer'} scope     where ownership is proven
 * @property {Record<string,'Repository'|'Issue'|'PullRequest'|'Discussion'|'DiscussionComment'|'IssueComment'|'Organization'|'User'|'Team'|'Gist'|'UserList'|'ProjectV2'|...>} ids  input key → node type that must resolve inside `scope`
 * @property {string[]} changes                       input keys that are real changes (all others are ids/client ids)
 * @property {string} before                          GraphQL selection on the node, run before the write ("{ ... on Issue { pinned } }")
 * @property {(input:object, after:object, before:object)=>boolean} verify  pure; true only if `after` shows the requested change
 * @property {null|((input:object, before:object)=>{mutation:string,input:object})} inverse
 * @property {{production:boolean, accessWidening:boolean, notifies:boolean, destructive:boolean}} cls
 */
export const WRITE_SPECS = new Map([...]);
```

Initial entries (each one is one unit test: happy, wrong-owner refused, verify-false → "not confirmed", inverse):
`pinIssue`/`unpinIssue` (before `... on Issue { isPinned }`; at most 3 pinned: read `repository{pinnedIssues(first:4){totalCount}}` first and refuse with the plain message if already 3),
`pinIssueComment`/`unpinIssueComment`, `lockLockable`/`unlockLockable` (`locked`, `activeLockReason`), `minimizeComment`/`unminimizeComment` (`isMinimized`, `minimizedReason`; classifier `ABUSE|OFF_TOPIC|OUTDATED|RESOLVED|DUPLICATE|SPAM`; cls.notifies:false),
`closeDiscussion`/`reopenDiscussion`, `updateDiscussion` (changes: title/body/categoryId; verify each given key), `updateDiscussionComment`, `deleteDiscussion`/`deleteDiscussionComment` (destructive, no inverse: say so),
`markDiscussionCommentAsAnswer`/`unmark…`, `convertPullRequestToDraft`/`markPullRequestReadyForReview` (`isDraft`),
`createLinkedBranch`/`deleteLinkedBranch` (verify through `issue{linkedBranches}`), `updateIssueComment` and `deleteIssueComment` (`deleteIssue`: destructive, requires `confirm` AND the repository admin check below),
`updateTeamReviewAssignment` (scope org; `Team` id; verify `reviewRequestDelegationEnabled`), `addReaction`/`removeReaction` (only if not already in `issues-reactions-write.js`; otherwise do not duplicate).
`scope:'repo'` specs reuse the existing `scopedNode()` ownership check; `scope:'org'|'user'` check `login` equals an enrolled account; `scope:'viewer'` requires `cred:'U'` and compares `viewer.login`.
Done when: ≥ 24 mutations have specs and the 'unknown mutation → refused' test still passes.

#### WU-Y2b — Make `targetWrite` and the baseline/verify steps spec-aware
Files: `src/tools/universal-graphql.js`, `tests/unit/universal-graphql.test.js`.
Change: in `targetWrite`, after `classifyGraphqlMutation`, look up `WRITE_SPECS.get(entry.mutation)`. If found, build `node` from `spec.ids`, **extend `SCOPE_QUERY` with
`... on Organization { login } ... on User { login } ... on Team { slug organization { login } } ... on UserList { user { login } } ... on Gist { owner { login } }`** and use `spec.before` as a second read.
Keep the two legacy shapes working unchanged for mutations without a spec. After the write, run `spec.before` again and call `spec.verify(input, after, before)`; a false result returns
"GitHub accepted the change but the read-back does not show it" (same wording as today) and does **not** log an inverse. Concurrent change protection: if `before` differs from the
snapshot taken in the preview step the write refuses with "changed since preview" (copy the Project-field logic in `baseline()`).
Classification comes from `spec.cls`, overriding `classifyGraphqlMutation` defaults only toward more caution (never less).
Tests: for every spec the three-door write-contract helper; a mutation whose spec `verify` is stubbed to false is reported unconfirmed; ids from a different account are refused; viewer scope with `cred:'I'` is refused.
Done when: `github_graphql_write` can pin an issue on the fake GitHub end to end, and unknown mutations are still refused.

#### WU-Y2c — Undo integration
Files: `src/tools/undo.js`, `src/core/write.js` (inverse recording only), tests.
Change: specs with `inverse` record `{mutation,input}` in the change log as a universal inverse; `github_undo_change` replays it through `github_graphql_write` (same guards). Specs without inverse say so, with the right opposite action in words.
Done when: pin → undo → unpinned in a test.

### Card Y-3 — Other people's data and social actions (M)
Closes: gaps 1–7. Depends on Y-1 (status tool) and Y-2 (scope helpers).

#### WU-Y3a — Public reads of any account
Files: `src/tools/public-read.js` (new), `src/tools/users-public.js` (new), `tests/unit/public-read.test.js`.
Tools (all `writes:false`, cred auto: U if enrolled else I): `github_user_get(username)` → `GET /users/{username}`; `github_user_list_repos(username, type, sort, per_page)` → `GET /users/{username}/repos`;
`github_user_list_social(username)` → `GET /users/{username}/social_accounts`; `github_user_list_followers(username)` / `github_user_list_following(username)` → `GET /users/{username}/followers|following`;
`github_public_repo_get(owner, repo)` → `GET /repos/{owner}/{repo}` plus `GET .../readme` summary (capped; `untrusted:true`); `github_public_repo_list(owner, kind)` for contents/releases/issues/pulls lists of a **public** repo.
Rule: only `GET`, only the allowlisted path roots above; a private or not-found repo answers "not found or no access" (never reveals which). Free text fields (bio, description, readme) are marked untrusted and length-capped.
Rate: these reads use the same rate state as other reads; the credential is chosen by `credentialFor('read')`.
Tests: foreign owner allowed for reads; same tools refused when the path is not on the allowlist (e.g. `/repos/other/x/hooks`); untrusted marking present; 404 never says "private".

#### WU-Y3b — Follow, star lists, watching, social links, status already done
Files: `src/tools/social-write.js` (new), `tests/unit/social-write.test.js`.
Tools (writes, cred **U**, `notifies:true` for follow because the other person is notified; star list tools `notifies:false`):
`github_user_follow(username, follow:boolean)` → `PUT|DELETE /user/following/{username}`; preview text "Follow <user> (they will be notified)". Read-back: `GET /user/following/{username}` expects 204 (followed) or 404 (not followed). Inverse: opposite. Requires `people` guard: following is a message to an outsider → needs `confirm` (reuse `people-guard.js` with the target as the recipient). Org follow uses `GET /user/following/{org}` and the same PUT.
`github_star_list_manage(action, name, description, isPrivate, listId, repo)` → GraphQL `createUserList|updateUserList|deleteUserList|updateUserListsForItem`; ownership = `UserList.user.login` equals the U account (WU-Y2a scope `user`); `deleteUserList` has no inverse (destructive; says so). Read-back via `viewer{lists(first:50){nodes{id name description isPrivate}}}`.
`github_star_list_get` read: lists and their repositories.
`github_repo_watch(owner, repo, subscribed, ignored)` → `PUT|DELETE /repos/{owner}/{repo}/subscription` (cred U; works without the classic notifications token K). Read-back `GET .../subscription`.
`github_user_set_social(links[])` → `POST|DELETE /user/social_accounts` (urls only; https; ≤4); read-back `GET /user/social_accounts`.
Write contract: all four register through `defineGithubWrite`; `target` for follow = `{scope:'viewer', owner: <enrolled U login>}`; add the new `kind:'actor'` to `src/core/write.js` target kinds ONLY IF the existing kinds cannot express it (check `kind: 'user'` first; prefer reuse).
Tests: nine checks ×4 tools; follow refuses when no U token ("connect your GitHub user sign-in"); follow of oneself refused.
Done when: catalog rows exist and Y-1 WU-Y1d's "universal follow" wording is removed.

### Card Y-4 — Projects v2 lifecycle (L)
Closes: gap 15. Depends on Y-2 (`ProjectV2` ownership scope for Organization/User owners).

#### WU-Y4a — Project container tools
Files: `src/tools/projects-manage.js` (new), `tests/unit/projects-manage.test.js`, `tests/shapes/projects-manage-shapes.test.js`.
Tools: `github_project_create(owner, title, template_of?, visibility)` → `createProjectV2` (ownerId resolved by `organization(login:){id}` / `user(login:){id}`; read-back `node(id){... on ProjectV2{title public closed}}` plus the project appearing in `github_project_list`);
`github_project_update(project, title, shortDescription, readme, public, closed)` → `updateProjectV2` (changing `public:true` is **accessWidening** → `confirm` + production-guard class; read-back each given field);
`github_project_copy(project, owner, title, includeDraftIssues)` → `copyProjectV2`; `github_project_delete(project)` → `deleteProjectV2` (destructive, requires `confirm` and typing the exact title as `confirmTitle`; no inverse; says "restore is not possible");
`github_project_link(project, repo|team, link:boolean)` → `linkProjectV2ToRepository|linkProjectV2ToTeam|unlink…`.
Rules: owner must be an enrolled account (org via `A` installation or user via cred U — user-owned projects need U, reuse the explanation in `projects-read.js`); the project node's `owner.login` is re-checked from GitHub, not trusted from input; ≤1 create per request key.

#### WU-Y4b — Fields, views, items
Files: `src/tools/projects-fields.js` (new), `src/tools/projects-items.js` (new), tests.
Tools: `github_project_field_save(project, field?, name, dataType, options[]|iteration config)` → `createProjectV2Field` / `updateProjectV2Field`; `github_project_field_delete(project, field)` → `deleteProjectV2Field` (destructive, drops stored values: preview states how many items have a value, read from `items(first:100)` count);
`github_project_view_save(project, name, layout)` → `createProjectV2View`/`deleteProjectV2View` only (layout edits, grouping, charts and workflows are **web-only**; the tool says so and points to `github_where_is_setting`);
`github_project_add_draft(project, title, body, assignees[])` → `addProjectV2DraftIssue`; `github_project_convert_draft(item, repo)` → `convertProjectV2DraftIssueItemToIssue`; `github_project_archive_item(item, archived:boolean)` → `archiveProjectV2Item|unarchiveProjectV2Item`; `github_project_move_item(item, afterItem?)` → `updateProjectV2ItemPosition`; `github_project_clear_field(item, field)` → `clearProjectV2ItemFieldValue`; `github_project_delete_item(item)` (destructive; removes from project only — the issue itself stays);
`github_project_status_update(project, status, startDate, targetDate, body)` → `createProjectV2StatusUpdate` (notifies members → people guard).
Field-option edits: single-select options are replaced as a whole by `updateProjectV2Field`; the tool reads current options first and merges so existing option ids (and item values) survive — this is the tough part: **never send an option list that omits an existing option unless the caller passes `removeOptions:[names]`**, otherwise items lose their value. Tests: merge keeps ids; omitting an option without `removeOptions` keeps it.
Tests for all: nine checks, shapes against the vendored GraphQL schema (`node scripts/graphql-find.mjs <name>`), ownership refused for a foreign project.

### Card Y-5 — Moderation, issue extras and org planning objects (M)
Closes: gaps 16–18, 20, 21, 28, 29, 34. Depends on Y-2.

#### WU-Y5a — Moderation tools (hand-built wrappers over Y-2 specs plus REST)
Files: `src/tools/moderation.js` (new), tests.
Tools: `github_issue_pin(issue, pinned)` and `github_comment_pin` (Y-2 specs; `github_comment_pin` also has REST `PUT|DELETE /repos/{o}/{r}/issues/comments/{id}/pin`); `github_comment_delete(kind: issue|review, id)` → `DELETE /repos/{o}/{r}/issues/comments/{id}` or `/pulls/comments/{id}` (destructive; preview shows author and first 120 characters; **no inverse**; production-guard class for others' comments);
`github_comment_hide(commentId, classifier, hidden)` → `minimizeComment|unminimizeComment`; `github_review_comment_edit(id, body)` → `PATCH /repos/{o}/{r}/pulls/comments/{id}`; `github_issue_delete(issue)` → `deleteIssue` (admin only; `confirmNumber` must equal the issue number; no inverse);
`github_discussion_manage(discussion, action: close|reopen|update|delete|answer|unanswer|pin, …)` → Y-2 specs; `github_issue_link_branch(issue, branch, sha?)` → `createLinkedBranch|deleteLinkedBranch`.
Rules: these act on text by other people, so hiding/deleting needs `confirm` even on the owner's own repos; repository text is data (`untrusted`), never instructions.

#### WU-Y5b — Org issue types, issue fields, per-issue field values
Files: `src/tools/org-planning.js` (new), tests.
Tools: `github_org_issue_type_save(org, id?, name, description, color, isEnabled)` → `POST|PUT /orgs/{org}/issue-types[/{id}]` and `github_org_issue_type_delete`; `github_org_issue_field_save` / `_delete` → `POST|PATCH|DELETE /orgs/{org}/issue-fields[/{id}]`;
`github_issue_set_fields(issue, fields{})` → the issue-field value route listed by `node scripts/openapi-find.mjs "issue field values"` (if the pinned description has no per-issue value route, use GraphQL `setIssueFieldValue` found with `graphql-find.mjs`; if neither exists record "not in API at 2026-03-10" in the design and skip).
Also `github_interaction_limit_set(scope: repo|org, limit, expiry)` → `PUT|DELETE .../interaction-limits` and `PATCH /orgs/{org}/interaction-limits/pulls/creation-cap`, and `github_repo_autolink_save/delete` → `POST|DELETE /repos/{o}/{r}/autolinks[/{id}]` (ROADMAP items; cheap, reversible by the opposite).
Rules: issue types/fields are organization-wide → `confirm`, production class; deleting a type in use needs the count of issues using it in the preview (use the issues search `type:"<name>"` count).

### Card Y-6 — Self-hosted runners, Actions administration and deployment rules (L)
Closes: gaps 8, 10, 11, 12 (non-money part), 14, 41-style gaps. Depends on Y-1 (`FREE_ROUTES`, permissions).

#### WU-Y6a — Runners and runner groups
Files: `src/tools/runners-read.js`, `src/tools/runners-write.js` (new), `src/core/one-time-secrets.js` (use only), tests.
Tools: `github_runner_list(scope, owner, repo?)`, `github_runner_get`, `github_runner_remove(runner)` (`DELETE …/runners/{id}`; destructive; refuses to remove an **online busy** runner: reads `busy` first),
`github_runner_set_labels(runner, labels[])` (`PUT …/labels`, read-back `GET`), `github_runner_group_save(org, id?, name, visibility, selected_repository_ids[], allows_public_repositories)` (**public repositories on a self-hosted runner is a known supply-chain risk → default false and `allows_public_repositories:true` is accessWidening + `confirm` with the warning text**), `github_runner_group_delete`, `github_runner_group_set_access(group, repositories[]|runners[])`,
`github_runner_register(scope, owner, repo?, kind: registration|remove|jit, name?, labels?, runnerGroupId?)`.
**Tough part — secrets:** `registration-token`, `remove-token` and `generate-jitconfig` return secrets. The tool never returns them: it calls GitHub, seals the value with `src/github/secret-seal.js`, stores it in the existing one-time-secret table with a 1-hour expiry, and returns `{one_time_url, expires_at, hint:'run on the target machine: ./config.sh --url … --token <paste>'}`. The change log stores only `{kind, scope, runner_name, token_last4:false}` (no token characters at all). The key-scan test must show no token string in logs, change log or results.
Tests: nine checks; token never appears in any result/log (fake returns `AFAKE_TOKEN_123`, assert absence everywhere); public-repo group opt-in needs confirm; busy runner refused.

#### WU-Y6b — Actions limits, OIDC, deployment protection rules, pending deployments
Files: `src/tools/actions-write.js` (extend `github_actions_set_settings`), `src/tools/environments-policies.js` (extend), `src/tools/deployments-write.js` (extend), tests.
Change: `github_actions_set_settings` gains `artifactAndLogRetentionDays` (`PUT …/permissions/artifact-and-log-retention`), `cacheRetentionDays` and `cacheStorageLimitGb` (`PUT …/actions/cache/retention-limit|storage-limit`), `oidcSubTemplate` (`PUT …/oidc/customization/sub`), `selfHostedRunnerPermissions`. **Spend rule (Y3):** a value *lower than or equal to* the current one is free; a higher one is spend-classed with preview "cost not calculable" and blocked at a $0 limit. The tool reads the current value first (every setting has a GET).
New `github_env_protection_rule_save(env, appId|slug, enable:boolean)` → `POST|DELETE …/environments/{env}/deployment_protection_rules[/{id}]` (read `GET …/deployment_protection_rules/apps` to list available integrations; refuse an app not in that list). New `github_deploy_review_pending(run, environments[], state: approved|rejected, comment)` → `POST …/runs/{id}/pending_deployments` (production class: approving a deployment to a production environment needs `confirm` AND a production connection; reads the pending list first and refuses an environment that is not waiting). `github_deploy_review_custom_rule(run, environmentName, state, comment)` → `POST …/runs/{id}/deployment_protection_rule`.
`github_pages_build_request(repo)` → `POST …/pages/builds` (free) with `github_pages_get_build` (latest) for the read-back; a pages deployment from an artifact (`POST …/pages/deployments`) is added only if `openapi-find "pages deployment"` shows it — priced as free.
Tests: increase blocked at $0 limit and allowed with limit>0 + confirm; decrease allowed; approving into production on a preview connection refused; unlisted app refused.

### Card Y-7 — Security writes (L)
Closes: gaps 9, 23–27. Depends on Y-1, Y-8 (jobs) for async parts — implement the synchronous tools first; the async tools are marked "after Y-8" below.

#### WU-Y7a — Repository security advisories
Files: `src/tools/advisories.js` (new), tests.
Tools: `github_security_advisory_save(repo, ghsa?, summary, description, severity|cvss_vector_string, vulnerabilities[], cwe_ids[], credits[])` → `POST|PATCH /repos/{o}/{r}/security-advisories[/{ghsa}]` (draft only; PATCH of a **published** advisory is allowed only for non-state fields);
`github_security_advisory_publish(repo, ghsa)` → `PATCH … state:"published"`: public disclosure, irreversible → production-class, `confirm`, typed `confirmGhsa`; preview lists what becomes public (summary and affected versions only, not the description text);
`github_security_advisory_request_cve(repo, ghsa)` → `POST …/cve` (starts a CVE reservation, irreversible); `github_security_advisory_private_fork(repo, ghsa)` → `POST …/forks` (async, returns the fork name; note to Y-8); `github_security_report_vulnerability(repo, …)` → `POST …/security-advisories/reports` (a report to **someone else's** repo: people guard `message` class, `confirm`).
Rules: advisory text is sensitive; results return ids, states and counts, never the full description (capped detail on request, marked untrusted, never put in the change log beyond a SHA-256 of the body).
Tests: nine checks; publish without `confirmGhsa` refused; description never in the log.

#### WU-Y7b — Code scanning, secret scanning, Dependabot org settings
Files: `src/tools/code-scanning.js` (new), `src/tools/secret-scanning-extras.js` (new), `src/tools/security-settings-write.js` (extend), tests.
Tools: `github_security_code_scanning_default_setup(repo, state, languages[], query_suite, runner_type)` → `PATCH …/code-scanning/default-setup` (returns a run id; poll `GET` — async after Y-8; cost: free on public, GHAS on private → reuse the **H-4 price function** and spend-guard exactly as `github_security_set_feature` does);
`github_security_secret_pattern_save(scope, name, pattern, test_strings…)` → org/repo custom patterns routes (`openapi-find "secret scanning custom pattern"`): **tough part** — the regex text can look like a secret to our own scanner; the tool accepts it only as `pattern` (allow-listed field name in `assertUniversalAuthority`'s key scan: add `pattern` to the exception list for this tool only, with a test proving other tools still refuse it); push-protection bypass review `github_security_bypass_review(request, decision)`;
`github_security_dependabot_org_settings(org, repositoryAccess, defaultLevel)` → `PATCH /orgs/{org}/dependabot/repository-access`, `PUT …/default-level`.
Autofix (`github_security_autofix(alert)`, `POST …/alerts/{n}/autofix`, commit via `…/autofix/commits`) after Y-8.
Tests: nine checks; price-guard test for private repo default setup; pattern allow-list scoped to this tool.

#### WU-Y7c — Org code-security configurations
Files: `src/tools/security-config.js` (new), tests.
Tools: `github_security_config_save(org, id?, name, settings{})` → `POST|PATCH /orgs/{org}/code-security/configurations[/{id}]`; `github_security_config_attach(org, id, scope: all|all_without_configurations|public|private_or_internal|selected, repositoryIds[])` → `POST …/{id}/attach` (async; poll `GET …/{id}/repositories`); `github_security_config_default(org, id, newRepos)`; `github_security_config_detach`; `github_security_config_delete`.
Spend: attach to private repositories enables paid features → priced by the same function as H-4 (per active committer) × number of private repos in scope; blocked at the default $0 limit. Access: org-wide security change → `confirm`.
Tests: price math table; attach to `public` free; `all` blocked at $0.

### Card Y-8 — Binary data, artifacts, archives, wiki and async jobs (L)
Closes: gaps 33, 37–40; unblocks async parts of Y-7. Adds `gh_async_jobs`.

#### WU-Y8a — Async job primitive
Files: `src/tools/async-jobs.js` (new), `src/db.js`, `tests/db/async-jobs.test.js`, `tests/unit/async-jobs.test.js`.
Change: per §3.3. Tools `github_job_status(job_id)` and `github_job_cancel(job_id)` (local only). A job expires after 24 h; polling more than once per 10 seconds returns the cached state. Used by: SBOM, autofix, advisory fork, Pages build, org migration, code-scanning default setup.
Tests (db): two connections cannot read each other's jobs; expiry; poll rate limit.

#### WU-Y8b — Read artifact contents and archives
Files: `src/tools/artifacts-read.js` (new), tests.
Tools: `github_artifact_read(artifact, path?, maxBytes)` — downloads `GET /repos/{o}/{r}/actions/artifacts/{id}/zip` **server-side** (follow the 302 to the blob host; the redirect URL is never returned), unzips with a bounded streaming reader (reject > 50 MB compressed, > 200 MB expanded, > 500 entries, zip-slip paths, symlinks), returns the entry list, and for a requested text entry up to `maxBytes` (default 8 KB, else a handle). Binary entries return only name, size and SHA-256.
`github_content_read_archive(repo, ref, path?)` — same limits for tarball/zipball (`GET /repos/{o}/{r}/tarball|zipball/{ref}`).
`github_security_export_sbom(repo)` → `GET …/dependency-graph/sbom` (synchronous form, result handle) and the async `generate-report` / `fetch-report/{uuid}` pair through a job.
Dependency: a zip reader. Decision: use Node's built-in `node:zlib` with a ~120-line central-directory parser in `src/core/zip-reader.js` (no new dependency); unit-test with fixtures built in the test (stored and deflated entries, a zip-slip name, a bomb).
Tests: bomb refused; zip-slip refused; text entry returned and capped; fake GitHub serves a redirect.

#### WU-Y8c — Release assets from artifacts and uploads.github.com
Files: `src/tools/releases-assets.js` (extend), `src/github/client.js` (a narrow `uploadReleaseAsset()` only), tests.
Change: `github_release_upload_asset` gains `source: {url} | {artifact: id, entry?} | {handle}`; for artifact sources the server downloads, picks the entry (or the whole zip), then `POST https://uploads.github.com/repos/{o}/{r}/releases/{id}/assets?name=` with the right `Content-Type` and length. `client.js` gains the **only** non-api.github.com host allowance, a constant `UPLOADS_HOST` and a test that no other host is reachable. Size limit 200 MB. Production class (release), `confirm`; read-back: `GET …/releases/{id}/assets` shows name, size and `state:"uploaded"`; mismatch → report unconfirmed. Inverse: delete the asset.
Tests: size cap; wrong host refused; read-back mismatch reported.

#### WU-Y8d — Wiki (OWNER-GATED, IN-17)
Files: `src/tools/wiki.js` (new), `package.json` (only after IN-17), tests.
Design: the wiki is the git repository `https://github.com/{owner}/{repo}.wiki.git`; no REST API exists. Tools `github_wiki_list`, `github_wiki_read(page)`, `github_wiki_write(page, body, message)` use `isomorphic-git` with an in-memory filesystem (`memfs`) over `http` with the installation token (basic auth `x-access-token`), shallow clone (`depth:1`), one commit and push per write, max 200 pages / 5 MB. Pages are Markdown only; the tool refuses paths with `..`. Needs repository `contents` permission and the wiki enabled (`github_repo_update_settings has_wiki`). **Stop-and-ask:** adding two dependencies. If Chris declines, ship only a guide entry ("edit the wiki in the browser") and mark the gap accepted.
Tests: an in-memory git server fixture (`isomorphic-git` can serve a local bare repo in tests) — write then read returns the page; traversal refused.

### Card Y-9 — Org administration long tail, read-backs and guides (M)
Closes: gaps 30, 32, 35, 36 (partly), web-only list (section G), read-back improvement. Depends on Y-2.

#### WU-Y9a — Remaining org tools
Files: `src/tools/org-admin-extras.js` (new), tests.
Tools: `github_org_security_manager_set(org, team, enabled)` → `PUT|DELETE /orgs/{org}/security-managers/teams/{team_slug}` (access-widening; `confirm`); `github_org_network_config_*` (`/orgs/{org}/settings/network-configurations`, read + save; free but needs Enterprise Cloud plan → answers `not_available_on_plan`); `github_org_migration_start/status` (`POST /orgs/{org}/migrations`, async job; archive download is a **handle to a server-side stream capped at 100 MB** or refused with instructions);
`github_credential_report_leak(text)` is **not built**: the endpoint `POST /credentials/revoke` receives the secret itself, which violates "secrets never pass through a tool"; record the decision and the manual path (revoke on github.com) in `github_where_is_setting`.

#### WU-Y9b — Read-backs for guided settings
Files: `src/data/dashboard-sections.js`, `src/tools/admin-guided.js`, tests.
Change: today only org 2FA has a read-back in `github_admin_check_setting`. Add `readback` entries (method + path + JSON pointer + expected value type) for every guided setting whose value has a GET: org/repo Actions permissions, artifact retention, interaction limits, immutable releases, private-vulnerability-reporting, code-security defaults, discussions/wiki/projects flags, Pages source, default branch name. A guide never says "done" unless the read-back matches.
Tests: a table-driven test that every `readback` path exists in the vendored description.

#### WU-Y9c — Web-only guides that are missing
Files: `src/data/dashboard-sections.js`.
Add guided entries (steps, URL pattern, "no API" flag) for: profile and organization avatar, repository social preview image, profile pinned repositories/gists, profile README toggle, contribution/achievement visibility, sessions/devices/recovery codes, Projects v2 workflows/charts/layout, discussion categories and polls, wiki (until Y8d), organization announcement banner, tag protection (retired; rulesets replace it). Each carries `apiAvailable:false` and the reason. Browser-assisted completion stays out of this repo (a separate Chrome connector); the guide says which steps a browser agent can do.

#### WU-Y9d — Owner-gated money tools (build only after IN-16)
`github_sponsor_set` (GraphQL `createSponsorship|cancelSponsorship|updateSponsorshipPreferences`, spend-priced from the tier amount the read returns, one-time vs monthly shown in dollars), hosted/larger runner management (`/orgs/{org}/actions/hosted-runners`), Copilot coding-agent permissions, content exclusion and team seat assignment (`POST /orgs/{org}/copilot/billing/selected_teams`), Copilot agent tasks. Each follows the O-4 pattern: price function with source and date, spend guard, `confirm`, read-back, inverse where one exists. Default until IN-16: **not built; guides only**.

## 5. Stop-and-ask points

1. **IN-15** App permissions: Chris must approve the new permissions on github.com (cannot be done by an agent). Without it, tools in Y-3/Y-6 that need user or runner permissions return a plain-English `missing permission` message from `github_check_permissions`.
2. **IN-16** Money tools (Sponsors, hosted runners, Copilot admin): build, or keep guided.
3. **IN-17** Two new dependencies for the wiki (`isomorphic-git`, `memfs`): approve, or guide-only.
4. Any case where the pinned OpenAPI description has no route for a planned tool: record "not in the API at 2026-03-10" in this file's decisions and skip; do not guess a path.
5. A budget check that fails after adding tools: keep the tools `full`-only (Y8); do not raise budgets.
6. A live acceptance step (anything not provable on the fake GitHub): stays an owner-run item in `docs/GO-LIVE-CHECKLIST.md`; never use a real credential in tests.

## 6. Order, size and acceptance summary

| Card | Outcome | Size | Tools added (est.) | Needs |
|---|---|---|---|---|
| Y-1 | Universal tools unblocked; permissions checklist; status tool; consistency test | L | 1 | — |
| Y-2 | Spec-driven GraphQL writes (≥24 mutations) | L | 0 (extends 2) | Y-1 |
| Y-3 | Other people's data, follow, star lists, watching, social | M | ~14 | Y-1, Y-2, IN-15 |
| Y-4 | Projects v2 lifecycle | L | ~14 | Y-2 |
| Y-5 | Moderation, org issue types/fields, interaction limits, autolinks | M | ~14 | Y-2 |
| Y-6 | Runners, groups, Actions limits, deployment rules | L | ~11 | Y-1, IN-15 |
| Y-7 | Advisories, code scanning, secret patterns, org security configs | L | ~14 | Y-1 (Y-8 for async) |
| Y-8 | Jobs, artifact/archive reading, release upload, wiki | L | ~8 | IN-17 (wiki only) |
| Y-9 | Org long tail, read-backs, guides, owner-gated money tools | M | ~4 (+money after IN-16) | Y-2 |

Expected end state: about 390 tools; every operation in the audit is either a tool, a universal operation with a reviewed class, a guided
step with a read-back, or an explicit "no API / owner-gated / refused for safety" line in `docs/TOOL-CATALOG.md`.
