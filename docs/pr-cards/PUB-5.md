# PUB-5 — public, free launch from Chris's website (no directory listing, no people cap)

**Batch PUB · Design:** this card (supersedes the "directory publication gate" framing of `docs/designs/PUBLIC-SCALE.md`
§PUB-5; that section's threat list is reused in PR D) · **Prerequisites:** PUB-6, LAUNCH-1, HARD-1 (all merged) ·
**Effort:** medium · **Split:** 4 PRs, in this order: **A** scale → **B** cost and fair use (removes the people cap) →
**C** security review → **D** front door and listings. Reason for the split: B must not remove the cap before A's
scale fixes exist; C reviews A+B before D advertises the service. **Expected agent time:** A 2–3 h, B 3–4 h, C 3–4 h,
D 2–3 h (about 10–14 h total).

## Owner decisions (Chris, 2026-10-24) — already made, do not re-ask

1. **No ChatGPT or Claude directory listing.** It is an unofficial third-party GitHub connector; those directories refuse
   that kind. Never submit there, rename or wrap the service to get around it.
2. **Public and free.** Anyone may connect: from Chris's website (`https://www.robinsonaisystems.com`), or by adding the
   connector address themselves. No sign-up fee, no payments, no billing code.
3. **Not invite-only.** `GITHUB_PUBLIC_INVITE_ONLY` stays off. (The switch stays in the code as an emergency lever only.)
4. **No cap on the number of people.** The 25-person default (`GITHUB_PUBLIC_MAX_TENANTS`) was a cautious build default,
   never Chris's choice. It goes, in PR B, once the cost protection it was standing in for exists.
5. **Monetizing later.** Not built now. Everything here must make it easy later: per-person usage is measured (PR B),
   and nothing assumes the service is free forever. Ideas go in `docs/ROADMAP.md` "Monetization (later)".
6. **Cost matters:** every call runs on Chris's Vercel and Neon bill. The protection is: fair-use limits per person,
   an estimated-cost auto-pause of NEW sign-ups (existing people keep working), clean-up of inactive people, and
   Vercel/Neon's own spend alerts. These are not a people cap.

Decisions still open are rows in `docs/OWNER-CHECKLIST.md` (section "PUB-5 launch"), each with a recommended default
the agent builds to. None blocks building or merging.

| Open decision | Default the agent builds | Where it is used |
|---|---|---|
| Public display name | **Robinson MCP for GitHub** (own brand first; "GitHub" only as the thing it works with; "Not affiliated with or endorsed by GitHub" on every page). Today's name "GitHub by Robinson AI Systems" leads with GitHub's mark. | `src/brand/brand.js` `BRAND.product` (one constant) |
| Free fair-use limit per person | 5,000 assistant calls a day, 300 changes an hour; Chris's own GitHub id exempt | `PUBLIC_FREE_CALLS_PER_DAY`, `PUBLIC_FREE_WRITES_PER_HOUR`, `PUBLIC_UNLIMITED_SUBJECTS` |
| Pause new sign-ups when the estimated monthly cost reaches | $50 (`5000` cents) | `PUBLIC_COST_PAUSE_CENTS` |
| Remove the sign-in of people inactive for | 180 days (they just sign in again) | `PUBLIC_INACTIVE_DAYS` |
| Launch with the trust pages still marked DRAFT? | Yes (banner stays until `LEGAL_APPROVED=yes`) | existing |
| Move the GitHub App's owner from `robinson-ai-scratch` to `Robinson-AI-Systems` | Recommended before the GitHub Marketplace listing (the listing shows the owner's name) | owner step on GitHub |

## Outcome

