# PUB-6 — Simple public connect: sign in with GitHub, normal and "God mode"

**Stage: BUILT DARK in one whole-outcome PR.** Owner-approved 2026-10-23 (see `docs/DECISIONS.md`). Off unless `GITHUB_PUBLIC_CONNECT=enabled` on the production deployment; the GitHub App is **not** made public without Chris's explicit go-ahead.

## Drift check before implementation

- Reuses PUB-1..PUB-4 (tenant-per-schema isolation, `tcl_/tac_/trf_` credentials, pilot allowlist, optional K/P credentials, runtime limits) and the CAP-3 optional-credential enrollment. Nothing is rewritten; public clients (`pcl_`) are an additional, separately routed kind.
- Unchanged hard limits: no real credential used from tests (fakes only), no live write, no spend, no secret in code or docs.

## Outcome

A person with only a GitHub login connects an MCP app: register (public client, hash-only secret) → branded consent page → GitHub sign-in → server finds the App installed on the account(s) they can see (or sends them to GitHub's one-click install and resumes) → their own isolated tenant is created on first sign-in → their sealed GitHub authorization is stored per account → the app receives an authorization code. **Normal** unlocks every tool GitHub sign-in alone can authorize; Connections are **preview-only** until a separate confirmed production step exists (named remaining item). **God mode** adds guided steps for the extra keys (notifications, package) on a protected page only. One sign-in can connect several of the person's own accounts (own, a client's organization, test accounts).

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

Production confirmation for signed-in people; making the GitHub App publicly installable (needs Chris's go-ahead); fine-grained-token tenants; revoking/deleting a stranger's data by identity; the 8-part gradual-opening plan; moving the connector to `github.robinsonaisystems.com` (DNS lives at Spaceship; `docs/OWNER-CHECKLIST.md`); real-device acceptance of the new flow.

## Dangers

A typed account name is only a request: access always comes from the installations the person's own GitHub token can see. The routing marker on a code or client is a selector, never authority. Never log or return a GitHub bearer.
