# HARD-1 — hardening and tidy-up before calling the product finished

**Batch FIN · Design:** `docs/designs/FINISH-PLAN.md` §4, `docs/ROADMAP.md` "Found during the 2026-10-23 sign-in
rebuild" · **Prerequisites:** none (best done last) · **Effort:** light–medium · **Split:** PR A = sign-in steps +
App key copy (code); PR B = App URLs, documentation tidy, docs-only CI fast path, small polish.

## Outcome
No global cap can block everyone's sign-in; a replaced App key reaches every person at once; the GitHub App's Setup and
Webhook addresses use `github.robinsonaisystems.com`; and the documentation is short enough that a new agent reads the
current truth first.

## Drift check A
| Expected | Actual on main | Action |
|---|---|---|
| `createPublicFlow` has one global `maxOpen` cap (`src/tenancy/directory.js`) | | |
| `ensureTenant` calls `db.saveApp` with the root App's sealed keys | | |
| `docs/STATUS.md` length (`wc -l`) | | |

## PR A.1 — sign-in steps without a global row cap
Problem: every sign-in step is a row in `gh_public_flows`, capped at 200 open rows for everyone
(`GITHUB_PUBLIC_MAX_OPEN_FLOWS`). Anyone opening many sign-in links could fill it for 10 minutes.
Fix (smallest safe change, do NOT redesign the flow):
1. In `src/tenancy/directory.js` `createPublicFlow`: keep the global cap but raise the default to 5000, and add a
   **per-client** cap: count open rows `WHERE client_id = ${clientId} AND expires_at > now()`; refuse when ≥ 20
   (`GITHUB_PUBLIC_MAX_OPEN_FLOWS_PER_CLIENT`, default 20, read in `public-connect.js` `limits` like the others).
   Built-in clients (`FORGET_CLIENT`, `MANAGE_CLIENT`) get the same per-client cap.
2. In `begin()` (public-connect.js) only: before storing, delete this client's expired rows (cheap cleanup).
3. Tests in `tests/db/pub-6-public-connect.test.js` "holds hard caps": add per-client cap (21st open sign-in for one
   client refused with `capacity`, another client still works).
   Update `docs/GO-LIVE-CHECKLIST.md` caps line.

## PR A.2 — one shared copy of the App keys
Problem: `ensureTenant` (public-connect.js) copies the App's sealed keys into each tenant (`db.saveApp`); a replaced
key reaches a person only at their next sign-in.
Fix:
1. In `src/github/credentials.js`, find where installation tokens are minted from `db.getApp(row.app_id)` (line ~85).
   Add an optional `rootApps` dependency to `createCredentials({ …, rootApps })`: an object with `getApp(id)`. When
   given, read the App from `rootApps` first and fall back to `db.getApp`. The tenant credential factory
   (`src/tenancy/user-authorization.js` or `mcp-route.js`, find `createCredentials(` calls under `src/tenancy`) passes
   `rootApps: createDb(rootSql)` — the root (shared) database.
2. Keep `ensureTenant`'s `saveApp` for now (harmless, keeps older code paths working); add a comment that the shared
   copy is authoritative.
3. Test (`tests/db/`): after enrolling a tenant, change the root App row's `private_key_enc` to a new fake sealed value;
   the tenant credential path now uses the new one (assert via a fake JWT signer or by asserting which row was read).

## PR B.1 — GitHub App addresses on the new domain
1. Webhook URL: use the existing tool `github_app_webhook_configuration_set` (owner `robinson-ai-scratch`, App
   `robinson-github-mcp`) to set `url` to `https://github.robinsonaisystems.com/api/github/webhook` (check the path:
   `api/github/webhook.js` → route `/api/github/webhook`). Preview first, confirm, read back with
   `github_app_webhook_configuration`. Then send a test delivery and check `github_app_webhook_deliveries` shows 2xx.
2. Setup URL: there is no API; add an owner checklist row: "GitHub App settings → Setup URL →
   `https://github.robinsonaisystems.com/api/github/setup` → Save". Old address keeps working, so this never blocks.
3. Update `docs/DEPLOY.md` and `docs/GO-LIVE-CHECKLIST.md` with the new addresses; the old
   `github-mcp-chris-projects-de6cd1bf.vercel.app` stays as an alias.

## PR B.2 — documentation tidy (no behaviour change)
1. `docs/STATUS.md` (~2,300 lines): move everything above the acceptance ledger that is older than 2026-10-20 into
   `docs/archive/STATUS-before-2026-10-20.md` (copy text exactly; add a one-line pointer at the top of STATUS.md).
   Keep the `<!-- release-acceptance:start -->` block byte-for-byte (scripts read it); run `npm run check:session`.
2. `docs/MASTER-ROADMAP.md`: pointer to FINISH-PLAN already added 2026-10-23; remove the stale 2026-10-12..21
   paragraphs under it (move them to the archive file from step 1).
3. `docs/designs/PUBLIC-SCALE.md`, `docs/UNIVERSAL-IDENTITY-HANDOFF.md`: add a "Superseded in part" note at the top
   pointing at `docs/DECISIONS.md` 2026-10-23 entries (already done for PUBLIC-SCALE).
4. `docs/OWNER-GUIDE.md`: add "My connection" (`/connection`) and the master token in plain words.
5. Run `python3 docs/pr-cards/validate-index.py` (checks links) and `npm run check`.

## PR B.3 — documents-only pull requests finish in a minute or two
Today every PR runs unit (2 shards), db, shapes, rtc and browser (~10–15 minutes) even when only `docs/` or `*.md`
changed. Keep every job (the CI layout guard `scripts/check-ci-layout.mjs` requires them and forbids job-level `if:false`)
but let each heavy job finish fast:
1. In each of `unit`, `db`, `shapes`, `rtc`, `browser` add a first step `id: scope` that, on `pull_request` only, runs
   `git fetch --depth=1 origin ${{ github.event.pull_request.base.sha }}` and
   `git diff --name-only ${{ github.event.pull_request.base.sha }} HEAD | grep -vE '^(docs/|.*\.md$)' | head -1` and
   writes `code=true|false` to `$GITHUB_OUTPUT` (`code=true` on any other event, and if the diff command fails).
   Checkout needs `fetch-depth: 0` or the explicit fetch above.
2. Add `if: steps.scope.outputs.code == 'true'` to every later step of those jobs (step level, allowed). The job then
   succeeds quickly for docs-only PRs; `check` always runs in full (it validates docs and links).
3. Update `scripts/check-ci-layout.mjs` only if its parser objects; add a test in `scripts/check-ci-layout.test.mjs`
   that the scope step exists in every timed job. Pushes to `main` always run everything.

## PR B.4 — small polish
- Self-host the brand fonts (pages use system fonts today) only if they are freely licensed; otherwise keep system fonts
  and close the item. Serve a `favicon.ico` (rewrite `/favicon.ico` → the existing 64px PNG route).

## Done when
- [ ] PR A merged with tests; PR B merged; webhook deliveries succeed on the new address; owner row for Setup URL added.
- [ ] `wc -l docs/STATUS.md` under 400; `npm run session:status` still works.
