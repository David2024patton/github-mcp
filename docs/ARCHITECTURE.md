# ARCHITECTURE — runtime facts, as built

This file describes what **exists**, and is updated in the same PR that ships it (DRIFT-PROTOCOL checklist B). What the
system is designed to become is in `docs/designs/`; do not copy design text here before it is built.

As of 2026-10-10 (A-1, PR #1): **the repository tooling is built; no server code, tools, database tables or endpoints
exist yet.** Built: `package.json`, check scripts, test helpers (fake GitHub, fake database, throwaway Postgres), CI.

## Infrastructure

| Piece | State |
|---|---|
| GitHub repository `Robinson-AI-Systems/github-mcp` | Public; plan and A-1 on `main`; changes only through `ai/*` PRs |
| Runtime | Node **24.x** (DECISIONS 2026-10-10; Vercel disabled Node 20 for new deployments on 2026-10-01): `package.json` `engines` `24.x`, `"type": "module"`, `actions/setup-node` `node-version: 24` in every CI job |
| Dependencies | Pinned exactly, `package-lock.json` committed; `npm ci`. Runtime: `@modelcontextprotocol/sdk` 1.32.1, `@neondatabase/serverless` 1.2.0, `@octokit/core` 7.0.8, `@octokit/plugin-paginate-rest` 16.0.0, `@octokit/plugin-throttling` 11.0.5, `@octokit/plugin-retry` 8.1.1, `@octokit/auth-app` 8.3.1, `@octokit/webhooks` 14.2.0, `libsodium-wrappers` 0.8.4. Dev: `vitest` 5.0.3, `pg` 8.23.1, `eslint` 10.12.0, `ajv` 8.20.0, `ajv-formats` 3.0.1, `graphql` 17.0.2 |
| GitHub Actions CI | `.github/workflows/ci.yml` on `pull_request` and push to `main`; `permissions: contents: read`; no secrets; no `pull_request_target`; `actions/checkout@v7`, `actions/setup-node@v7`. Jobs: `check` (`npm run check`: secret scan, docs check, index validation, catalog count, lint, write-safety, token budgets, core imports), `unit` (`npm test`), `db` (`npm run test:db` on a Postgres 17 service from `public.ecr.aws/docker/library/postgres:17`), `shapes` (`npm run test:shapes`); aggregate **`ci`** (`if: always()`) fails unless all four are `success` — the single merge gate. A push cancels the branch's running CI |
| Test harness | `test/helpers/fake-github.js` (`makeFakeGitHub()` → `{ fetch, calls, unmatched, graphql, when, routes }`, passed to Octokit as `request.fetch`; A-1 route list, A-4 adds the vendored description and validation); `test/helpers/fake-db.js`; `test/helpers/pg-neon-adapter.js` (isolated `github_mcp_test_*` schema, Neon-shaped tagged queries); `test/contract/db-contract.js`; `scripts/local-postgres-test.sh` (CI service via `TEST_DATABASE_URL`, else a temporary local cluster; localhost only) |
| Tool registry | `src/tools/index.js` exports `registry` from `src/core/registry.js` `mergeNamespaces` (duplicate names throw); 0 tools |
| Vercel project | Not created (IN-02) |
| Neon database | Not created (IN-02) |
| GitHub Apps | None created (IN-04, A-5) |
| GitHub credentials | None stored |

## Environment variables

None read by server code yet. CI uses only `TEST_DATABASE_URL` (db job, localhost) and `BASE_SHA` (check job, from the PR
event). Batch A defines `DATABASE_URL`, `ADMIN_PASSPHRASE`, `PUBLIC_BASE_URL`, `TOKEN_ENCRYPTION_KEY`; Vercel itself
provides `VERCEL_ENV`. CI will use only `TEST_DATABASE_URL` (localhost) and values derived from the PR event. Record each
variable here with its environments when the card that reads it ships. Never record values.

## Database tables

None yet. A-2 creates the foundation tables of `docs/designs/BATCH-A.md` §2 (`gh_apps`, `gh_accounts`,
`gh_installation_tokens`, `setup_states`, `oauth_clients`, `oauth_codes`, `oauth_tokens`, `login_attempts`,
`change_log`, `one_time_secrets`, `gh_rate_state`, `gh_write_slots`, `gh_etag_cache`); later batches add their own,
always `IF NOT EXISTS`. List each table here when it exists.

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
