# GOD-6 — "Act as me": with a master token, GitHub records the person, not the bot

**Batch FIN · Design:** this card · **Prerequisites:** GOD-1 (master token), GOD-2 (`personalCred`), GOD-5 (extra
places), all merged · **Effort:** medium–high (credentials, guards; read `docs/AI-PR-READ-FIRST.md`) · **Split:** one
PR. Reason: routing as the person and the rule-bypass guard (step 6) must ship together; routing without the guard
would let an admin's token skip branch rules. **Expected agent time:** 4–6 h.

## Owner decision (Chris, 2026-10-24) — already made

- **God mode off** (no master token): unchanged. Calls use the App (installation token `I`, App user token `U`), and
  GitHub shows the Robinson GitHub MCP bot.
- **God mode on** (master token added): every GitHub call uses the person's master token (`M`), so GitHub records the
  person (for example `christcr2012`) as the one who started a workflow, merged, commented or changed a setting. This
  applies to every person who adds a master token, not only Chris.
- The few things only an App may do go through the bot automatically. Every result says who it acted as.
- The token expiring, being removed or being rejected switches back to the bot on its own and says so. No reconnecting.
- On by default once a master token is added; a switch on My connection turns it off ("Act as me").

**Consequence to state in the PR and the status note:** a check such as appliance-desk's "only Chris may start an
extra testing build" will accept any agent that uses Chris's God-mode connection, because GitHub sees Chris. That is
the requested behaviour; it means such checks no longer tell Chris and his agents apart.

## Outcome

With a master token and "Act as me" on, every tool call is made as the person, except App-only requests, read-only
connections and passes, which keep using the bot. Each result carries `acting_as`. `github_whoami` shows the mode,
the reason when the bot is used, and the person's own GitHub request allowance. A token that expires or is rejected
puts the connection back on the bot without an error loop, and a write is never silently repeated. Branch rules still
hold when the person is an admin who could skip them.

## How it works today (read these, nothing else)

- `src/github/client.js` — the only place a token is chosen. `credentialFor(ctx, {owner, cred, scope})` (lines
  86–116) resolves the account, applies the refusals (passes, read-only and narrowed scopes never get `M`) and calls
  `ctx.credentials.token({account, cred, scope, profile})`. `githubFor` (147–215) builds one Octokit with that token
  and a `hook.wrap('request', …)` that runs the extra-place check, `authorizeOptionalRequest` for `K`/`P`/`M`, rate
  blocking (`assertNotBlocked`), write spacing (`takeWriteSlot`) and rate recording (`recordRate`), all keyed by
  `account`. In that hook `options.url` is still the route template (`/repos/{owner}/{repo}`), see the comment at
  line 170.
- `src/github/personal-cred.js` — `personalCred(ctx, needed)` already picks `M` over `U` for the person's own account
  when the master token covers the scope. Keep it; GOD-6 widens the same idea to every call.
- `src/tenancy/user-authorization.js` — the signed-in person's credential store: `token({cred:'M'})` (~line 315),
  `masterStatus()` (~line 307, returns `{enrolled, scopes, expires_at}`), `authorizeOptionalRequest` (~line 258; for
  `M` it only requires the GitHub API host).
