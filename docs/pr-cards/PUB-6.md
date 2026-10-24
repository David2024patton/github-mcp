# PUB-6 — Simple public connect: sign in with GitHub, normal and "God mode"

**Stage: BUILT DARK in one whole-outcome PR.** Owner-approved 2026-10-23 (see `docs/DECISIONS.md`). Off unless `GITHUB_PUBLIC_CONNECT=enabled` on the production deployment; the GitHub App is **not** made public without Chris's explicit go-ahead.

## Drift check before implementation

- Reuses PUB-1..PUB-4 (tenant-per-schema isolation, `tcl_/tac_/trf_` credentials, pilot allowlist, optional K/P credentials, runtime limits) and the CAP-3 optional-credential enrollment. Nothing is rewritten; public clients (`pcl_`) are an additional, separately routed kind.
- Unchanged hard limits: no real credential used from tests (fakes only), no live write, no spend, no secret in code or docs.

## Outcome

A person with only a GitHub login connects an MCP app: register (public client, hash-only secret) → branded consent page → GitHub sign-in → server finds the App installed on the account(s) they can see (or sends them to GitHub's one-click install and resumes) → their own isolated tenant is created on first sign-in → their sealed GitHub authorization is stored per account → the app receives an authorization code. **Normal** unlocks every tool GitHub sign-in alone can authorize; Changes are on by default for accounts the person owns (own account, or an organization where GitHub says they are an admin), shown as a clear tick-box on the sign-in page; each change still needs the per-action confirm. Unticked means preview only. **God mode** adds guided steps for the extra keys (notifications, package) on a protected page only. One sign-in can connect several of the person's own accounts (own, a client's organization, test accounts).

## Acceptance criteria

1. [x] Off by default; the kill switch and production-only rule hold (test: "is completely off unless…").
2. [x] Public clients register with validation and caps; only a secret hash is stored (test: "registers public clients (hash only)…").
3. [x] Sign-in → tenant → tokens → refresh works, for several accounts in one connection, each with its own sealed grant (tests: "signs a developer in once…", "connects only the named accounts…").
4. [x] People are isolated: separate tenants, a code carried to another person or forged marker is refused, single-use state and code, wrong secret and cookie refused (tests: "gives each person their own isolated tenant…", "rejects a mismatched browser cookie…").
5. [x] No installation → GitHub install and resume; still missing → a clear message (test: "sends a person with no installation to GitHub…").
6. [x] Hard caps on public clients, open sign-ins and self-serve tenants (test: "holds hard caps…").
7. [x] God mode: per-account extra keys, same-person proof for a pasted token, finishes with a working multi-account code (tests in "God-mode keys…").
8. [x] The MCP gate refuses a public connection after the client is deleted or the person is revoked (test: "the MCP gate refuses…").
9. [x] Branded pages (Robinson AI Systems colors) and a product icon listed on the MCP server (test: "PUB-6 branding").

## Not in this piece (named remaining items, `docs/ROADMAP.md`)

Making the GitHub App publicly installable (needs Chris's go-ahead); fine-grained-token tenants; revoking/deleting a stranger's data by identity; the 8-part gradual-opening plan; moving the connector to `github.robinsonaisystems.com` (DNS lives at Spaceship; `docs/OWNER-CHECKLIST.md`); real-device acceptance of the new flow.

## Dangers

A typed account name is only a request: access always comes from the installations the person's own GitHub token can see. The routing marker on a code or client is a selector, never authority. Never log or return a GitHub bearer.

## 2026-10-23 addition — GOD-1 master token (owner request)
God mode on the public connector is one optional master token (kind `M`) instead of separate K/P pages, with a plain-steps page
and `github_master_token_link` to add or remove it later without reconnecting. See `docs/designs/GOD-TOKEN.md`,
`docs/status/2026-10-23-god-1-master-token.md`. Remaining: GOD-2 (tools only M can reach), GOD-3 (expiry reminders, summary).
Follow-up 2026-10-23: master token lifetime is the person's own choice on GitHub (no cap of ours); whoami reminds within 14 days of expiry.

## 2026-10-23 redesign — browser-tested, cookie-free sign-in and "My connection" (owner request)
Chris asked for a review of the sign-in troubles and approved all four fixes. Why: about ten guess-fix PRs in one day, each
needing a release and his phone, because the flow chained up to ten hops and depended on three cookies surviving in in-app
browsers, and nothing tested it in a real browser.

**Outcome:** the sign-in is app → GitHub once → one Approve page → app (an install page first only when no account of
theirs has the App); it needs no cookie; everything optional moved to a `/connection` page; and a real-browser suite runs
the whole thing in CI (Chromium as an Android phone and desktop, WebKit as an iPhone).

Acceptance (all in `tests/browser/sign-in.test.js` unless noted):
1. [x] The browser suite reproduces the two field failures on the OLD code (the stuck "loading bar" redirect chain, and
   "This page was already used" when cookies are lost) — checked by hand against the old code during development.
2. [x] First-time person installs the App inside the sign-in and is connected; returning person with a cookie-less
   browser is connected; both on every browser profile.
3. [x] No `Set-Cookie` anywhere in the sign-in ("sets no cookie anywhere").
4. [x] Nothing reaches an app until Approve; Cancel sends `access_denied`; the Approve page is one use; a form from another
   site is refused; someone else's sign-in link only shows their app's name and site (browser + db tests).
5. [x] Organization members who are not owners get a clear "ask an owner" page and nothing is connected.
6. [x] My connection: add an account later and the existing app gets it without reconnecting; read-only on/off; time
   zone; master token; disconnect one app; a person with no connection is told so and not enrolled.
7. [x] Delete my data works without cookies.
8. [x] Once public sign-in is on, the retired private-pilot sign-in takes no new sign-ins ("Connect again" page); new
   registrations always get the public flow.
9. [x] Database security tests rewritten for the new flow (`tests/db/pub-6-public-connect.test.js`, 27 tests).

## 2026-10-24 acceptance closeout (Chris asked an agent to do the phone/desktop checks for him)

Real-client results, all against the live service `https://github.robinsonaisystems.com` at `live=cb0ced613e2eb77f525733ccc007e5607ac16cba`:
- **Claude app** (this check, 2026-10-24): connected through the new public sign-in (whoami returns the My connection page,
  which only public connections get). PRODUCTION/full; accounts christcr2012 and robinson-ai-scratch; real reads returned
  data; a create returned a preview that needs confirmation (no write made); an account outside the connection was refused
  before reaching GitHub with a plain explanation. Earlier: Claude phone app 2026-10-22.
- **ChatGPT**: Android works (Chris, 2026-10-23); custom server reached as robinson-ai-scratch, read-only preview (2026-10-22).
- **Writes, read-back and clean-up** on scratch were recorded by ACC-1 on 2026-10-24 (`docs/developer-evidence.json`
  provider and cleanup layers). Pages on phone and desktop screens are covered by `npm run test:browser` (Android Chrome,
  iPhone Safari engine, desktop Chrome) on every PR.
- **Recorded as untested, not blockers (owner decision 2026-10-22):** the native Claude/ChatGPT *desktop* apps (this
  session could not reach Chris's computer), ChatGPT on iPhone, and revoking a grant from a device (revocation layer stays
  `unverified`; disconnect is covered by browser tests only).
Card status set to MERGED: all engineering merged (#268, #337); remaining device items are optional owner-checklist rows.
