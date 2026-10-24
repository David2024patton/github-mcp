# GOD-2 — personal-account tools use the master token when it is added

**Batch FIN · Design:** `docs/designs/FINISH-PLAN.md` §4, `docs/designs/GOD-TOKEN.md` · **Prerequisite:** GOD-1 (merged) ·
**Ship with:** GOD-3 in the same PR · **Effort:** medium (credentials) · **Status:** see `work-index.json`.

## Outcome (one sentence)
When a person has added a master token (credential `M`), the tools that act on **their own GitHub account** (gists,
SSH/GPG/signing keys, emails, profile, blocks, invitations, follow, star, watch, social links, status, own Codespaces,
organization migrations) use `M`; without a master token, or on a read-only connection, they behave exactly as today (`U`).

## Why
GitHub's pinned API description marks these operations `x-github.enabledForGitHubApps: false`: the App's user sign-in
(`U`) is likely refused for most of them. They have never been tested on a real account. The master token is a classic
token of the same person, so it is the credential GitHub expects. (The flag is not perfect, e.g. `GET /user` works with
`U`, so the rule is "prefer `M` when present", never "refuse without `M`".)

## Read only these
- `src/github/client.js` lines 60–125 (`resolveAccount`, `credentialFor`, `githubFor`).
- `src/tenancy/user-authorization.js` around `masterStatus()` and `token()` (search `async masterStatus`).
- `src/tenancy/master-credential.js` (`MASTER_SCOPES`).
- The tool files listed in Step 3 (only the lines named).
- `tests/unit/o6-user-account.test.js`, `tests/unit/y3-social-write.test.js`, `tests/unit/o7-notifications-gists.test.js`
  (patterns), `test/helpers/write-contract.js` (`makeWorld`).

## Drift check A
Fill this table before coding (compare to latest `main`):

| Expected | Actual on main | Action |
|---|---|---|
| `credentialFor` refuses `M` for `read_only`, passes and narrowed scopes | | |
| tenant credentials expose `masterStatus()` returning `{enrolled, scopes, expires_at}` | | |
| owner (non-tenant) credentials from `src/github/credentials.js` have NO `masterStatus` | | |
| tool declarations keep `cred:'U'` (checked by `scripts/check-writes.mjs` against TOOL-CATALOG) | | |

## Build steps
1. **Create `src/github/personal-cred.js`** (new file, no other imports than nothing or `./errors.js`):
   ```js
   // GOD-2: which credential acts on the person's OWN GitHub account. The master token (M) when it is added and covers
   // the needed classic scope; otherwise the App user sign-in (U), exactly as before. Read-only connections and passes
   // never use M (credentialFor refuses it), so they always get U.
   const COVERS = { // a granted classic scope -> the scopes it includes (GitHub docs: "Scopes for OAuth apps")
     repo: ['repo', 'public_repo', 'repo:status', 'repo_deployment', 'repo:invite', 'security_events'],
     user: ['user', 'read:user', 'user:email', 'user:follow'],
     'admin:org': ['admin:org', 'write:org', 'read:org'],
     'admin:public_key': ['admin:public_key', 'write:public_key', 'read:public_key'],
     'admin:gpg_key': ['admin:gpg_key', 'write:gpg_key', 'read:gpg_key'],
     'admin:ssh_signing_key': ['admin:ssh_signing_key', 'write:ssh_signing_key', 'read:ssh_signing_key'],
     'write:packages': ['write:packages', 'read:packages'],
     codespace: ['codespace', 'codespace:secrets'],
     project: ['project', 'read:project'],
     'admin:enterprise': ['admin:enterprise', 'manage_runners:enterprise', 'manage_billing:enterprise', 'read:enterprise']
   };
   export function scopeCovered(granted = [], needed) {
     if (!needed) return true;
     return granted.some((g) => g === needed || (COVERS[g] ?? []).includes(needed));
   }
   export async function personalCred(ctx, needed) {
     if (ctx.connection?.profile === 'read_only' || ctx.connection?.pass === true) return 'U';
     if (typeof ctx.credentials?.masterStatus !== 'function') return 'U';
     const status = await ctx.credentials.masterStatus().catch(() => null);
     return status?.enrolled === true && scopeCovered(status.scopes, needed) ? 'M' : 'U';
   }
   ```
   Export `COVERS` too (GOD-3 reuses it).
