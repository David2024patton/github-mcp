# STATUS — current work, blockers and next action

Updated 2026-10-10. **The foundation is built (A-1, PR #1), its database schema exists (A-2, PR #7), the connector login is built (A-3a, PR #8; A-3b, PR #9) the GitHub client exists (A-4, PR #10) the encrypted credential store exists (A-5a, PR #11) the private setup page exists (A-5b, PR #12) and the GitHub webhook and first two tools exist (A-5c, PR #13):** Node 24
package with a committed lockfile, a fake GitHub for tests, the check scripts, throwaway-Postgres database tests, CI with
one `ci` merge gate, `src/db.js` creating the 13 foundation tables and storing connector logins, the OAuth endpoints and `/api/mcp` (two tools, `github_whoami` and `github_list_accounts`, listed but not yet callable: Batch B's guarded dispatcher is what lets a tool run), and `src/github/client.js` (pinned API version, request keys, write spacing, rate blocks, ETag cache) with GitHub's REST and GraphQL descriptions vendored, and `src/github/credentials.js` (encrypted Apps, installation tokens, user authorization, pasted tokens) with one-time secrets. No deployment exists. No GitHub App, credential, Vercel project or Neon database exists for this server; nothing here touches Chris's real
repositories.

## Next

- **A-6 — `docs/DEPLOY.md` (docs only, light effort):** card `docs/pr-cards/A-6.md` (write it first if missing; JIT). Branch `ai/claude/a-6-deploy-doc` from `main`. Then Batch B (safety layer, `docs/designs/BATCH-B.md`). Real GitHub steps need IN-02…IN-05.
- **Known follow-ups:** port the empty-passphrase fix in `secretsMatch` to stripe-mcp and the hub core (other repos: tell Chris, do not edit); the manifest's permission names are unverified until the first real App creation.
- **Answered 2026-10-10 (Chris):** IN-00 — plan approved ("I approve the plans"); IN-01 — **no automated review** ("I don't want the automated review at this time"); the repository stays public as Chris created it; the implementer self-reviews every diff.
- **Queue:** A → B → C → D → E → G → V → F → H → O → P → W → U → R → X (`MASTER-ROADMAP.md`).

## Environment

- Repo: `Robinson-AI-Systems/github-mcp` (public), default branch `main`. Every change goes through an `ai/*` branch and
  a PR; the `ci` check is the merge gate.
- Runtime: Node 24.x (`package.json` engines, every CI job). GitHub REST API version to pin: `2026-03-10` (still the
  newest on 2026-10-10).
- Dev commands (all finish by themselves): `npm ci`, `npm run check`, `npm test` (unit), `npm run test:db` (throwaway
  Postgres: CI service, or local binaries — works as root), `npm run test:shapes` (Octokit against the fake GitHub).
- Vercel project, Neon database, GitHub Apps: not created yet (IN-02, IN-03, IN-04, IN-05).

## Recent changes (newest first)

**2026-10-11 — A-5c webhook and server tools (PR #13):** `api/github/webhook.js` + `src/github/webhook.js`. GitHub's call is read as raw bytes (1 MB cap, 413 beyond), the App is found by `X-GitHub-Hook-Installation-Target-ID`, and
`X-Hub-Signature-256` is checked in constant time with that App's own webhook secret; a bad, missing or malformed signature, an unknown App and a non-numeric App id all get the same plain 401 and change nothing. Verified events
update the stored account: `installation` created (only for an account already set up for this very App), deleted, suspend (also drop cached installation tokens), unsuspend, new_permissions_accepted (new permissions stored, cached tokens
dropped); `installation_repositories` (selection); `github_app_authorization` revoked (clears that user's stored sign-in). Everything else is acknowledged and ignored; no payload or secret is echoed or logged. `src/tools/server.js`:
`github_whoami` (connection mode, profile, listing, default account, API version, per-account credentials present, rate budget left with Denver-time reset, spend limit in dollars) and `github_list_accounts`; both take `detail` and `fields`,
only name the connection's own accounts, build every field by name (no ciphertext can leak), and need no GitHub call. Tests: `webhook` (12), `server-tools` (7), registry and home-page tests updated. 227 unit, 49 database, 15 shapes green.
Not done / unverified: nothing has run against real GitHub (no App exists); the tools cannot be called until Batch B supplies the guarded dispatcher.

**2026-10-10 — A-5a credential store (PR #11):** every GitHub credential is encrypted at rest with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`), each value sealed with a context that ties
it to its account, App, installation and scope, so a copied ciphertext cannot be reused elsewhere; a wrong or missing key gives a plain message and never a secret. `createCredentials`
supplies the client's `token({ account, cred, scope })`: installation tokens minted with a hand-signed App JWT, cached until five minutes before expiry and downscoped per connection (each
scope its own token); the owner's user token refreshed ten minutes before expiry (a lost refresh race uses the other instance's new tokens, a refused refresh asks for sign-in again); a
fine-grained token for accounts that use one (cannot be narrowed — says so); the classic notifications token only for `K`. `storeApp` keeps the manifest flow's key, client secret and
webhook secret as ciphertext. One-time secrets (ten minutes, read-and-delete) and setup states (single use, bound to a purpose) are stored. `listAccounts` never returns ciphertext.
Also fixed A-4's test helper: nested body schemas now validate and JSON bodies are no longer type-coerced. Tests: 174 unit, database and request-shape suites green. No setup page yet (A-5b);
no real credential exists.

**2026-10-10 — A-4 GitHub client (PR #10):** `src/github/client.js` is the only file that imports `@octokit/*`. `githubFor(ctx, { owner, cred, scope })`
refuses an account outside the connection (`outside_scope`) or without a credential (`no_credentials`), sends `X-GitHub-Api-Version: 2026-03-10` on
every call, never retries a write (or a GraphQL mutation) after an error, spaces writes one second apart per installation across instances
(`claimWriteSlot`, one atomic statement), records GitHub's rate headers per account and resource and refuses calls while blocked with the
reset time in Denver time (`rate_limited`), honours `retry-after` only inside a 20-second budget, and can cache a polled read by ETag
(`request: { etag: true }`; a 304 returns the stored body). `requestKey` gives writes their retry-proof key; `listAll` follows `Link` to a cap and
says when it stopped. Vendored: GitHub's REST description for 2026-03-10 (rest-api-description @ 58b1e0c0, 1,232 operations) and GraphQL schema
(github/docs @ be38ec5d), each with `SOURCE.md`; `scripts/openapi-find.mjs` and `scripts/graphql-find.mjs` search them. The fake GitHub now knows every
operation and rejects any request that does not match the description (including unknown body fields) or any GraphQL document that does not match the
schema. The secret scan skips only the two vendored data files (their examples contain token-shaped text). Tests: 138 unit, 38 database, 15 request-shape.
No real GitHub call was made; no credential exists.

**2026-10-10 — A-3b connector login endpoints (PR #9):** `api/oauth/{register,authorize,token}`, `api/well-known/*` (rewritten
from `/.well-known/*` by `vercel.json`), `api/mcp.js`, `api/index.js`. Contract-generic `src/core/{http,oauth-handlers,mcp-auth,
mcp-server}.js` take an injected policy; the GitHub rules are in `src/oauth/policy.js`: the authorize page lists the accounts
(checkboxes + default), mode, profile, listing and the passphrase; **production is refused unless the deployment is the production
one and every selected account has `production_enabled`**; settings are examined only after the passphrase is right; a missing
`ADMIN_PASSPHRASE` fails closed; the code → token grant copies every connection setting from the issuing row, refresh rotates on the
same row. `/api/mcp` authenticates the bearer and lists the registry's tools (none yet); every `tools/call` is refused by the default
dispatcher until Batch B supplies a guarded one. `src/runtime.js` creates the schema once per instance. Tests: handler round trips,
production refusals, lockout, escaping, MCP over a local HTTP server, and one full flow on throwaway Postgres.
Nothing was run against a deployed server (none exists; IN-02).

**2026-10-10 — A-3a connector login store (PR #8):** `src/core/oauth.js` (copied from `stripe-mcp` @ 90a49c0: token hashing,
PKCE S256, redirect validation, client address, 5-failures-in-15-minutes lockout) with one fix — an empty submitted
passphrase used to crash the login check instead of counting as wrong (port back to the source and the hub core).
`src/db.js` gained `checkConnection` (refuses a connection with no accounts, a default outside the list, or an unknown
mode, profile or listing) and the store: clients, single-use codes, access tokens, atomic refresh on the same row for the
same client, revocation, login-attempt counting, `listAccountsForLogin`. Codes, tokens and client secrets are hashed. Fake
database mirrors it; one shared contract (`test/contract/oauth-contract.js`) runs against the fake and real Postgres.
Tests: `tests/unit/oauth-core.test.js`, `tests/unit/oauth-store.test.js`, `tests/db/oauth.test.js`. No endpoints yet (A-3b).

**2026-10-10 — A-2 foundation schema (PR #7):** `src/db.js` — `SCHEMA_TABLES` (13 tables), `CONNECTION_FIELDS` and
`connectionSettings(row)`, `productionSql()` (lazy Neon client, plain error when `DATABASE_URL` is missing, nothing at
import time), `createDb(sql)` → `{ initSchema(), listTables() }`; `initSchema()` runs the §2 `CREATE … IF NOT EXISTS`
statements one per call, in order (idempotent, no drops, no data). Fake database gained `initSchema`/`listTables`.
Tests: `tests/unit/schema.test.js`, `tests/db/schema.test.js` (exact table set, idempotence, defaults, keys, no plaintext
secret column). The two expiry timestamps `user_token_expires_at` / `user_refresh_expires_at` are allow-listed in that
scan. No Neon database exists yet (IN-02); nothing was run against a real one.

**2026-10-10 — CI cadence (docs + CI config PR #5):** never push while a PR's CI run is in progress (SESSION-START §6,
PLAYBOOK Step 5); obsolete PR runs are cancelled, runs on `main` never are. Next action unchanged.

**2026-10-10 — A-1 foundation merged (PR #1):** `package.json` (Node 24.x, pinned dependencies, lockfile), ESLint,
three Vitest suites (unit, db, shapes), `scripts/check-secrets.mjs` (scans tracked files for GitHub tokens, PEM keys,
non-local database URLs, Neon/Vercel identifiers, committed `.env`), `check-docs-updated`, `check-writes` and
`check-budgets` (starting form), `check-core-imports`, `count-catalog.py` and the index validator in `npm run check`;
`scripts/local-postgres-test.sh`; `test/helpers/fake-github.js`; CI jobs check, unit, db, shapes and the aggregate `ci`.
A deliberately failing test turned `unit` and `ci` red once (https://github.com/Robinson-AI-Systems/github-mcp/actions/runs/38077330755), then was removed; the final run is green at the
exact head (linked in PR #1). Actions pinned to `actions/checkout@v7` and `actions/setup-node@v7` (Node 24 runtimes). Cards A-2 and A-3
written.


**2026-10-10 — Gap check against prior toolkits (local commit):** every GitHub tool name Chris built or planned in
`robinsons-toolkit-mcp`, `robinsonai-mcp-servers` and `robinsons-toolkit-api` (528 names) mapped to this plan in
`docs/audits/2026-10-10-prior-tools.md`: 432 covered by hand-built tools, 59 by the universal tools, 34 dropped with
evidence (GitHub retired the endpoint, Enterprise-only, or out of scope), and 4 gaps added — `github_content_check_codeowners`,
`github_release_delete_asset`, `github_package_delete`, `github_security_compare_dependencies`. Catalog now 305 tools
(299 hand-built + 6 universal). Cortiware, oldReplit and Household-Assistant were checked for GitHub needs too.

**2026-10-10 — Plan completed (local commits):** process and acceptance files (PLAN, MASTER-ROADMAP, STATUS,
AI-PR-READ-FIRST, ARCHITECTURE, GO-LIVE-CHECKLIST, DECISIONS, ROADMAP, OWNER-GUIDE), the Appliance Desk profile
(`APP-NEEDS-APPLIANCE-DESK.md`, rows G1–G20), drift protocol and archive index. The catalog counter moved to
`scripts/count-catalog.py`; profile tools renamed `github_profile_*` so they no longer share a prefix with GitHub
Projects tools; a dated amendment lets a profile allow its own agent steps on an owned branch (Appliance Desk's
`transfer/**`).

**2026-10-10 — Plan written (initial commits):** AGENTS, START-HERE, SESSION-START, PLAYBOOK, research audit (GitHub API,
credentials, old toolkit's 311 tools and 20 bugs, official connector comparison), 15 batch designs, TOOL-CATALOG (301 tools:
295 hand-built + 6 universal, every name `github_…`), owner inputs IN-00 … IN-14, work index (64 cards since the old-toolkit decision note was dropped) with validator,
first card A-1.

## Blocked

Nothing in engineering. IN-00 and IN-01 answered; owner inputs IN-02 … IN-13 (`OWNER-INPUTS.md`; IN-14 answered: not needed)
are open and none blocks A-4.

## Unverified (each has an owner card)

- Paid security feature prices per active committer (O-4 §0 row O4) — read GitHub's pricing page before O-4 and H-4 merge.
- Whether Appliance Desk's `main` ruleset also blocks force pushes and deletion (APP-NEEDS row G3) — P-2 reads it.
- That `2026-03-10` is still the newest REST version when A-4 starts (BATCH-A §0 row A2).
