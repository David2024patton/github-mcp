# GOD-4 — new tool families that only the master token can reach

**Batch FIN · Design:** `docs/designs/FINISH-PLAN.md` §4 · **Prerequisites:** GOD-2, GOD-3 ·
**Effort:** light–medium · **Split:** PR A = Codespaces secrets + machines + account export;
PR B = Copilot Spaces + small reads (Classroom, Marketplace listing, hovercard, project views, credential revoke).

## Outcome
Each family below has dedicated tools that use credential `M` via `personalCred` (GOD-2), with the normal read/write
lifecycle, so an assistant no longer hand-builds `github_api_*` calls for them. Without a master token the tools return
the plain answer "Add your master token (My connection) with permission <scope> to use this."

## Read only these
- `docs/implementation-contracts/TOOL-RECIPES.md` §2 "New read tool", §3 "One GitHub write", §4 "Contract fixture".
- `src/tools/users-public.js` (read-tool pattern), `src/tools/notifications-gists.js` (gist write pattern with `U`),
  `src/tools/secrets.js` + `src/github/secret-seal.js` (secret values never pass through a tool).
- `src/github/personal-cred.js` and `src/github/master-areas.js` (GOD-2/3).
- Operation shapes: `node scripts/openapi-find.mjs "codespaces secrets"` etc. (never open the vendor JSON).

## Drift check A
| Expected | Actual on main | Action |
|---|---|---|
| `SECRET_KINDS` includes `codespaces`; `secretRoutes` supports levels `repo`, `environment`, `org` | | |
| `github_secret_set` uses `octo(ctx, owner)` (credential `I`) | | |
| `personalCred` and `MASTER_AREAS` exist | | |

## A. Codespaces secrets (extend, do not duplicate)
1. In `src/github/secret-seal.js` `secretRoutes`: add level `'user'` valid only for kind `codespaces`, paths
   `/user/codespaces/secrets`, `/user/codespaces/secrets/public-key`, `/user/codespaces/secrets/{secret_name}`; no
   `{owner}` param. Unit test the three paths and that `actions`+`user` throws.
2. In `src/tools/secrets.js` and `src/tools/variables.js` (`place`): accept `level:'user'` when `kind:'codespaces'` and
   no `repo`/`owner` is given → place label "your personal Codespaces secrets".
3. Credential: for `kind === 'codespaces'` (any level) the client must be built with
   `cred: await personalCred(ctx, 'codespace')`; GitHub refuses Apps here. Find where `octo(ctx, owner)` is built
   (`src/tools/github-write.js`) and add an optional `cred` parameter (default `'I'`); pass it only from the secrets
   tools when kind is `codespaces`. The secret VALUE still comes only from the setup page or `generate` (unchanged).
4. Repository access for user/org Codespaces secrets (`.../repositories` routes): extend `github_secret_set_repo_access`
   the same way (kind `codespaces`, levels `org` and `user`).
5. Tests in `tests/unit/` (copy `variables.test.js`/secrets tests): request shape for each new route; nine-check
   write contract for `github_secret_set` and `github_secret_delete` with `kind:'codespaces', level:'user'`;
   "without master token → plain refusal naming `codespace`" (expect the tool to return `refused`, not throw).

## B. Codespaces machine types (read)
- New read tool `github_codespace_list_machines` in `src/tools/billing-read.js` next to `github_codespace_list`:
  `GET /user/codespaces/{codespace_name}/machines`, args `{codespace_name}` (pattern `^[A-Za-z0-9-]{1,90}$`),
  returns `[{name, display_name, cpus, memory_in_bytes, storage_in_bytes}]`. Credential `personalCred(ctx,'codespace')`.