Anyone can find the service (Chris's website, the official MCP Registry, GitHub Marketplace) and connect any MCP app
in a minute, for free. The service holds up with thousands of people. Each person's heavy use is limited fairly, the
bill cannot run away unnoticed, and the security review shows each known attack is blocked by a named test. Chris has
one page of numbers (people, calls, estimated cost, top users) and a single switch to pause new sign-ups.

## Drift check A (fill in the PR description before coding; follow the card's intent with the real names)

| Expected on main (2026-10-24) | How to check | Actual | Action |
|---|---|---|---|
| People cap default 25 in `src/tenancy/public-connect.js` `limits()` (`maxTenants: whole(env.GITHUB_PUBLIC_MAX_TENANTS, 25, …)`), checked at `ensureTenant` (`countPilotTenants() >= limits.maxTenants`) | `grep -n "maxTenants" src/tenancy/public-connect.js` | | |
| App-registration cap default 500 (`maxClients`) | same file | | |
| Loops that visit every person one by one: `listPublicTenantIds(1000)` in `src/tenancy/public-cleanup.js`; `MAX_TENANTS = 100` in `src/tenancy/usage-summary.js` and `src/tenancy/forget-person.js` | `grep -n "LIMIT\|MAX_TENANTS\|listPublicTenantIds" src/tenancy/*.js` | | |
| Per-person rate limits exist in `src/tenancy/runtime-limits.js` (`mcpTenantPerMinute: 600`, …) and hourly metrics in each person's `gh_tenant_runtime_metrics` | `sed -n 7,25p src/tenancy/runtime-limits.js` | | |
| Cost estimate in `src/tenancy/usage-cost.js` (`PUBLIC_COST_PER_1K_CALLS_CENTS` default 5, alert `PUBLIC_COST_ALERT_CENTS` 2000), shown only on the owner setup page | `grep -n "env\." src/tenancy/usage-cost.js` | | |
| No scheduled job on Vercel (`vercel.json` has no `crons`) | `node -e "console.log(require('./vercel.json').crons)"` | | |
| `/` is served by `api/index.js`; trust pages `/privacy /terms /security /support` and `/limits` exist | `vercel.json` rewrites | | |
| Brand name in one place: `src/brand/brand.js` `BRAND.product` | `grep -rn "GitHub by Robinson" src api \| head` (the old owner form in `api/tenant/oauth/authorize.js` hard-codes it too) | | |

## PR A — works for thousands of people (2–3 h)

Today three jobs visit every person's store one by one (one database query per person) and stop at a fixed number:
the App-uninstall clean-up (`listPublicTenantIds(1000)`, `src/tenancy/public-cleanup.js`), owner "delete a person"
(`MAX_TENANTS = 100`, `src/tenancy/forget-person.js`) and the usage summary (`MAX_TENANTS = 100`,
`src/tenancy/usage-summary.js`). Public people are the rows of `gh_tenant_pilot_bootstraps` with
`account_login = 'public-connect'` (`TENANT_KEY`, `src/tenancy/public-connect.js:45`).

1. **One new root lookup table, numbers only** (no names, no tokens). Add inside the directory `initSchema()` in
   `src/tenancy/directory.js`, next to the other `CREATE TABLE IF NOT EXISTS gh_tenant…` statements:
   `gh_public_installations(installation_id BIGINT NOT NULL, tenant_id UUID NOT NULL REFERENCES gh_tenants(id),
   PRIMARY KEY (installation_id, tenant_id))`. Do NOT add a login table: the root already holds the person's login in
   `gh_tenant_user_authorizations.user_login`, which step 4 uses.
2. **Keep it current** with one helper `dir.indexPublicInstallations(tenantId, installationIds)` (replaces that person's
   rows in one `sql.transaction`). Call it exactly where a person's App accounts are written: in `ensureTenant`'s
   installation loop in `src/tenancy/public-connect.js` (after `setInstallation`, ~lines 207–216) and in the "add
   account" path. Extra places (`credential_kind = 'master'`, ~line 515) have no installation: they get no row.
   `disconnect` (~line 448) removes an app connection, not an account, so it does not touch the index.
3. **Delete with the person:** in the same schema block, `CREATE OR REPLACE` the existing function
   `gh_forget_public_tenant` (~lines 309–330) adding `DELETE FROM gh_public_installations WHERE tenant_id = target;`
   (and, from PR B, the two usage tables) BEFORE `DELETE FROM gh_tenants`.
4. **Use it:**
   - `public-cleanup.js` `installationChanged`: look up tenant ids with
     `SELECT tenant_id FROM gh_public_installations WHERE installation_id = $1` instead of looping. Leave the
     revoked-authorization path alone: `revokeUserAuthorizationsBySubject` (`directory.js` ~line 987) is already one
     root query.
   - `forget-person.js`: candidates = `SELECT DISTINCT tenant_id FROM gh_tenant_user_authorizations WHERE
     lower(user_login) = $1` joined to public bootstraps; still confirm inside each candidate's own store exactly as
     today. If there are no candidates (for example the person's grant was removed by PR B's inactive clean-up), fall
     back to the batched scan below. No 100 ceiling.
   - `usage-summary.js`: read public tenants in batches of 200 using keyset paging
     (`WHERE account_login = 'public-connect' AND tenant_id > $last ORDER BY tenant_id LIMIT 200`), no ceiling; stop
     after a time budget of 8 s and return `partial: true` with how many were counted, never a wrong total.
5. **Backfill once:** `dir.backfillPublicInstallations()` walks public tenants with the same keyset paging and fills the
   table from each store's `gh_accounts` (`credential_kind = 'app'`). Run it the first time a lookup finds the table
   empty while public tenants exist. Guard it with `pg_try_advisory_xact_lock(<fixed number>)` inside one
   `sql.transaction` (Neon's HTTP driver may use a new session per query, so the session-level lock would not hold).
6. **Load test at scale:** `npm run test:load -- --people 500 --at-once 25` (local fake only; it refuses other
   addresses), and time one App-uninstall webhook with 500 people present. Record both in the status note.
7. Tests (`tests/db/pub-5a-scale.test.js`, real throwaway Postgres): index rows written on sign-in and add account;
   extra place adds none; deleted with the person (`gh_forget_public_tenant`); backfill fills it and runs once under two
   parallel callers; uninstall clean-up changes only the matching person with 300 people present; delete-a-person finds
   the person through the root grant and through the fallback; usage summary counts 250 people (more than the old 100).

## PR B — fair use, cost protection, no people cap (3–4 h)

**Where things are counted (decided).** `admitTenantMcp` in `api/mcp.js` (~line 38) runs once per HTTP request, before
the JSON-RPC body is read, so it also sees `initialize`, `tools/list` and notifications, and one `github_call` or
`github_batch` can carry many changes. Therefore:
- **Calls** are counted in `api/mcp.js` only when `req.body?.method === 'tools/call'` and the client is public
  (`isPublicClientId(context.clientId)` from `src/tenancy/public-code.js`).
- **Changes** are checked and counted in `createDispatch` (`src/tools/dispatch.js` ~lines 69–72) through a new optional
  injected hook `usage` (`{ beforeWrite(), afterWrite(result) }`; absent = no limits, which keeps every existing test and
  the owner path unchanged). A tool is a change when `tool.writes === true && tool.writeContract === 'defineWrite-v1'`
  (the existing `isWrite`). Before the handler runs: if `isWrite && args?.dryRun !== true`, call `beforeWrite()`, which
  refuses when the hour's limit is reached. After it: count only when `result.structuredContent.status` is `applied`,
  `unconfirmed` or `uncertain` (`src/core/write.js`); `preview` (~line 174) and refusals never count. Nested calls
  already come back through `dispatch` (`callTool`), so a batch is counted change by change.
- **Who is exempt:** `PUBLIC_UNLIMITED_SUBJECTS` = comma-separated **numeric GitHub user ids** (logins can be renamed
  and re-registered by someone else). Compare with `gh_tenant_identities.provider_subject`, found through
  `context.tenant.identityId` (look it up once per request). Default empty. The implementer looks up Chris's numeric id
  (`christcr2012`) with the connector's user read and writes it into the owner-checklist row; the setting itself is
  an owner step.

1. **Measure per person, per day and per hour** (root, numbers only, additive in the directory `initSchema()`):
   `gh_public_usage_daily(day DATE, tenant_id UUID REFERENCES gh_tenants(id), calls INT NOT NULL DEFAULT 0, writes INT
   NOT NULL DEFAULT 0, errors INT NOT NULL DEFAULT 0, PRIMARY KEY (day, tenant_id))` and `gh_public_usage_hourly` (same
   shape with `hour TIMESTAMPTZ`). One `INSERT … ON CONFLICT DO UPDATE` per counted event. Purge daily rows older than
   400 days and hourly rows older than 48 h opportunistically (copy the `Math.random() < 1/128` pattern in
   `recordTenantMetric`, `runtime-limits.js`). Add both tables to `gh_forget_public_tenant` (PR A step 3).
   `usage-summary.js` and `usage-cost.js` switch to these tables for public people, so every number on the owner page
   comes from one source.
2. **Free fair-use limits:** refuse a `tools/call` when today's `calls >= PUBLIC_FREE_CALLS_PER_DAY` (default 5000), and
   a real change when the current hour's `writes >= PUBLIC_FREE_WRITES_PER_HOUR` (default 300); reads and previews keep
   working when only the change limit is reached. Plain refusal text, for example: "You have reached today's free limit
   of 5,000 calls. It resets at midnight UTC. See /limits." with `retry_after` seconds. Settings use the existing
   `whole(env.X, default, max)` helper. Show both limits on `/limits`, and "used today: 312 of 5,000" on My connection.
3. **Cost auto-pause for NEW sign-ups:** in `ensureTenant`, only when creating a new person, get the estimate from
   `usage-cost.js` (last 7 days of calls × 30/7 × `PUBLIC_COST_PER_1K_CALLS_CENTS`), cached 10 minutes in the root
   settings store (`createDb(rootSql).getSetting/setSetting`, key `public_cost_estimate_cache`). If it is
   `>= PUBLIC_COST_PAUSE_CENTS` (default 5000) refuse: "New sign-ups are paused for a short while. Please try again
   later." Same refusal when `GITHUB_PUBLIC_NEW_SIGNUPS=paused`. People who already have a store are never refused.
   The owner setup page shows "New sign-ups: open / paused (because …)".
4. **Remove the people cap:** delete `maxTenants` from `limits()` and its check in `ensureTenant`; remove it from
   `docs/GO-LIVE-CHECKLIST.md` and replace "lower the sign-up cap" in `src/github/setup-html.js` (~line 41) with "pause
   new sign-ups". Raise the `maxClients` default from 500 to 100000 and add clean-up: a public app registration with no
   token issued in 30 days is deleted when a new registration happens (at most 50 per call). Every other cap stays.
5. **Inactive people:** "last seen" = the later of the person's newest `gh_public_usage_daily.day` and their newest
   `gh_tenant_user_authorizations.updated_at` (so someone who signed in but has not called yet is not removed). When
   last seen is older than `PUBLIC_INACTIVE_DAYS` (default 180), delete their sealed GitHub grants and app tokens; their
   store and settings stay and they simply sign in again. Never applies to `PUBLIC_UNLIMITED_SUBJECTS`. Runs from the
   sign-in path, at most 20 people per run.
6. **Owner page, Public usage** (`src/github/setup-html.js`, passphrase-protected): people total, active today and this
   week, calls today, estimated monthly cost, sign-ups open/paused, and the top 10 people by calls this week. For those
   10 only, read the GitHub login from each one's own store (`gh_accounts`, `account_type = 'User'`) so the root keeps
   no new names. **This is an intended privacy change:** update the "Counts only: no names or content" sentence
   (~line 128), the header comment of `forget-person.js`, and `docs/legal/PRIVACY-DRAFT.md` (say the owner can see the
   GitHub name and daily counts of the heaviest users, to prevent abuse and control cost; and the 180-day rule).
7. **Calibrate the cost rate:** read this project's last 30 days of usage from the Vercel and Neon connectors (read
   only), divide by the call count, and set the code default of `PUBLIC_COST_PER_1K_CALLS_CENTS` to the measured value
   with the date and sources in a code comment. If either cannot be read, keep 5 and say why in the status note.
8. Tests (`tests/db/pub-5b-fair-use.test.js` plus unit tests for the dispatch hook): `tools/list` and `initialize` are
   not counted; call 5,001 refused with reset time; change 301 in an hour refused while reads continue; a preview and a
   refusal do not count; a `github_batch` with 3 changes counts 3; an exempt numeric id is never limited; the dispatch
   with no `usage` hook behaves exactly as before; sign-up paused above the cost threshold and by the switch while an
   existing person still signs in; 30 people connect (old cap gone); stale registration removed, recent one kept;
   inactive person's grants removed, a just-signed-in person and an exempt person kept; owner page shows the numbers
   and top 10 (copy an existing setup-page test).

## PR C — security review before advertising (3–4 h)

Write `docs/audits/PUBLIC-LAUNCH-SECURITY-2026-10.md`: one row per threat below. Columns: threat, how it is blocked
(file and function), the test that proves it (file and test name), result. A threat with no test gets one in this PR.
A gap that cannot be closed safely is fixed in this PR or, if large, listed as a named remaining item **and** the
launch row in the checklist says so.

| # | Threat | Where to look first |
|---|---|---|
| 1 | One person reads or changes another person's data | tenant schemas `src/tenancy/directory.js` (`createTenantSql`, `assertTenantSearchPath`), `openAuthorizedTenantDb` |
| 2 | OAuth attacks: stolen or replayed code, PKCE downgrade, wrong redirect, mixed-up issuer, open redirect | `src/tenancy/public-connect.js`, `src/tenancy/public-http.js`, `tests/browser/sign-in.test.js` |
| 3 | Stolen refresh or access token | `src/tenancy/oauth-token.js`: prove a used refresh token is refused (single use) and access tokens expire; if reusing an old refresh token does not end that whole sign-in, add that and a test |
| 4 | Forged webhook deliveries | `src/github/webhook.js` signature check first |
| 5 | One heavy user slows everyone (shared GitHub App rate, database, functions) | PR B limits, `runtime-limits.js` |
| 6 | Paid or production actions by a free user without clear warning | `defineGithubWrite` declarations, `docs/END-USER-AUTHORITY.md` |
| 7 | Prompt injection through issue/PR text | `untrusted: true` marking; no tool follows repository text |
| 8 | Secrets leaking through results, logs, errors or pages | secret-never-in-tool rule; grep tests for `ghp_`, `ghs_`, `github_pat_` in outputs |
| 9 | Using the service to spam GitHub (mass issues, comments, stars) and getting the App suspended | PR B write limit; GitHub's own secondary limits; owner "delete a person" |
| 10 | Clickjacking / script injection on the pages | headers in `api/tenant/optional.js` style (`frame-ancestors 'none'`, CSP), `h()` escaping |
| 11 | Account takeover by connecting someone else's GitHub organization | installation + admin checks in sign-in |
| 12 | Deleted person's data lingering | delete-my-data, App uninstall clean-up (PR A), inactive clean-up (PR B) |

Also: run `npm audit --omit=dev` and fix or record each high/critical item; confirm every public page sends
`Content-Security-Policy`, `X-Content-Type-Options: nosniff` and `Referrer-Policy` (add a browser-test assertion).
Read `docs/AI-PR-READ-FIRST.md` and record each constraint in the PR's self-review.

## PR D — front door for the website, registry and Marketplace (2–3 h)

1. **Home page `/`** (`api/index.js`), plain branded page that fits a phone (412 px, `fitsScreen` browser test):
   what it does in three lines; "Not affiliated with or endorsed by GitHub."; **Connect** sections for Claude (web,
   desktop, phone: Settings → Connectors → Add custom connector → paste the address), ChatGPT (developer mode custom
   connector, web), Claude Code (`claude mcp add --transport http github-robinson https://github.robinsonaisystems.com/api/mcp`),
   Cursor and VS Code (their `mcp.json` snippet). The address `https://github.robinsonaisystems.com/api/mcp` is shown
   once in a copyable box. Links: My connection, limits, privacy, terms, security, support. Before writing each client's
   steps, check that client's current official docs with the web tool and cite the page and date in an HTML comment.
   No scripts (pages rule); copying is plain selectable text.
2. **Rename** to the decided display name: change `BRAND.product` and the hard-coded title in
   `api/tenant/oauth/authorize.js`; MCP `serverInfo.title` follows `BRAND`. Update tests that assert the old name.
3. **Website pack** `docs/website/`: `connect-button.html` (a self-contained link button + one paragraph Chris's website
   can paste, no scripts, no tracking) and `README.md` saying where it goes. Do not change the website repository
   (hard limit: other repos); the owner row says to paste it or ask for it in that repo's own session.
4. **Official MCP Registry:** add `server.json` at the repository root (schema
   `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`; check for a newer schema date first),
   name `com.robinsonaisystems/github`, description ≤100 characters, `remotes: [{ type: 'streamable-http', url:
   'https://github.robinsonaisystems.com/api/mcp' }]`, version read from `package.json`; also make `serverInfo` in `src/brand/brand.js` (~line 32, today hard-coded
   `'0.1.0'`) read the same version. A unit test validates the shape and
   that the URL equals `BRAND`'s origin. Publishing needs a DNS TXT record and `mcp-publisher login dns` with a key Chris
   holds: owner row with the exact steps (the agent may prepare the TXT value but never holds the private key).
   Check whether directories' crawlers can call `initialize`/`tools/list` without signing in; if our server requires
   sign-in for those, record it in the status note (do not weaken sign-in for it).
5. **GitHub Marketplace pack** `docs/marketplace/`: listing text (short and long description, no grammar errors, nothing
   that steers people away from GitHub), feature list, links (privacy, terms, support), and screenshots made by the
   browser harness (Playwright `page.screenshot` of `/`, the Approve page and My connection with fake data; PNG under
   `docs/marketplace/`). Free plan only. Owner rows: move the App to `Robinson-AI-Systems` first (recommended), then
   submit the listing as organization owner and accept the Marketplace Developer Agreement.
6. Tests: home page fits a phone in all three browser profiles and shows the address and the "not affiliated" line;
   `server.json` test; renamed brand appears on Approve and My connection pages.

## Done when

- [ ] A, B, C, D merged with green `ci` and `release-policy`; status note per PR in `docs/status/`.
- [x] No people cap in code or docs; 500-person load test and uninstall timing recorded (PR A note). Evidence: docs/status/2026-10-24-pub-5a-scale.md.
- [x] Fair-use limits, cost auto-pause, manual pause, inactive clean-up and owner usage page proven by the PR B tests. Evidence: docs/status/2026-10-24-pub-5b-fair-use.md.
- [ ] Security review file has a test reference (or a named fix) for all 12 threats; `npm audit` result recorded.
- [ ] Home page, rename, website pack, `server.json` and Marketplace pack merged; each owner step is a row in
      `docs/OWNER-CHECKLIST.md` "PUB-5 launch" with plain-English instructions.
- [ ] After release: ACC-1 checks `/` and `/limits` on the live service and one public sign-in end to end; result in
      `docs/developer-evidence.json`. Paid-plan-only checks are not part of this card.
- [ ] `work-index.json` PUB-5 → `MERGED`; this card's boxes ticked with evidence.

## Not in this card (recorded in `docs/ROADMAP.md`)

Billing, paid plans and any payment code; the ChatGPT/Claude directories (refused by policy); email sending for alerts
(Vercel and Neon spend alerts are used instead: owner rows); changes to Chris's website repository; community
directories beyond the official registry (they copy from it).
