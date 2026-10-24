# GOD-5 — "extra places": use the master token where the App is not installed

**Batch FIN · Design:** `docs/designs/FINISH-PLAN.md` §4 (this card is the design) · **Prerequisites:** GOD-2, GOD-3 ·
**Effort:** medium (credentials + guards; read `docs/AI-PR-READ-FIRST.md`) · **Owner decision:** default below
(extra places start read-only) applies unless Chris changes it on `docs/OWNER-CHECKLIST.md`; building does not wait.

## Outcome
On **My connection**, a person with a master token can add an **extra place**: an organization they belong to, or
specific repositories of any owner they can access, even though the GitHub App is not installed there. Every existing
tool can then work on that place using the master token, exactly as if it were a connected account. A new place starts
**read-only**: reads work; every change is refused until the person flips "allow changes" for that place on My
connection. All normal guards (preview, confirm, production classification, protected resources, spend, access) apply.

## Design (decided; implement exactly)
1. **Storage = a normal account row.** An extra place is a row in the tenant's `gh_accounts` with
   `credential_kind = 'master'` (new allowed value), no installation, `account_type` from GitHub, plus two new columns:
   `allow_changes BOOLEAN NOT NULL DEFAULT FALSE` and `allowed_repos TEXT[]` (NULL = whole owner; otherwise only these
   repository names). Add both with `ALTER TABLE gh_accounts ADD COLUMN IF NOT EXISTS …` in `src/db.js` `initSchema`
   (additive only). If `credential_kind` has a CHECK constraint, extend it in the same additive way (find it with
   `grep -n "credential_kind" src/db.js`).
2. **Joining connections.** After adding a place, call `db.addAccountsToConnections([login])` (exists, from PUB-6
   rebuild) so live app connections see it without reconnecting. Removing a place deletes the row and removes the login
   from every connector token's `accounts` (new db function `removeAccountFromConnections(login)`; default account falls
   back to `accounts[0]`).
3. **Credentials — an extra place IS the master token, with all its limits.** In `src/github/client.js`
   `credentialFor`, after `resolveAccount`, load the row once (`await ctx.db.getAccount(account)`); if
   `row?.credential_kind === 'master'`, set `cred = 'M'` BEFORE the existing checks run. That makes every existing
   master-token refusal apply unchanged: read-only connections, service passes, and narrowed requests
   (`scope.repositories`/`scope.permissions`) are refused, and the request hook's `authorizeOptionalRequest` (api host
   only) runs. Do NOT add a branch in `user-authorization.js` that hands out the master token under `I`/`U`.
   Consequence (intended): read-only connections cannot use extra places at all; the place list on My connection says so.
   If no master token is enrolled, the existing `currentMaster()` refusal applies; make its message "This extra place
   needs your master token." Test: a pass connection and a narrowed scope are refused for an extra place exactly as
   for `cred:'M'` (copy the existing `credentialFor` M tests).
4. **Guards.** New gate in `src/tools/` next to `productionEnabledGate` (`src/tools/production-guard.js`):
   `extraPlaceGate()` → for ANY write whose `target.owner` row has `credential_kind === 'master'`:
   refuse with "Changes are off for <place>. Turn on 'allow changes' for it on My connection." unless `allow_changes`
   is true; and if `allowed_repos` is set, refuse a target repo not in the list (and refuse owner-level writes such as
   org settings). Register the gate wherever `productionEnabledGate()` is registered (`grep -rn "productionEnabledGate()" src`).
   For reads, `githubFor` must refuse a repository outside `allowed_repos`: in `src/github/client.js` request hook, when
   the account row is a master place with `allowed_repos`, compare `resourceFor(method,url)`'s repo and throw
   `GithubClientError('outside_scope', 'That repository is not one of the places you added.')`. The account row can be
   loaded once per `githubFor` call via `ctx.db.getAccount(account)`.
