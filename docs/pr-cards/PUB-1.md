# PUB-1 — Private tenant identity and isolated GitHub MCP data boundary

Status: **IN_PROGRESS plan; no completion claimed**. Design: [PUBLIC-SCALE](../designs/PUBLIC-SCALE.md), §§0–4. Dependencies: legacy A-2/A-3, all existing storage tests; no PUB-2 public login yet.

Baseline: `2354b53279e1a5e2e02692c7f506d39217636fde`; PR #260 fixes owner-only session-mode correction; PR #262 merged work index and public-policy gate. Actual `live` is still behind main and private only. No manual release.

## Drift check A — before implementation
| Area | Existing | Required |
|---|---|---|
| Identity | Shared setup `ADMIN_PASSPHRASE`, global account lookup | Provider-verified stable identity bound to tenant membership; no public route until PUB-2 |
| Persistence | 28 unqualified Postgres tables in legacy schema, `createDb(sql)` | Tenant-isolated namespace for **all** existing operations, not just selected tables; absent scope rejects |
| OAuth | Code/token stored in shared owner database | For future tenant sessions, exactly tenant namespace + currently verified user; no auto-widened mode |
| Cleanup and audit | Connection/account-keyed, owner-only | Tenant-isolated jobs, retained handles, run objects, request-key and audit; no cross-tenant replays |
| Provider and release | GitHub App owned by scratch; live-only daily Vercel deployment | Preserve installed owner App and private plugin; no new installation/spending/public registration |

## Read only these implementation anchors
`src/db.js` (schema constructor plus token/connection and account methods), `src/dev/ledger.js` (run store), `src/core/oauth-handlers.js`, `src/oauth/policy.js`, `test/helpers/pg-neon-adapter.js`, `tests/db/schema.test.js`, `tests/db/connections.test.js`; revise based on actual exports, not assumed shape.

## Safety and build contract
- New exported tenant store `src/tenancy/` behind a private code API; **no** HTTP endpoint, new GitHub route, global connection scope, public sign-up or user-typed tenant ID. Caller selection must ultimately come from provider-verified stable numeric identity and membership in PUB-2.
- Per-tenant SQL must never resolve `public` or another tenant's schema if its tenant schema is missing. Do not rely on mutable session-level `SET search_path` on a serverless pooled connection; use connection-bound settings verified with a genuine Postgres query. If this fails across Neon, fail closed and redesign rather than fall back.
- Preserve legacy store and credentials byte-for-byte; schema migrations additive only. No migration of production data by this development agent.
- Cross-tenant attempts must be denied or return no records without accessing/mutating a different tenant. Persisted policy, spending, write/readback and owner passphrase behavior remain unchanged.
- No new GitHub provider tools; developer's $0 budget and preview/build restrictions stay unchanged. Product end-user permissions remain subject to genuinely selected user controls.

## Acceptance criteria (exact full PUB-1)
1. [ ] An authenticated, provider-verified stable identity can belong to an explicitly authorized tenant and role with durable, revisioned membership; no path accepts user-typed GitHub login or ChatGPT email as identity proof.
2. [ ] Each newly provisioned tenant gets an isolated namespace for every existing account-bearing table, OAuth grant/code/client, audit, result, job, rate, protected policy, token, scratch run and project profile, allowing overlapping GitHub logins/IDs without access to other tenants' rows.
3. [ ] Legacy owner accounts, credentials, OAuth clients, protected resources, production setting, pending jobs and audit remain unchanged and reachable only through the existing private owner path; no production account migration or consent is inferred.
4. [ ] Private test identity/tenant registration never becomes a public route and is disabled until PUB-2 provider-verified onboarding; any absent/malformed context or unprovisioned schema refuses instead of falling back to legacy public.
5. [ ] Real disposable PostgreSQL tests prove two independent tenants with the same GitHub login, client names, token labels, policy and run IDs; cross-tenant read, write, refresh, retained-result and cleanup attempts cannot affect other tenant; repeated initialization is additive and idempotent.
6. [ ] The design and code do not publish a plugin, add an outside user, authorize production writes, purchase capacity, loosen per-operation safeguards, or claim end-user public readiness.

## Tests and exit
Real `tests/db/` local disposable Postgres alongside isolated contract tests for two tenants; tests/unit for invalid identity/tenant references, absent schema and legacy-owner path. Run `npm run check`, focused tenant+existing OAuth/credential tests, complete CI exactly once after implementation, resolve all reviews, update `docs/STATUS.md`, architecture, index, decisions and migration notes, merge only if **every** above line passes. No future PUB completion or original 57 acceptance status changes by this PR.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "2354b53279e1a5e2e02692c7f506d39217636fde",
  "outcome": "Implement PUB-1's tenant and delegated identity storage foundations without enabling public access; keep the legacy single-owner GitHub MCP functional until PUB-2.",
  "integrationBoundary": "Standalone GitHub MCP Neon Postgres tenant directory and per-tenant SQL/store; future provider-verified selection in PUB-2; no new public endpoints, no release bypass, 0 spending.",
  "newEngineering": "Additive tenant metadata, opaque identity/membership and server-provisioned isolated tenant database context with no fallback; tests cover every existing store family through isolated schemas and concurrent cross-tenant credentials; owner credentials remain unchanged.",
  "estimatedProductionLines": 550,
  "relatedWorkDecision": "One substantial approved PUB-1 trust-boundary subsection in its own PR; PUB-2 provider onboarding is a separate later outside-provider bundle; PUB-1 counts completed only if all its acceptance lines are proved by actual disposable Postgres and CI; 0 source completion credit while in progress.",
  "subsections": [
    {
      "id": "PUB-1",
      "acceptance": [
        "An authenticated, provider-verified stable identity can belong to an explicitly authorized tenant and role with durable, revisioned membership; no path accepts user-typed GitHub login or ChatGPT email as identity proof.",
        "Each newly provisioned tenant gets an isolated namespace for every existing account-bearing table, OAuth grant/code/client, audit, result, job, rate, protected policy, token, scratch run and project profile, allowing overlapping GitHub logins/IDs without access to other tenants' rows.",
        "Legacy owner accounts, credentials, OAuth clients, protected resources, production setting, pending jobs and audit remain unchanged and reachable only through the existing private owner path; no production account migration or consent is inferred.",
        "Private test identity/tenant registration never becomes a public route and is disabled until PUB-2 provider-verified onboarding; any absent/malformed context or unprovisioned schema refuses instead of falling back to legacy public.",
        "Real disposable PostgreSQL tests prove two independent tenants with the same GitHub login, client names, token labels, policy and run IDs; cross-tenant read, write, refresh, retained-result and cleanup attempts cannot affect other tenant; repeated initialization is additive and idempotent.",
        "The design and code do not publish a plugin, add an outside user, authorize production writes, purchase capacity, loosen per-operation safeguards, or claim end-user public readiness."
      ],
      "remainingEngineering": [
        "Create protected tenant identity/membership directory and revocation-version store",
        "Provision additive isolated tenant namespace without cross-schema fallback",
        "Expose only verified-context private tenant database handle; legacy owner existing global path untouched",
        "Run overlapping-name cross-tenant Postgres, OAuth, audit, retained result, protected policy and dev-run tests",
        "Update current implementation and operational docs and run full exact-head CI/review"
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->