2. **Unit test** `tests/unit/god-2-personal-cred.test.js`: (a) no `masterStatus` → `U`; (b) enrolled with `['gist']`,
   needed `gist` → `M`; (c) enrolled `['user']`, needed `user:email` → `M`; (d) enrolled `['repo']`, needed `gist` → `U`;
   (e) `profile:'read_only'` → `U`; (f) `pass:true` → `U`; (g) `masterStatus` throws → `U`; (h) not enrolled → `U`.
3. **Change call sites** (replace the literal `cred:'U'` passed to `githubFor`, NOT the `declarations.cred`). For each
   file, wrap so the needed scope is passed:
   | File | Function / tools | Needed scope |
   |---|---|---|
   | `src/tools/user-account.js` line ~22 helper (used by `github_account_*`) | keys → `admin:public_key`; GPG → `admin:gpg_key`; signing keys → `admin:ssh_signing_key`; emails/profile/status/blocks/invitations → `user` | per tool: add a `scope` argument to the helper |
   | `src/tools/user-account.js` line ~388 helper (`github_account_set_status`) | `user` | |
   | `src/tools/social-write.js` `userClient` (follow, watch, social links, star lists) | follow/social → `user`; watch/star lists → `repo` | |
   | `src/tools/notifications-gists.js` gist tools (`github_gist_list/get/save/delete`) | `gist` | keep the K notification path unchanged |
   | `src/tools/repos-write.js` `github_repo_star` (the `GET/PUT/DELETE /user/starred/...` calls only) | `repo` | |
   | `src/tools/billing-read.js` / `billing-write.js` user Codespaces calls (`/user/codespaces*`, `POST /repos/.../codespaces`) | `codespace` | org-level calls keep `I` |
   | `src/tools/org-admin-extras.js` `github_org_migration_start/status` | `admin:org` | these currently use `I`; switch to `personalCred(ctx,'admin:org')`, which returns `U` without M — if `U` is not valid for the org call, keep `I` as the no-master fallback (write `const cred = (await personalCred(ctx,'admin:org')) === 'M' ? 'M' : 'I'`) |
   Pattern: `const gh = await githubFor(ctx, { owner, cred: await personalCred(ctx, 'gist') });`
   Do **not** change: `GET /user` identity lookups used only to learn "who is signed in", `app-jwt-*`, `apps-tokens.js`,
   `packages-read.js` (already handled by the P→M fallback), `pulls-write.js` update-branch and `actions-write.js`
   pending deployments (verify in ACC-1 first; change only if real evidence shows `I` is refused).
4. **Write-slot key** already includes the credential (`${account}:${cred}`); nothing to do.
5. **Docs:** in `docs/TOOL-CATALOG.md`, for every tool changed in Step 3 append " (uses your master token when added)"
   to its purpose text. Do not change the credential column (stays `U` or `I`).

## Tests (named)
- `tests/unit/god-2-personal-cred.test.js` (Step 2).
- In each existing test file for a changed tool, add one case **"uses the master token when added"**: build the world
  with `makeWorld({ profile:'full', ... })`, then replace `ctx.credentials` with a wrapper whose `masterStatus` returns
  `{enrolled:true, scopes:['gist','user','repo','admin:public_key','admin:gpg_key','admin:ssh_signing_key','codespace','admin:org']}`
  and whose `token({cred})` returns `'ghp_FAKEmaster'` for `M` (delegate other kinds to the original) and whose
  `authorizeOptionalRequest` returns `true`. Assert the fake GitHub saw `authorization: token ghp_FAKEmaster` (or
  `Bearer`, match what the fake records) on the tool's call. Add one **"read-only connection keeps U"** case per file.
- Existing nine-check write-contract tests must still pass unchanged (they run without a master token → `U`).

## Commands
`npx vitest run --config vitest.config.js tests/unit/god-2-personal-cred.test.js tests/unit/o6-user-account.test.js tests/unit/y3-social-write.test.js tests/unit/o7-notifications-gists.test.js tests/unit/o4-billing-codespaces.test.js`
then `npx eslint .` and `BASE_SHA=$(git merge-base origin/main HEAD) npm run check`.

## Done when
- [x] `personalCred` exists with the unit test (8 cases) green.
- [x] Every call site in the Step 3 table uses it; every changed tool has a "uses the master token" and a "read-only keeps U" test.
- [x] No declaration `cred` changed; `node scripts/check-writes.mjs` green.
- [x] TOOL-CATALOG notes added; GOD-3 in the same PR; CI green; status note written.
- [ ] Successor: ACC-1 adds live rows "personal tools with master token" (gist create+delete on Chris's account is
      allowed only as a disposable secret gist, deleted in the same run; keys/emails/profile are READ-only live checks).
