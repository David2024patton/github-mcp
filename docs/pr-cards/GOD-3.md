# GOD-3 — "what my master token unlocks right now"

**Batch FIN · Design:** `docs/designs/FINISH-PLAN.md` §4, `docs/designs/GOD-TOKEN.md` · **Prerequisite:** GOD-2
(same PR) · **Effort:** light · **Status:** see `work-index.json`.

## Outcome
`github_whoami` (on connections that can have a master token) and the **My connection** page both show a short list:
for each God-mode area, "unlocked" or "locked — tick <permission> on GitHub to unlock". The expiry reminder that already
exists stays.

## Read only these
- `src/tools/server.js` lines 40–90 (`masterExpiry`, `whoami`).
- `src/github/personal-cred.js` (from GOD-2: `COVERS`, `scopeCovered`).
- `src/tenancy/public-connect.js` function `manageView` (search `async function manageView`) — it reads the master row
  via `directory().getPilotOptionalCredential(...)`; that row has `scopes` and `expires_at`.
- `src/tenancy/public-http.js` function `managePage` (the "Master token (optional)" section).
- `src/tenancy/master-credential.js` (`MASTER_SCOPES`, `masterTokenLink`).

## Drift check A
| Expected | Actual on main | Action |
|---|---|---|
| whoami returns `master_token: {added, permissions, expires_at…}` | | |
| `manageView` returns `master: {added, expiresAt}` | | |
| GOD-2 `personal-cred.js` exists in this branch | | |

## Build steps
1. **Create `src/github/master-areas.js`**:
   ```js
   import { scopeCovered } from './personal-cred.js';
   // One row per God-mode area: the plain name, the classic scope that unlocks it, and the tools it opens.
   export const MASTER_AREAS = Object.freeze([
     { area: 'Gists', scope: 'gist', tools: ['github_gist_list', 'github_gist_get', 'github_gist_save', 'github_gist_delete'] },
     { area: 'Notifications', scope: 'notifications', tools: ['github_notify_list', 'github_notify_mark', 'github_notify_set_subscription'] },
     { area: 'Packages', scope: 'write:packages', tools: ['github_package_list', 'github_package_delete', 'github_package_delete_version', 'github_package_restore_version'] },
     { area: 'SSH keys', scope: 'admin:public_key', tools: ['github_account_list_keys', 'github_account_add_key', 'github_account_delete_key'] },
     { area: 'GPG and signing keys', scope: 'admin:gpg_key', tools: [] },
     { area: 'Your profile, emails, follows and blocks', scope: 'user', tools: ['github_account_update_profile', 'github_account_manage_email', 'github_account_set_blocked', 'github_user_follow', 'github_user_set_social', 'github_account_set_status'] },
     { area: 'Stars, watching and star lists', scope: 'repo', tools: ['github_repo_star', 'github_repo_watch', 'github_star_list_manage'] },
     { area: 'Your Codespaces', scope: 'codespace', tools: ['github_codespace_list', 'github_codespace_create', 'github_codespace_set_state', 'github_codespace_delete'] },
     { area: 'Organization admin extras (migrations)', scope: 'admin:org', tools: ['github_org_migration_start', 'github_org_migration_status'] },
     { area: 'Projects', scope: 'project', tools: [] },
     { area: 'Enterprise (ENT-1)', scope: 'admin:enterprise', tools: [] }
   ]);
   /** [{area, unlocked, needs}] — needs is the permission to tick on GitHub when locked. Never includes the token. */
   export function masterUnlocks(scopes = []) {
     return MASTER_AREAS.map((a) => ({ area: a.area, unlocked: scopeCovered(scopes, a.scope), ...(scopeCovered(scopes, a.scope) ? {} : { needs: a.scope }) }));
   }
   ```
   Later cards (GOD-4, ENT-1) append their tool names to the right rows; keep the list in this one file.
   Only list tool names that exist: add a unit test that every name in `MASTER_AREAS[].tools` is in the registry.
2. **whoami** (`src/tools/server.js`): when `master.enrolled`, add `unlocks: masterUnlocks(master.scopes)` inside
   `master_token`. When not enrolled, add `would_unlock: MASTER_AREAS.map(a => a.area)`.
3. **My connection** (`manageView` in `public-connect.js`): add `unlocks: master ? masterUnlocks(master.scopes ?? []) : []`
   to the `master` object. In `managePage` (`public-http.js`), under "Master token (optional)" when added, render a
   compact list: `<div class="row"><span>Gists</span><span class="tag">unlocked</span></div>` or `…locked — tick "gist"`.
   Escape every value with `h()`. Keep the page fitting a phone (the browser test `fitsScreen` checks it).
4. **Link with optional enterprise permissions:** in `master-credential.js` export
   `masterTokenLink({ enterprise = false } = {})` adding `admin:enterprise`, `manage_billing:enterprise`,
   `read:enterprise`, `scim:enterprise` (only those not already listed) when `enterprise` is true; keep the old no-argument
   behaviour identical. On the master-token page (`api/tenant/optional.js`, `masterMarkup`) add a second, smaller link
   "Include enterprise permissions (only if you administer a GitHub Enterprise)" using `masterTokenLink({enterprise:true})`.

## Tests (named)
- `tests/unit/god-3-master-areas.test.js`: `masterUnlocks(['gist','user'])` marks Gists and profile unlocked and Packages
  locked with `needs:'write:packages'`; `masterUnlocks(['repo'])` unlocks stars; every listed tool name exists in
  `registry.tools`; `masterTokenLink()` unchanged (compare to the old literal) and `masterTokenLink({enterprise:true})`
  includes `admin:enterprise` once.
- `tests/unit/server-tools.test.js`: add "whoami lists what the master token unlocks" (fake `masterStatus` with scopes).
- `tests/db/pub-6-public-connect.test.js`: in the "is added from My connection…" test, assert `page.manage.master.unlocks`
  contains `{area:'Gists', unlocked:true}` after enrolment with scopes `repo, notifications, gist`.
- `tests/browser/sign-in.test.js`: in the My connection test, after the master token is saved and the page reopened,
  assert the text "Gists" and "unlocked" appear and `fitsScreen` passes.

## Done when
- [ ] `masterUnlocks` + tests; whoami and My connection show the list; enterprise link variant exists.
- [ ] `npm run test:db -- tests/db/pub-6-public-connect.test.js` and `npm run test:browser` green locally or in CI.
- [ ] `docs/designs/GOD-TOKEN.md` "Pieces" updated: GOD-2 and GOD-3 done (with PR number).