## C. Your own account export (user migrations)
New file `src/tools/account-export.js` (register it in `src/tools/index.js` like the other files):
| Tool | Kind | GitHub | Notes |
|---|---|---|---|
| `github_account_export_start` | write, `confirm:'always'`, `production:'always'`, `cred:'U'` declared | `POST /user/migrations` body `{repositories, lock_repositories:false, exclude_attachments, exclude_releases, exclude_owner_projects}` | NEVER send `lock_repositories:true` (it locks repos); refuse if asked. Read-back: `GET /user/migrations/{id}` exists. Summary: "Start an export of N repositories from your account (repositories are NOT locked)". |
| `github_account_export_status` | read | `GET /user/migrations`, `GET /user/migrations/{migration_id}`, `GET /user/migrations/{migration_id}/repositories` | returns state (`pending`/`exporting`/`exported`/`failed`). |
| `github_account_export_link` | read | `GET /user/migrations/{migration_id}/archive` returns a 302 to a short-lived download URL | return `{download_url, expires_note:'about 1 minute', size_hint}`; do NOT download. Mark the URL as sensitive in the result guidance ("opens your archive; do not share"). |
| `github_account_export_delete` | write, `confirm:'always'` | `DELETE /user/migrations/{migration_id}/archive` | read-back: archive GET returns 410/404. |
All four use `personalCred(ctx, 'repo')`. Skip `DELETE .../repos/{repo_name}/lock` (only needed after locking, which we never do).

## D. Copilot Spaces (PR B)
New file `src/tools/copilot-spaces.js`: tools `github_copilot_space_list`, `github_copilot_space_get`,
`github_copilot_space_save` (create; `POST /users/{username}/copilot-spaces`), `github_copilot_space_delete`,
`github_copilot_space_collaborators` (list), `github_copilot_space_set_collaborator` (POST/PUT, `accessWidening:true`,
names the person and role in the summary), `github_copilot_space_remove_collaborator`, `github_copilot_space_resources`
(list/get), `github_copilot_space_set_resource` (POST/PUT), `github_copilot_space_remove_resource`.
`{username}` is always the signed-in person (read `GET /user` with the same credential; never trust an argument).
Credential `personalCred(ctx,'copilot')` — add `copilot` to `MASTER_AREAS` (GOD-3 file) with these tool names.
Before writing request bodies run `node scripts/openapi-find.mjs "copilot spaces"` and copy the exact field names.

## E. Small reads (PR B), all `defineRead`, credential `personalCred(ctx, <scope>)`
| Tool | GitHub | Scope |
|---|---|---|
| `github_classroom_list` / `github_classroom_get` / `github_classroom_assignments` / `github_classroom_grades` | `/classrooms`, `/classrooms/{id}`, `/classrooms/{id}/assignments`, `/assignments/{id}`, `/assignments/{id}/accepted_assignments`, `/assignments/{id}/grades` | `repo` |
| `github_marketplace_listing` | `/marketplace_listing/plans`, `/marketplace_listing/plans/{plan_id}/accounts`, `/marketplace_listing/accounts/{account_id}` | none (works only for a Marketplace App owner; explain otherwise) |
| `github_user_hovercard` | `GET /users/{username}/hovercard` (`subject_type`, `subject_id` optional) | `repo` |
| `github_project_view_create` | write: `POST /users/{user_id}/projectsV2/{project_number}/views` | `project` |
| `github_credential_revoke` | write-shaped but **no token in any argument** (AGENTS.md: secrets never pass through a tool) | `POST /credentials/revoke` | The tool takes no token. It returns a private one-use link (10 minutes) to a protected page, built exactly like the master-token page (`api/tenant/optional.js` `masterMarkup` + `createPrivateOptionalEnrollment` one-use state). The person pastes the leaked token(s) THERE; the server POSTs them to `/credentials/revoke` and shows only the last 4 characters and GitHub's answer. The change log stores only last-4 values. Test: the tool's input schema has no property that can carry a token, and its result never contains one. |

## Tests (named)
For every tool: request-shape test against the fake GitHub; for every write: `runWriteContract` (nine checks);
`tests/unit/god-4-*.test.js` "no master token → plain refusal naming the permission". Add every tool to
`docs/TOOL-CATALOG.md` (credential column `U`, note "uses your master token") and to `MASTER_AREAS`.

## Done when
- [x] PR A (in review): Codespaces secrets (user level + `M`), machines, account export (4 tools).
- [ ] PR B merged: Copilot Spaces (10 tools), small reads/writes (8 tools).
- [ ] `python3 scripts/count-catalog.py` and `node scripts/check-writes.mjs` green; `MASTER_AREAS` lists them.
- [ ] ACC-1 gets live rows: list machines, export start/status/link/delete on Chris's account (export of ONE
      disposable scratch repo only), Copilot Space create/delete (disposable), Classroom/Marketplace reads (expect an
      honest "not available for this account" answer).
