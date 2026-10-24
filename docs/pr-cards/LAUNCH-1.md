# LAUNCH-1 — public launch readiness (the approved "Public App rollout plan", what is still missing)

**Batch FIN · Design:** `docs/ROADMAP.md` "Public App rollout plan (Chris approved the approach 2026-10-23)",
`docs/designs/FINISH-PLAN.md` · **Prerequisites:** none (independent of God mode) · **Effort:** medium ·
**Split:** PR A = uninstall clean-up for public people + invite list; PR B = load test + cost view + limits page;
PR C = legal/support pages served + App permission review. Owner decisions are listed per part and never block building.

## State on 2026-10-23 (do not redo)
Done: simple connect flow + My connection (PUB-6), self-serve delete, owner delete-a-person, owner usage counts, key
change procedure (`docs/GO-LIVE-CHECKLIST.md`), legal DRAFTS (`docs/legal/PRIVACY-DRAFT.md`, `TERMS-DRAFT.md`), App
publicly installable, `GITHUB_PUBLIC_CONNECT=enabled` in production (anyone with the link can connect today, capped at
25 people by `GITHUB_PUBLIC_MAX_TENANTS`).

## Drift check A
| Expected | Actual on main | Action |
|---|---|---|
| `src/github/webhook.js` handles `installation.deleted` only for accounts in the OWNER store | | |
| no invite list in `src/tenancy/public-connect.js` (anyone can become a tenant up to the cap) | | |
| `docs/legal/*-DRAFT.md` exist; no route serves them | | |
| `src/tenancy/usage-summary.js` gives counts only, no cost | | |

## PR A.1 — App uninstalled or access revoked → clean up public people too (security gap)
Today `src/github/webhook.js` updates only owner-store accounts (`accounts.find(...)` over the owner DB). A public
person who uninstalls the App keeps an `active` account row and a stored user grant in their tenant until they sign in
again (GitHub itself refuses the installation token, so this is stale state, not access — but it must be cleaned).
1. In `webhook.js`, after the owner-store handling, for `installation.deleted` / `installation.suspend` and
   `github_app_authorization.revoked`: find tenants that hold the installation id or the user. Add a root-directory
   query in `src/tenancy/directory.js`: `findPublicTenantsByInstallation(installationId)` — loop over public tenants
   (`gh_tenant_pilot_bootstraps WHERE account_login='public-connect'`, max 1000) and, inside each tenant schema, `SELECT
   login FROM gh_accounts WHERE installation_id = $1` (use `openAuthorizedTenantDb`-style scoped SQL; copy the loop in
   `src/tenancy/usage-summary.js`, which already visits every public tenant safely).
2. For each match: `setInstallationStatus(login,'none')` (deleted) or `'suspended'`, `deleteInstallationTokens(id)`, and
   for `revoked` delete that person's stored user grant (`directory.revokePilotUserAuthorization` or the equivalent —
   find with `grep -n "UserAuthorization" src/tenancy/directory.js`).
3. Tests `tests/db/launch-1-uninstall.test.js`: signed webhook (fake secret) for an installation held by a public
   tenant → row `none`, tokens gone, other tenants untouched; `revoked` → grant gone; unknown installation → no change.
   Signature check stays first (existing behaviour).

## PR A.2 — invite-only opening (rollout step 7)
1. New env setting `GITHUB_PUBLIC_INVITE_ONLY` (`enabled` = on). Default OFF in code; Chris decides when to set it
   (owner row). When on, `ensureTenant` (public-connect.js) refuses a NEW person (no existing tenant) unless their GitHub
   login is in a root table `gh_public_invites(login TEXT PRIMARY KEY, added_at)`; existing tenants are never locked out.
   Refusal page: "Robinson GitHub MCP is invite-only right now. Ask Chris for an invite."
2. Owner setup page (passphrase-protected, `src/github/setup-page.js`, next to "Public usage"): add/remove invite logins.
3. Tests: db test for invite on/off, existing tenant still signs in, setup-page form protected by passphrase (copy an
   existing setup-page form test).

## PR B — capacity, cost and limits (rollout step 4)
1. **Load test** script `scripts/load-test-public.mjs` that runs ONLY against a local server (the browser harness's
   `startWorld()` + fake GitHub): N simulated people (default 50) each register, sign in, approve and call
   `github_whoami` 5 times concurrently; prints p50/p95 latency, errors, and DB row counts. Never points at production
   (refuse any non-local origin). Record one run's numbers in `docs/status/`.
2. **Cost view:** owner setup page "Public usage" gains "estimated monthly hosting cost" = function-invocation and
   DB-time estimates from the usage counts × configurable unit prices (`PUBLIC_COST_PER_1K_CALLS_CENTS`, default from
   Vercel Pro published pricing at implementation time — cite the URL in the code comment) and an alert line when above
   `PUBLIC_COST_ALERT_CENTS` (default 2000 = $20). Money is integer cents with `_display` dollars (AGENTS.md).
3. **Limits page:** `/limits` (vercel rewrite → `api/index.js` query or the oauth authorize function like `/connection`)
   plain-words page: per-person call rate, retained results, how many accounts per connection, from the runtime-limit
   settings (`src/tenancy/runtime-limits.js`). Linked from My connection.

## PR C — trust pages and App permission review (rollout steps 2, 3, 6)
1. Serve `/privacy`, `/terms`, `/security` (security contact + how to report), `/support` as plain branded pages from
   `docs/legal/` drafts, each with a visible "DRAFT — not yet approved" banner until `LEGAL_APPROVED=yes` is set
   (owner row). The support/security email comes from `PUBLIC_SUPPORT_EMAIL` (owner row); if unset, show "coming soon".
   Link them in the page footer (`src/brand/brand.js` `brandFooter`).
2. **App permission review:** write `docs/audits/APP-PERMISSIONS-2026-xx.md`: list the App's current permissions
   (from `src/github/app-manifest.js` and `github_app_owner_identity`/installation reads), which tools need each, and
   propose the smallest set. Account (user-level) permissions are NOT in the manifest today (decision 2026-10-16);
   note that GOD-2 makes the master token the path for those, so they stay out. Changing the live App's permissions is an
   owner row (GitHub asks every installer to re-approve).
3. Key-rotation rehearsal: run the documented procedure against the browser harness (two encryption keys) as a test
   `tests/browser/` case "a key change does not sign people out"; no production rotation.

## Done when
- [ ] A, B, C merged; owner rows added: invite-only switch, cost alert amount, support email, legal approval, permission change.
- [ ] Load-test numbers and the cost estimate recorded in a status note.

## Progress
- PR A (built; invite-only default OFF, Chris decides when to switch on): uninstall/suspend/revoke clean-up for public people
  (`src/tenancy/public-cleanup.js`, called from the webhook after the signature check) and the invite list (`GITHUB_PUBLIC_INVITE_ONLY`,
  `gh_public_invites`, owner setup page form). Tests: DB describe "LAUNCH-1 uninstall clean-up and invite-only" in
  `tests/db/pub-6-public-connect.test.js` (kept in that file because its large fixture is not shared), setup-page unit test.
- PR B, PR C: not started.