- `src/github/credentials.js` line ~227 — owner-store connections refuse `M` ("only available on a signed-in
  connection"). Owner-store connections therefore never act as the person; nothing to change there.
- `src/tools/dispatch.js` — `createDispatch` builds the handler context (~line 88) and shapes every result (~lines
  96–113). Nested calls (`callTool`) come back through `dispatch`.
- `src/tools/server.js` — `github_whoami` (~lines 50–90) already shows `master_token`.
- `src/tenancy/public-connect.js` — My connection actions (`manageAction`, list at ~line 429; the `time_zone` action
  at ~line 442 is the pattern for a saved per-person setting with `db.setSetting`).
- `src/tools/pulls-merge.js` — merges check required CI themselves (`readPlan`, `why`), at the exact head.
- `src/db.js` — `change_log` (~line 307) and its two `INSERT`s (~lines 1367, 1382).

## Drift check A (fill in the PR description before coding)

| Expected | How to check | Actual | Action |
|---|---|---|---|
| `credentialFor` / `githubFor` as described, one token per Octokit | `sed -n 80,215p src/github/client.js` | | |
| `masterStatus()` returns `{enrolled, scopes, expires_at}`, no login | `grep -n "async masterStatus" -A6 src/tenancy/user-authorization.js` | | |
| No per-person "act as me" setting exists | `grep -rn "act_as" src \| head` | | |
| GitHub App-only routes per inventory: the 12 `/app/...` operations with `classic_pat: unsupported` | `node -e` over `buildCapabilityInventory().operations` (see step 2) | | |

## Design (decided; implement in this order)

### 1. When does a call act as the person? — `src/github/act-as.js` (new, pure, ~120 lines)

`export async function actAsFor(ctx, { cred, scope })` returns `{ on: true }` or `{ on: false, reason }`. It is
`on` only when ALL hold, checked in this order (the first failing one is the reason, in plain words):
1. `cred` is `'I'` or `'U'` (an explicit `K`, `P` or `M` is left exactly as today).
2. `ctx.connection.profile !== 'read_only'` → "read-only connections always use the bot".
3. `ctx.connection.pass !== true` → "service passes always use the bot".
4. no `scope.permissions` and no `scope.repositories` / `scope.repository_ids` → "this tool asks for a narrowed
   token, which only the bot can have". (Only the universal tools and agent tasks narrow per call today.)
5. `typeof ctx.credentials?.masterStatus === 'function'` and `masterStatus()` says `enrolled: true`
   → otherwise no reason is shown at all (plain God mode off).
6. not expired: `expires_at` is null or in the future → "your master token expired on <date>".
7. scopes include `repo` (use `scopeCovered` from `personal-cred.js`) → "your master token does not have the repo
   permission".
8. the person's setting `act_as_me` (tenant `db.getSetting('act_as_me')`) is not `'off'` → "Act as me is off on My
   connection".
9. no recent rejection: setting `master_rejected_at` is empty (adding a new token clears it; see step 5) → "GitHub
   rejected your master token; add a new one on My connection".
10. the person's own allowance is not nearly used up: rate state for key `~me` (step 4) has
    `remaining === null || remaining > PERSONAL_RATE_RESERVE` (setting via `whole(env.GITHUB_PERSONAL_RATE_RESERVE,
    100, 5000)`) or its reset time has passed → "your own GitHub allowance is nearly used up until <time>".
Cache the result on `ctx` for the rest of the call (`ctx.actAsCache`) so a tool that makes 20 requests reads the
settings once.

### 2. App-only requests always use the bot — `src/github/app-only-routes.js` (generated) + script

- `scripts/build-app-only-routes.mjs` writes `src/github/app-only-routes.js` exporting
  `APP_ONLY = Object.freeze([...'METHOD /template'])`, sorted. Sources:
  (a) every REST operation in `buildCapabilityInventory().operations` whose
      `credentialSupport.classic_pat.disposition === 'unsupported'` (today the 12 `/app/...` operations);
  (b) this fixed list (GitHub's docs say personal tokens cannot use them), kept in the script with a comment citing
      https://docs.github.com/en/rest/checks/runs and https://docs.github.com/en/rest/checks/suites :
      `POST /repos/{owner}/{repo}/check-runs`, `PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}`,
      `POST /repos/{owner}/{repo}/check-runs/{check_run_id}/rerequest`, `POST /repos/{owner}/{repo}/check-suites`,
      `PATCH /repos/{owner}/{repo}/check-suites/preferences`,
      `POST /repos/{owner}/{repo}/check-suites/{check_suite_id}/rerequest`, every route starting `/installation/`, and
      `POST /app-manifests/{code}/conversions`.
  Before writing (b), re-check both docs pages with the web tool; if a page now says personal tokens ARE allowed, drop
  that route and say so in the status note.
- Also export `APP_ONLY_GRAPHQL = ['createCheckRun','updateCheckRun','createCheckSuite','rerequestCheckSuite']`.
- `export function isAppOnly(method, urlOrTemplate, body)`: true when `METHOD template` is listed (match the template
  exactly, or the expanded path against the template turned into a regex with `[^/]+` per `{param}`); for
  `POST /graphql`, true when the mutation document names one of `APP_ONLY_GRAPHQL`.
- Unit test `tests/unit/god-6-app-only.test.js`: the generated file equals a fresh run of the script (same pattern as
  other "in sync" tests; copy one with `grep -ln "in sync" tests/unit/*.test.js | head -1`); `isAppOnly` is true for
  `POST /repos/{owner}/{repo}/check-runs`, the expanded `/repos/a/b/check-runs`, `GET /app` and a `createCheckRun`
  mutation, and false for `GET /repos/a/b`, `POST /repos/a/b/issues` and a `createIssue` mutation.

### 3. Choose the token per request, not per Octokit — `src/github/client.js`

- `credentialFor`: unchanged for every existing caller, plus: when `cred` is `I`/`U`, call `actAsFor`. If `on`, also
  return `personal: { token: await ctx.credentials.token({ account, cred: 'M', profile }) }`. If that throws or
  returns nothing, treat as `on: false` with reason "your master token could not be read; using the bot". The bot token
  is fetched lazily (step below) so a call that only needs the person never mints an installation token.
- `githubFor`: build the Octokit **without** `auth`. In the existing `hook.wrap('request')`, before anything else,
  decide `useMe = personal && !isAppOnly(method, options.url, options) && !botForBranchWrite` (step 6), then set
  `options.headers.authorization = 'token ' + (useMe ? personal.token : await botToken())`, where `botToken()` calls
  the original `credentialFor` path once and caches it for this Octokit. From that point the request is treated as
  credential `useMe ? 'M' : cred`: run `authorizeOptionalRequest({account, kind:'M', method, url})` for `M` exactly as
  today, and use that credential in `takeWriteSlot(ctx.db, \`${account}:${actual}\`)`.
- Verify with a request-shape test that the `authorization` header GitHub (the fake) receives is the master token for a
  normal call and the bot token for a check-run call made by the same Octokit. Octokit must not add its own auth header
  (it has no `auth`); the test proves it.
- The extra-place path (GOD-5, `place`) is unchanged: those calls were already `M`.

### 4. The person's own request allowance

GitHub counts a personal token against the person (normally 5,000 requests an hour), shared by all their accounts.
When the actual credential is `M`, use the account key `'~me'` (a tilde can never start a GitHub login) for
`assertNotBlocked`, `recordRate` and the rate part of `asRateLimited`. The bot keeps recording under `account` as
today. `github_whoami` shows it (step 7).

### 5. Expired, removed or rejected token — back to the bot without a loop

- Expired or removed: `actAsFor` already says `on: false` with the reason; nothing else to do.
- GitHub answers **401** to a request sent with `M`: in the hook's `catch`, before `asRateLimited`, save
  `db.setSetting('master_rejected_at', new Date(now()).toISOString())`. Then:
  - **read** (`!write`): repeat the same request once with the bot token and return that answer; record
    `fellBack: 'GitHub rejected your master token; this answer came from the bot'` in the actor log (step 7).
  - **write**: do not repeat it (rule A8: a write is never replayed). Throw a `GithubClientError('no_credentials',
    'GitHub rejected your master token, so nothing was changed. Calls now use the bot. Run it again, or add a new
    master token on My connection.')`.
- Adding a new master token (enrolment in `src/tenancy/master-credential.js`) clears `master_rejected_at`
  (`db.setSetting('master_rejected_at', '')`), so the next call acts as the person again.
- A **403 or 404** to a read sent with `M` (the token may lack a scope the App has): repeat once with the bot and say
  so in the actor log ("your master token could not read this; the bot did"). Writes are never repeated; the 403 text
  reaches the person as today.

### 6. Branch rules still hold for admins (the safety part)

An admin's personal token can be allowed by GitHub to skip branch protection or rulesets that the bot cannot skip.
The server never sends `bypass_rules`, and must not let the change of credential become a bypass:
- **Merges** (`src/tools/pulls-merge.js` and `src/tools/workflows-merge.js`): they already refuse unless every required
  check is green at the exact head. Add one more refusal, only when the call would act as the person: if
  `pr.mergeable_state === 'blocked'` (GitHub's word for "the branch's rules are not met yet", for example a missing
  approval), refuse: "GitHub's rules for <base> are not met yet (for example a required review). Acting as you could
  skip them, so it is not merged." Put it in `why()` next to the existing checks; the actor decision is available as
  `await actAsFor(ctx, {cred:'I'})`.
- **Direct branch writes** sent as the person — `PUT`/`DELETE /repos/{owner}/{repo}/contents/{path}`,
  `POST`/`PATCH`/`DELETE /repos/{owner}/{repo}/git/refs…`, `POST /repos/{owner}/{repo}/merges`: read the target
  branch once (`GET /repos/{owner}/{repo}/branches/{branch}` with the bot token, sent through the hook's own `request`
  argument with an explicit `authorization` header so it does not re-enter this decision; branch = the `branch` body field, the
  ref path, or the repository's default branch when none is given). If `protected === true`, send this one request
  with the bot (`botForBranchWrite = true`) and log "branch rules apply to <branch>, so this change was made by the
  bot". The bot is never a bypass actor unless someone configured it, so the rules apply as before.
- The universal REST/GraphQL writes go through the same hook, so the branch-write rule covers them; their merge path
  is `PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge`: when acting as the person, read the PR first (bot token)
  and refuse if `mergeable_state === 'blocked'`, as above.

### 7. Show who acted — every result, `github_whoami`, the change log

- **Actor log:** `createDispatch` adds `actor: createActorLog()` to the handler context (one per dispatch). The hook in
  `githubFor` calls `ctx.actor?.record({ as: useMe ? 'you' : 'bot', note })` for every request. `createActorLog()`
  (in `act-as.js`) keeps a small set: who was used, plus at most 3 distinct notes.
- **Result field:** after shaping (both the write and read branches in `dispatch`), when the log is not empty, add to
  `structuredContent` (and the text JSON) one field:
  `acting_as: 'christcr2012 (you)'`, `'Robinson GitHub MCP bot'`, or `'christcr2012 (you); check results by the bot'`
  for a mix, plus `acting_as_note` (first note) when the bot was used because of a fallback or a rule. Keep both short
  (the small-results rule). The person's login: `masterStatus()` gains `login` — saved as setting `master_login` at
  enrolment (enrolment already reads `who.login` from `GET /user`); when missing, read `GET /user` once with `M` and
  save it.
- **`github_whoami`** gains: `acting_as: { mode: 'you' | 'bot', login, reason? , personal_rate: { remaining, resets_at
  } }` using `actAsFor` and the `~me` rate state. When the token is near expiry, keep the existing reminder.
- **Change log:** add `acted_as TEXT` to `change_log` (`ALTER TABLE change_log ADD COLUMN IF NOT EXISTS acted_as TEXT`
  in `initSchema`), filled with `'you:<login>'` or `'bot'` in both `INSERT`s from the write lifecycle (pass it from the
  actor log). `github_recent_changes` shows it.

### 8. The switch on My connection

- New action `act_as_me` (add to the allowed list at ~line 429 of `public-connect.js`), value `'on'` | `'off'`, saved
  with `db.setSetting('act_as_me', value)`, copying the `time_zone` action. Shown only when a master token is added:
  a line "GitHub shows: **you (christcr2012)** / the Robinson GitHub MCP bot" and a button "Act as me: turn off" /
  "turn on". Plain words under it: "When on, GitHub records you as the one who made each change. Checks only an app may
  post still come from the bot." Escape every value with `h()`; no scripts; must fit a 412px phone.
- `docs/TOOL-CATALOG.md`: no new tool; update the `github_whoami` row ("shows who calls act as").

## Tests (all with the fake GitHub; fake values only, e.g. `ghp_FAKEmaster…`)

`tests/unit/god-6-act-as.test.js` (copy the setup of the GOD-2/GOD-5 unit tests: `grep -ln "personalCred\|extra place"
tests/unit/*.test.js | head -3`):
1. Master token added, switch default → a `github_issue_create` request reaches the fake with the master token;
   result `acting_as` is `'<login> (you)'`; change log row `acted_as = 'you:<login>'`.
2. No master token → bot token, `acting_as` bot, no reason text.
3. Read-only connection and a service pass → bot, reason given, and no `M` request is ever made.
4. A tool with `scope.repositories` (universal GET) → bot with the narrowed-token reason.
5. Check-run create in the same call as a commit read → commit read as you, check run as bot, `acting_as` shows the mix.
6. `act_as_me = 'off'` → bot with that reason; turning it back on → you.
7. Expired token (`expires_at` in the past) → bot with the date in the reason.
8. 401 on a read with `M` → same read repeated with the bot, answer returned, `master_rejected_at` saved, next call bot;
   enrolling a new token clears it and the next call is you again.
9. 401 on a write with `M` → no second request (the fake records exactly one write), plain "nothing was changed".
10. 403 on a read with `M` → one bot retry; 403 on a write → no retry.
11. Personal allowance below the reserve (`~me` remaining 50) → bot with the reset time; the bot's own rate key is
    untouched by `M` calls and vice versa.
12. Merge as you with `mergeable_state: 'blocked'` and green checks → refused with the rules message, no merge request;
    the same as the bot (master token absent) → today's behaviour unchanged.
13. Contents `PUT` to a protected branch while acting as you → sent with the bot token and noted; to an unprotected
    branch → sent as you.
14. `github_whoami` shows `acting_as` (mode, login, personal_rate).
Also: `tests/browser/sign-in.test.js` — My connection with a master token shows the switch, turning it off/on works,
the page fits the phone (`fitsScreen`). Write contract (`runWriteContract`) suites stay green unchanged (they run
without a master token, so they exercise the bot path).

## Done when
- [ ] All 14 unit cases and the browser case pass; `npm run check`, `npm run test:db`, `npm run test:shapes`,
      `npm run test:browser` green; `ci` and `release-policy` green at the exact head.
- [ ] `node scripts/build-app-only-routes.mjs` output committed and its in-sync test passes.
- [ ] Self-review records each `docs/AI-PR-READ-FIRST.md` constraint, in particular: no token in results or logs
      (`containsCredential` still runs), `M` never reaches read-only or pass connections, no write is repeated, branch
      rules cannot be skipped by the credential change.
- [ ] Status note `docs/status/<date>-god-6.md` (plain English) including the "only Chris" consequence above.
- [ ] After release, ACC-1 on the scratch account (production on there): one issue created and closed again acting as
      Chris, read back showing `user.login` = Chris; one check run on a scratch commit showing the bot; result in
      `docs/developer-evidence.json`.

## Not in this card (`docs/ROADMAP.md`)
A per-call "as the bot this once" argument; acting as the person for tools that narrow their token per call (would
need a URL-inside-target check like GOD-5's `assertPlaceRequest`); fine-grained personal tokens as the "me" credential.