5. **Adding a place (My connection).** In `src/tenancy/public-connect.js` `manageAction`, new actions:
   - `add_place` with `value` = `owner` or `owner/repo` (validate `^[A-Za-z0-9-]{1,39}(/[A-Za-z0-9._-]{1,100})?$`).
     Requires a master token. Verify access with the master token: org → `GET /user/memberships/orgs/{org}` must be
     `state:'active'`; user owner → must equal the signed-in login or the repo must be accessible; repo →
     `GET /repos/{owner}/{repo}` must return `permissions.pull === true`. Refuse an owner that is already a connected
     (installed) account — the App is better there. Then upsert the row (`credential_kind:'master'`,
     `allow_changes:false`, `allowed_repos` = `[repo]` or merge with existing list).
   - `place_changes` with `value` = `<login>:on|off` → sets `allow_changes`.
   - `remove_place` with `value` = `<login>` (or `<login>/<repo>` to drop one repo from `allowed_repos`).
   Page (`public-http.js` `managePage`): a section "Extra places (uses your master token)": list rows with
   "read-only"/"changes allowed" and buttons; a small form with a text box "organization or owner/repository" and
   button "Add place". Only shown when a master token is added; otherwise one line explaining it needs one.
6. **Tool output.** `github_whoami` and `github_list_accounts` label these accounts `setup: 'extra place (your master
   token)'`, plus `allow_changes` and `allowed_repos`.
7. **Never:** add a place for an account the token cannot see; let an extra place bypass protected resources; let a
   read-only connection write; return the token.

## Optional extension (same card, separate PR if time): fine-grained token places
Some organizations refuse third-party Apps but allow fine-grained tokens. On My connection, "Add place with a
fine-grained token" opens the same protected one-use page as the master token (never a tool argument), verifies the
token's owner is the signed-in person (`GET /user`), and stores it as an extra place with `credential_kind='fine_grained'`
(the owner store already supports this kind: copy its encryption context and `credentials.js` fine-grained branch).
Same read-only default, same guards. Skip if GOD-5 main part is not merged yet.

## Read only these
`src/github/client.js` (request hook), `src/tenancy/user-authorization.js` (`token`, `currentMaster`),
`src/tools/production-guard.js` (`productionEnabledGate`), `src/core/write.js` lines 95–140, `src/db.js`
(`gh_accounts` create/upsert/listAccounts), `src/tenancy/public-connect.js` (`manageAction`, `manageView`),
`src/tenancy/public-http.js` (`managePage`), `tests/browser/sign-in.test.js` (My connection tests).

## Drift check A
| Expected | Actual on main | Action |
|---|---|---|
| `gh_accounts.credential_kind` values `app`/`fine_grained` only | | |
| `addAccountsToConnections` exists in `src/db.js` | | |
| write lifecycle refuses targets outside `connection.accounts` (`src/core/write.js` ~113) | | |

## Tests (named)
- `tests/db/god-5-extra-places.test.js` (real Postgres, copy setup from `tests/db/pub-6-public-connect.test.js`):
  add org place → row `credential_kind='master'`, `allow_changes=false`, live connection gains it; add repo place →
  `allowed_repos` set; non-member org refused; installed account refused; no master token refused; remove place →
  gone from row and from tokens.
- `tests/unit/god-5-guards.test.js`: extra place on a `read_only` connection, a pass, and a narrowed scope → refused by `credentialFor` (same as `cred:'M'`); write on read-only place refused by `extraPlaceGate`; write allowed after
  `allow_changes`; repo outside `allowed_repos` refused for write and for read (client hook); protected resource on an
  extra place still refused; read-only connection profile still refused.
- Browser (`tests/browser/sign-in.test.js`): My connection → add "acme-co" place (fake GitHub membership route answers
  active) → appears as read-only → flip to allow changes → `fitsScreen` passes. Extend `tests/browser/harness.js` fake
  API with `GET /user/memberships/orgs/{org}` for the classic token (already partly present) and `GET /repos/{o}/{r}`.

## Done when
- [x] All tests above green (unit `god-5-guards`, DB tests in `tests/db/pub-6-public-connect.test.js` describe "GOD-5 extra places", browser test "adds an extra place with the master token"); `npm run test:db`, `npm run test:browser`, `npm run check` green. (The DB tests were added to the existing PUB-6 file because its large fixture is not shared.)
- [x] `docs/DECISIONS.md` entry "Extra places" with the default (read-only first) and the guards.
- [ ] ACC-1 row (after the next release): Chris's master token adds one org he is a member of as a read-only place; a read works; a write is
      refused; then the place is removed.

## Progress
Main part built and merged in one PR. Not built: the optional fine-grained-token extension (separate PR if wanted; recorded in DECISIONS).
