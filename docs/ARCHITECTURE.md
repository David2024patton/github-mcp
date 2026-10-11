# ARCHITECTURE — runtime facts, as built

This file describes what **exists**, and is updated in the same PR that ships it (DRIFT-PROTOCOL checklist B). What the
system is designed to become is in `docs/designs/`; do not copy design text here before it is built.

As of 2026-10-10 (A-3b, PR #9): **the repository tooling, the foundation database layer, the connector login and the
`/api/mcp` endpoint (two read-only tools) are built; nothing is deployed.** Built: `package.json`, check scripts, test helpers (fake GitHub, fake database, throwaway
Postgres), CI, `src/db.js` (lazy Neon client, `createDb(sql)`, the 13 foundation tables, the login store), `src/core/{oauth,http,oauth-handlers,mcp-auth,mcp-server}.js`, `src/oauth/{policy,routes}.js`, `src/runtime.js`, `api/`.

## Infrastructure

| Piece | State |
|---|---|
| GitHub repository `Robinson-AI-Systems/github-mcp` | Public; plan and A-1 on `main`; changes only through `ai/*` PRs |
| Runtime | Node **24.x** (DECISIONS 2026-10-10; Vercel disabled Node 20 for new deployments on 2026-10-01): `package.json` `engines` `24.x`, `"type": "module"`, `actions/setup-node` `node-version: 24` in every CI job |
| Dependencies | Pinned exactly, `package-lock.json` committed; `npm ci`. Runtime: `@modelcontextprotocol/sdk` 1.32.1, `@neondatabase/serverless` 1.2.0, `@octokit/core` 7.0.8, `@octokit/plugin-paginate-rest` 16.0.0, `@octokit/plugin-throttling` 11.0.5, `@octokit/plugin-retry` 8.1.1, `@octokit/auth-app` 8.3.1, `@octokit/webhooks` 14.2.0, `libsodium-wrappers` 0.8.4. Dev: `vitest` 5.0.3, `pg` 8.23.1, `eslint` 10.12.0, `ajv` 8.20.0, `ajv-formats` 3.0.1, `graphql` 17.0.2 |
| GitHub Actions CI | `.github/workflows/ci.yml` on `pull_request` and push to `main`; `permissions: contents: read`; no secrets; no `pull_request_target`; `actions/checkout@v7`, `actions/setup-node@v7`. Jobs: `check` (`npm run check`: secret scan, docs check, index validation, catalog count, lint, write-safety, token budgets, core imports), `unit` (`npm test`), `db` (`npm run test:db` on a Postgres 17 service from `public.ecr.aws/docker/library/postgres:17`), `shapes` (`npm run test:shapes`); aggregate **`ci`** (`if: always()`) fails unless all four are `success` — the single merge gate. A push cancels the branch's running CI |
| Test harness | `test/helpers/fake-github.js` (`makeFakeGitHub()` → `{ fetch, calls, unmatched, graphql, when, routes }`, passed to Octokit as `request.fetch`; A-1 route list, A-4 adds the vendored description and validation); `test/helpers/fake-db.js` (`createFakeDb({ clock })`: key/value rows, `initSchema()`/`listTables()`, and the login store; `seedAccounts()` is its test seam for `gh_accounts`); `test/contract/oauth-contract.js` (one login-store contract run against the fake and real Postgres); `test/helpers/pg-neon-adapter.js` (isolated `github_mcp_test_*` schema, Neon-shaped tagged queries); `test/contract/db-contract.js`; `scripts/local-postgres-test.sh` (CI service via `TEST_DATABASE_URL`, else a temporary local cluster; localhost only) |
| Tool registry | `src/tools/index.js` exports `registry` from `src/core/registry.js` `mergeNamespaces` (duplicate names throw); 2 tools (`github_whoami`, `github_list_accounts`, `src/tools/server.js`). `/api/mcp` dispatches through `src/tools/dispatch.js` (`createDispatch`), which is default-deny: it runs read-only tools and `defineWrite-v1` tools only, checks arguments against the tool schema (`src/core/validate.js`) and withholds any result shaped like a credential; profile-based hiding arrives in B-6 |
| Vercel project | Not created (IN-02) |
| Neon database | Not created (IN-02) |
| GitHub Apps | None created (IN-04; the setup page exists, A-5b) |
| GitHub credentials | None stored |

## Environment variables

Never record values here. Vercel itself provides `VERCEL_ENV`.

| Variable | Read by | Meaning | Environments |
|---|---|---|---|
| `DATABASE_URL` | `productionSql()` in `src/db.js`, on first database use (never at import) | This server's own Neon database (IN-02) | Production, Preview |
| `PUBLIC_BASE_URL` | `publicOrigin()` in `src/core/http.js` | The server's HTTPS origin with no path, used for the OAuth issuer and the MCP resource; never taken from a request header. Missing or malformed → the OAuth endpoints answer 503 | Production, Preview |
| `ADMIN_PASSPHRASE` | the authorize handler in `src/core/oauth-handlers.js` | The login passphrase (IN-03). Missing → sign-in fails closed with 503 | Production, Preview |
| `TOKEN_ENCRYPTION_KEY` | `readEncryptionKey()` in `src/core/crypto.js`, through `createCredentials` (`src/github/credentials.js`) | A base64 32-byte key (AES-256-GCM) that encrypts every GitHub credential at rest (IN-03). Missing or malformed → nothing can be stored or read, and the message says what to set | Production |
| `VERCEL_ENV` (Vercel) | `src/oauth/policy.js` | `production` is the only value that allows production mode (A10) | set by Vercel |

CI uses only `TEST_DATABASE_URL` (db job, localhost) and `BASE_SHA` (check job,
from the PR event).

## Database tables

Created by `createDb(sql).initSchema()` in `src/db.js` (A-2), one `CREATE … IF NOT EXISTS` per call, idempotent, no drops
and no data rows. `SCHEMA_TABLES` lists them in this order; columns are exactly those of `docs/designs/BATCH-A.md` §2.
Credentials are ciphertext (`*_enc`) or hashes (`*_hash`) only; `tests/db/schema.test.js` fails on any other
secret-looking column name.

| Table | Holds |
|---|---|
| `gh_apps` | The private GitHub App per account: App ID, slug, owner, client ID, encrypted client secret, private key and webhook secret, granted permissions |
| `gh_accounts` | One row per GitHub account Chris uses (login key): credential kind (`app` default), installation and status (`none` default), encrypted user, fine-grained and classic credentials with last four characters, plan, `production_enabled` (false), `spend_limit_cents` (0), default and scratch flags |
| `gh_installation_tokens` | Encrypted installation tokens per (installation, scope key) with expiry |
| `setup_states` | Short-lived setup-page states (manifest, user authorization) with an encrypted PKCE verifier |
| `oauth_clients` | Registered connector clients |
| `oauth_codes` | One-time authorization codes with the connection's default account, account list, mode (`preview`), profile (`everyday`), listing (`catalog`) |
| `oauth_tokens` | Hashed access and refresh tokens with the same connection fields, `kind` (`connector`), expiry, last use, revocation |
| `login_attempts` | Passphrase attempts per address (lockout counting) |
| `change_log` | One row per write attempt: who, where, tool, summary, before/after, dry-run, confirmation, production and access flags, spend, request key, GitHub request ID, inverse, undone-by |
| `one_time_secrets` | Ciphertext shown once on the setup page, with expiry and viewed time |
| `gh_rate_state` | Last known GitHub rate headers and `blocked_until` per (account, resource) |
| `gh_write_slots` | Next allowed write time per installation (write spacing across instances) |
| `gh_etag_cache` | ETags and bodies for polled reads per (account, URL key) |

Login store (A-3a, `createDb(sql)` in `src/db.js`): codes, access tokens, refresh credentials and client secrets are stored
as SHA-256 hashes only; a code is deleted as it is consumed (single use); refresh is one atomic `UPDATE` on the same row for
the same client, so every connection setting (`CONNECTION_FIELDS`) stays as issued; `checkConnection` refuses a connection
with no accounts, a default account outside the list, or an unknown mode, profile or listing (`production` is still decided
by the login endpoint, A-3b). Failed logins are counted per address in `login_attempts` (5 in 15 minutes lock it).

Index: `change_log_request_key` on `change_log (request_key, at)` (replay lookup). Later batches add their own tables,
always `IF NOT EXISTS`, and list them here when they exist. No Neon database exists yet (IN-02): the schema has run only
on throwaway localhost Postgres.

## Endpoints

| Path | File | What |
|---|---|---|
| `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` | `api/well-known/*` via `vercel.json` rewrites | Fixed HTTPS metadata (S256 PKCE only, `client_secret_post`) |
| `/api/oauth/register` | `api/oauth/register.js` | Client registration (1–8 distinct HTTPS or localhost redirect URIs); the secret is returned once, stored hashed |
| `/api/oauth/authorize` | `api/oauth/authorize.js` | GET: account checkboxes + default, mode, profile, listing, passphrase. POST: passphrase (5 wrong in 15 minutes lock the address), then the choices; `production` only on the production deployment and only when every selected account has `production_enabled` |
| `/api/oauth/token` | `api/oauth/token.js` | `authorization_code` (single-use code, PKCE, copies every connection setting from the code) and `refresh_token` (atomic rotation on the same row, same client) |
| `/api/mcp` | `api/mcp.js` | Streamable HTTP MCP: bearer check (production token on a non-production deployment → 403), `tools/list` from the registry (2 tools), `tools/call` through the read-only dispatcher (anything not marked read-only is refused until Batch B) |
| `/` | `api/index.js` | Name, status and the registry's tool count; nothing secret |

Every OAuth or MCP failure that is not a clean refusal answers 503 `temporarily_unavailable` with no detail. Planned: the HTTPS tool API and manifest (Batch R).

| Path | File | What it does |
|---|---|---|
| `/api/github/setup` | `api/github/[action].js` | The owner's private page (A-5b). GET shows it, or finishes an App install (`?installation_id=`, read back from GitHub as the App). POST actions, each behind same-origin, CSRF token and passphrase: `status`, `start-app`, `start-user-auth`, `add-fine-grained`, `add-classic`, `reveal`. Credential steps need the production deployment and `TOKEN_ENCRYPTION_KEY` |
| `/api/github/manifest-callback` | same | GitHub returns the one-time code after App creation; converted once, keys stored encrypted, nothing secret shown |
| `/api/github/user-callback` | same | Owner authorization (PKCE S256); token exchanged server-side and stored encrypted |

| `/api/github/webhook` | `api/github/webhook.js` | GitHub App deliveries (A-5c). Raw body; `X-Hub-Signature-256` checked against the stored webhook secret of the App named in `X-GitHub-Hook-Installation-Target-ID` (bad or unknown → 401, nothing stored). Handles `installation` (created, deleted, suspend, unsuspend, new_permissions_accepted), `installation_repositories` and `github_app_authorization` (revoked → owner sign-in dropped); anything else is acknowledged and ignored. Installations on accounts that do not own the App are ignored |

One dynamic function serves the three (`src/github/routes.js`) because Vercel Hobby allows 12 functions; unknown names answer 404, failures 503 without detail.

## GitHub API version and descriptions

REST `X-GitHub-Api-Version: 2026-03-10` is pinned in `src/github/client.js` (`GITHUB_API_VERSION`, A-4) and sent on every call. The
matching descriptions are vendored: `vendor/github-openapi/api.github.com.2026-03-10.json` (rest-api-description @ 58b1e0c0, 1,232
operations) and `vendor/github-graphql/schema.docs.graphql` (github/docs @ be38ec5d); each has a `SOURCE.md` with URL, commit, sha256 and
date, and a test checks the hash. Search them with `node scripts/openapi-find.mjs "<words>"` (`--show "<METHOD /path>"`) and
`node scripts/graphql-find.mjs <name>`; never read them whole. Moving the version is its own card.

### Credentials (A-5a)

`src/github/credentials.js`: `token({ account, cred, scope })` returns the plain token for one request only. `cred I` is the App installation token (cached in
`gh_installation_tokens`, ciphertext, one row per downscoping) or the account's fine-grained token; `U` is the owner's user authorization (refreshed ten minutes before expiry);
`K` is the classic notifications token. Every stored value is AES-256-GCM ciphertext with a context naming its owner (`github-mcp/account/<login>/…`, `github-mcp/app/<id>/…`,
`github-mcp/installation/<id>/<scope>`). `src/core/one-time-secrets.js` holds secrets that may be shown once on the setup page (ten minutes, deleted by the read).

### GitHub client (A-4)

| Piece | Behaviour |
|---|---|
| `githubFor(ctx, { owner, cred, scope })` | One Octokit per request. `ctx = { connection, db, credentials, fetch?, now?, sleep?, budgetMs? }`; `credentials.token({ account, cred, scope })` is supplied by A-5. `cred` is `I` installation, `U` user or `K` fine-grained token |
| Writes | Never retried after an error; each waits for its `gh_write_slots` turn (1 s apart per account and credential kind, across instances; refused with `rate_limited` if the queue is over 5 s) |
| Reads | Retried twice on 5xx; `request: { etag: true }` sends `If-None-Match` from `gh_etag_cache` and returns the stored body on a 304 (`notModified: true`) |
| Rate limits | Every response's headers go to `gh_rate_state`; a spent budget or a `retry-after` on 403/429 blocks that account and resource; waits are honoured only inside the 20 s budget, otherwise `rate_limited` with the reset in Denver time |
| `requestKey(ctx, tool, args)` | `rmcp_<tool>_<sha256>_<10-minute bucket>`; ignores `dryRun`, `confirm`, `fields`, `detail`; a caller `requestKey` replaces the arguments |

### Write layer (B-1)

Every change-making tool is built with `defineGithubWrite` (`src/tools/define-github-write.js` over the contract-generic `src/core/write.js`). It always runs, in
this order: connection and target checks (profile, account in the connection) -> read current state -> classify (production, access change, people notified, spend) ->
refuse what the connection's mode forbids (a production change on a preview connection, including when the state could not be read) -> the ordered guard gates
(`src/tools/gates.js`, `ctx.gates`) -> plain-English preview with marks (PRODUCTION, ACCESS CHANGE, NOTIFIES, COSTS) -> `dryRun` stops -> ask first when anything
needs confirmation -> claim the request key (`change_log_request_once`, a unique index; an identical request in the same 10 minutes is a replay) -> send once ->
read back and compare -> finish the row (inverse stored for undo). Refusals and previews are logged; a definite GitHub "no" frees the key, an uncertain outcome keeps it.
Tests for any write tool use `test/helpers/write-contract.js` (nine checks through every door).

## GitHub App permissions

None granted yet. The requested list lives in `src/github/app-manifest.js` (A-5b; repository and organization permissions only, no account permissions until Batch O) and `docs/DEPLOY.md` (A-6); record the
permissions actually granted per account here once Chris installs the Apps.
