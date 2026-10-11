# ARCHITECTURE — runtime facts, as built

This file describes what **exists**, and is updated in the same PR that ships it (DRIFT-PROTOCOL checklist B). What the
system is designed to become is in `docs/designs/`; do not copy design text here before it is built.

As of 2026-10-10 (A-2, PR #7): **the repository tooling and the foundation database layer are built; no tools or
endpoints exist yet.** Built: `package.json`, check scripts, test helpers (fake GitHub, fake database, throwaway
Postgres), CI, `src/db.js` (lazy Neon client, `createDb(sql)`, the 13 foundation tables).

## Infrastructure

| Piece | State |
|---|---|
| GitHub repository `Robinson-AI-Systems/github-mcp` | Public; plan and A-1 on `main`; changes only through `ai/*` PRs |
| Runtime | Node **24.x** (DECISIONS 2026-10-10; Vercel disabled Node 20 for new deployments on 2026-10-01): `package.json` `engines` `24.x`, `"type": "module"`, `actions/setup-node` `node-version: 24` in every CI job |
| Dependencies | Pinned exactly, `package-lock.json` committed; `npm ci`. Runtime: `@modelcontextprotocol/sdk` 1.32.1, `@neondatabase/serverless` 1.2.0, `@octokit/core` 7.0.8, `@octokit/plugin-paginate-rest` 16.0.0, `@octokit/plugin-throttling` 11.0.5, `@octokit/plugin-retry` 8.1.1, `@octokit/auth-app` 8.3.1, `@octokit/webhooks` 14.2.0, `libsodium-wrappers` 0.8.4. Dev: `vitest` 5.0.3, `pg` 8.23.1, `eslint` 10.12.0, `ajv` 8.20.0, `ajv-formats` 3.0.1, `graphql` 17.0.2 |
| GitHub Actions CI | `.github/workflows/ci.yml` on `pull_request` and push to `main`; `permissions: contents: read`; no secrets; no `pull_request_target`; `actions/checkout@v7`, `actions/setup-node@v7`. Jobs: `check` (`npm run check`: secret scan, docs check, index validation, catalog count, lint, write-safety, token budgets, core imports), `unit` (`npm test`), `db` (`npm run test:db` on a Postgres 17 service from `public.ecr.aws/docker/library/postgres:17`), `shapes` (`npm run test:shapes`); aggregate **`ci`** (`if: always()`) fails unless all four are `success` — the single merge gate. A push cancels the branch's running CI |
| Test harness | `test/helpers/fake-github.js` (`makeFakeGitHub()` → `{ fetch, calls, unmatched, graphql, when, routes }`, passed to Octokit as `request.fetch`; A-1 route list, A-4 adds the vendored description and validation); `test/helpers/fake-db.js` (key/value rows plus `initSchema()`/`listTables()` recording `SCHEMA_TABLES`); `test/helpers/pg-neon-adapter.js` (isolated `github_mcp_test_*` schema, Neon-shaped tagged queries); `test/contract/db-contract.js`; `scripts/local-postgres-test.sh` (CI service via `TEST_DATABASE_URL`, else a temporary local cluster; localhost only) |
| Tool registry | `src/tools/index.js` exports `registry` from `src/core/registry.js` `mergeNamespaces` (duplicate names throw); 0 tools |
| Vercel project | Not created (IN-02) |
| Neon database | Not created (IN-02) |
| GitHub Apps | None created (IN-04, A-5) |
| GitHub credentials | None stored |

## Environment variables

`DATABASE_URL` (Neon connection string; read lazily by `productionSql()` in `src/db.js` on first database use, never at
import; Vercel Production and Preview, set by the owner, IN-02). No other variable is read by server code yet. CI uses only `TEST_DATABASE_URL` (db job, localhost) and `BASE_SHA` (check job, from the PR
event). Batch A defines `ADMIN_PASSPHRASE`, `PUBLIC_BASE_URL`, `TOKEN_ENCRYPTION_KEY` (besides `DATABASE_URL`); Vercel itself
provides `VERCEL_ENV`. CI will use only `TEST_DATABASE_URL` (localhost) and values derived from the PR event. Record each
variable here with its environments when the card that reads it ships. Never record values.

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

Index: `change_log_request_key` on `change_log (request_key, at)` (replay lookup). Later batches add their own tables,
always `IF NOT EXISTS`, and list them here when they exist. No Neon database exists yet (IN-02): the schema has run only
on throwaway localhost Postgres.

## Endpoints

None yet. Planned: OAuth connector (`/api/oauth/*`, `/.well-known/*`), `/api/mcp`, the setup page and GitHub callbacks
(`/api/github/*`), the HTTPS tool API and manifest (Batch R).

## GitHub API version and descriptions

Planned pin: REST `X-GitHub-Api-Version: 2026-03-10` in `src/github/client.js` (A-4), with the OpenAPI description and
the GraphQL schema for that version vendored under `vendor/github-openapi/` and `vendor/github-graphql/` (each with
`SOURCE.md`). Not vendored yet.

## GitHub App permissions

None granted yet. The requested list lives in `src/github/app-manifest.js` (A-5) and `docs/DEPLOY.md` (A-6); record the
permissions actually granted per account here once Chris installs the Apps.
