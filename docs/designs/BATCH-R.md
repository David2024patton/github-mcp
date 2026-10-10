# Design — Batch R: Hub-ready doors (Robinson Tool Contract, RTC 1)

Status: **APPROVED** (Chris, 2026-10-10). Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` →
Batch R. Cards R-1 … R-3. Depends on Batches B and C.

Same architecture as the Stripe MCP's Batch R (Chris, 2026-10-10): this server provides only the doors every Robinson
server provides under the **Robinson Tool Contract** (RTC 1, authority:
`https://github.com/Robinson-AI-Systems/robinsons-toolkit-hub/blob/main/docs/CONTRACT.md`): passes, the HTTPS tool API and
the contract manifest. The `rtool` CLI, code SDK, local MCP, GitHub relay and agent setup recipes are built once, in the
hub. **This server never depends on the hub** (standalone first).

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| R1 | `github_call` dispatches through wrapped handlers (C-2) | `grep -n "github_call" src/core/meta.js src/tools/*.js \| head` |
| R2 | The contract version is still RTC 1 | read the hub's `docs/CONTRACT.md` header; if newer, implement the newest and note it |
| R3 | The hub's conformance package exists (hub card K-2) | look for `packages/conformance` in the hub repo; if not yet, R-3 waits and R-1/R-2 proceed |

## 1. Decisions

**R1. Passes** (RTC §2): `oauth_tokens.kind = 'pass'`; created only by Chris with `github_create_pass` (confirm) or the
setup page; shown once on the one-time-secret page, never in chat. Defaults: **preview mode, `read_only`, 24 hours,
`allow_writes` false, `allow_access_changes` false, spend limit $0, all allowed accounts, all areas, no repository
limit**. Writes, production mode, access changes, a spend allowance, chosen accounts/areas/repositories and a longer life
(≤30 days; ≤365 days only for a pass marked "for Robinson's Toolkit") are explicit choices; **production + writes also
needs the setup-page passphrase**. A pass limited to repositories also gets installation tokens limited to them (B-6).
Passes are listed by `github_list_connections` and revoked by `github_revoke_connection`.

**R2. HTTPS tool API and manifest** exactly as RTC §1 and §7: `GET /api/contract` (no auth; `modes: ['preview',
'production']`, `devTools: true`, `apiVersion: '2026-03-10'`, counts from the registry), `GET /api/whoami`,
`GET /api/tools`, `GET /api/tools/{name}`, `POST /api/tools/{name}`, `POST /api/tools/_batch`, `GET /api/results/{handle}`;
pass-only auth; the RTC result envelope and error codes; rate limit per pass **shared across serverless instances**: a
Postgres `rate_limits (key, window_start, count)` table updated with one atomic
`INSERT … ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1 RETURNING count`, one-minute
windows; the limit is stored **per pass** in `oauth_tokens.rate_limit_per_minute` (starting value 120, allowed 1–600,
IN-10), chosen when the pass is created, shown by `github_list_connections`, read from the pass row on every call — never
hard-coded; over the limit → HTTP 429 with `Retry-After` and code `rate_limited`. Never an in-memory counter.
`GET /api/openapi.json` (generated, ≤30 operations: meta tools, whoami, workflows) for HTTP-only agents.
(GitHub's own limits are separate and handled by A-4's write slots and rate state.)

**R3. Conformance in CI, never a blocker.** When the hub's `packages/conformance` exists it runs against a locally
started server (fake GitHub) in this repo's CI and a failure fails `ci`. Until then this server's own write-contract tests
over MCP, `github_call` and HTTPS cover the same behaviour.

**R4. Contract code lives in `src/core/`** (Batch A, A2): passes, HTTPS doors, manifest, meta-tools, result rules, write
layer, error envelope — extracted by the hub into `robinson-mcp-core`; this server then switches to the package.

## 2. Schema

```sql
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS allow_writes BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS allow_access_changes BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS spend_limit_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS areas TEXT[];
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS repos TEXT[];
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS for_hub BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS rate_limit_per_minute INTEGER NOT NULL DEFAULT 120;
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT NOT NULL, window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (key, window_start));
```

The token-refresh helper of A-3 copies every new connection-setting column (the A-3 test that fails on an uncopied
column covers these).

## 4. Work units

### R-1 — Passes (M, medium effort)
Tests: shown once; expired → `pass_expired`; revoked → `pass_revoked`; read-only pass cannot write through
`github_call` or HTTPS; production pass without the passphrase step refused; access changes refused without
`allow_access_changes`; 365-day life only with `for_hub`; repository-limited pass gets a limited token.
### R-2 — HTTPS tool API, manifest, OpenAPI (M)
Tests: write-contract through HTTPS (door #3); envelope and error codes per RTC §7; manifest counts match the registry;
OpenAPI valid with ≤30 operations; connector tokens and no token refused on `/api/tools`; rate limit database test with
two independently created handler instances sharing one pass, sending **overlapping** requests (150 at once split across
both, `Promise.all`): exactly 120 succeed and the rest get 429 — a read-then-update counter fails this test; a pass
created with limit 5 gets 429 on its 6th call; old windows cleaned up.
### R-3 — RTC 1 conformance in CI (S)
Done when: the hub's conformance package passes in this repo's CI against a local server with fake GitHub.

## 5. Stop-and-ask points

1. The contract and this design disagree: the contract wins; amend this design in the same PR.

## 6. Acceptance mapping

| PLAN Batch R line | Evidence |
|---|---|
| Passes per RTC §2 | `tests/unit/passes.test.js` |
| HTTPS API per RTC §1/§7, same guards, shared rate limit | write-contract through HTTPS; `tests/db/rate-limits.test.js` |
| RTC 1 conformance | CI job `conformance` |

## Amendments

(Dated entries only.)
