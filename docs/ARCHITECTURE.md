# ARCHITECTURE — runtime facts, as built

This file describes what **exists**, and is updated in the same PR that ships it (DRIFT-PROTOCOL checklist B). What the
system is designed to become is in `docs/designs/`; do not copy design text here before it is built.

As of 2026-10-10: **nothing is built yet.** The repository holds the plan only (docs and `scripts/count-catalog.py`).

## Infrastructure

| Piece | State |
|---|---|
| GitHub repository `Robinson-AI-Systems/github-mcp` | Local plan commits only (not pushed by the planning session) |
| Runtime | Node **24.x** (DECISIONS 2026-10-10; Vercel disabled Node 20 for new deployments on 2026-10-01). Set by A-1 in `package.json` `engines` and in every CI job |
| GitHub Actions CI | Not created (A-1) |
| Vercel project | Not created (IN-02) |
| Neon database | Not created (IN-02) |
| GitHub Apps | None created (IN-04, A-5) |
| GitHub credentials | None stored |

## Environment variables

None yet. Batch A defines `DATABASE_URL`, `ADMIN_PASSPHRASE`, `PUBLIC_BASE_URL`, `TOKEN_ENCRYPTION_KEY`; Vercel itself
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
