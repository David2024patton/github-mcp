# CAP-3 — optional additional credentials and typed authority lifecycle

**Status: IN PROGRESS — draft #274; original pre-code frozen plan retained.** Baseline `4a09af622f46c1d99a6544769fe23321945a31b7`, CAP-2 source merged #273, CAP-1 source merged #272. Preserve concurrent PUB-4 #268; source/live acceptance remain separate. No actual tokens, provider enrollment or user policy changed by this plan.

## Drift check A

| Owner design assumption | Inspected current source (2026-10-21) | Contract / proof |
| --- | --- | --- |
| No extra token store exists | `src/github/credentials.js` already encrypts App I, user U, notifications K and packages P plus fine-grained PAT; identity and true provider scopes are not uniformly bound to a separate tenant/human/host resource | Add only missing typed metadata, never copy/decrypt into tools or relabel K/P as general grants |
| Additional credential needs a new password/login service | `src/github/setup-page.js` has private admin passphrase, origin+CSRF and GitHub user PKCE; protected K/P/fine-grained entry; `src/github/setup-readback.js` already asks GitHub for effective App installation | Reuse existing one-use consent and protected entry; no ChatGPT token values; preserve native automatic return where GitHub permits it |
| GitHub provider support equals current user grant | CAP-1 official operation ledger contains only fifteen reviewed credential cells and many unknowns, CAP-2 diagnostic always marks provider action unverified | Exact host/operation source evidence required; unreviewed capability stays unknown |
| A verified user may borrow an organization's stored user token | `src/tenancy/user-authorization.js` stores each private pilot member's encrypted U grant separately with identity-bound AAD | Strict current tenant/workspace membership, stable provider subject and account/resource checks before provider I/O |
| Full profile implies unlimited additional creds | CAP-2 Full only affects dispatch policy and safe consent; RTC passes, production, spend, SSO and GitHub App permissions remain separate | No global God Mode bypass, credential probing, paid provider actions or new developer authority |
| GitHub setup can grant App permissions by itself | Official provider: `https://docs.github.com/en/apps/using-github-apps/approving-updated-permissions-for-a-github-app`; owner must explicitly accept increases | Safe explicit upgrade handoff and readback, not automatic permission enablement |

## Finite implementation contract

- Read bounded seams: `src/github/credentials.js`, `src/github/setup-page.js`, `src/github/setup-html.js`, `src/github/setup-readback.js`, `src/github/capability-evidence.js`, `src/github/effective-access.js`, `src/github/client.js`, `src/tenancy/user-authorization.js`, `src/tenancy/directory.js`, `src/db.js`, `src/tools/server-diagnostics.js`, `tests/db/credentials.test.js`, `tests/db/pub-2-pilot-identity.test.js`, `tests/unit/credentials-store.test.js`, `tests/unit/setup-secret.test.js`, `tests/unit/rtc-scoped-passes.test.js`. Existing `docs/UNIVERSAL-IDENTITY-HANDOFF.md`, `docs/END-USER-AUTHORITY.md`, Hub compatibility and session rules govern.
- Operate on verified `principal=(tenant, stable GitHub numeric identity, active membership revision, account/installation)`, explicit host and operation. A login string/email domain is not authority. Owner legacy grants with no verified actor remain recoverable but not assumed compatible with a different private tenant.
- Deterministic resolver returns `supported`, `unsupported`, `unknown`, `needs-consent`, `verified-for-scope` or `denied` with source, not raw tokens; it never upgrades K/P, borrows another connection's credential, probes GitHub with trial bearer tokens, or retries ambiguous writes.
- Provider OAuth user consent and App acceptance use existing CSRF/PKCE/revision/one-use semantics. Protected manual entry only when supported issuer/host requires it; never solicit a GitHub password, PAT or private key through MCP/chat arguments.
- Provider verification must be a harmless bounded identity/capability read with a stable numeric principal and exact authority scope. Expired/revoked/foreign host or resource fails before a protected call. Atomic replacement/revocation and permission-downscoped pass semantics are mandatory.
- Distinguish **synthetic source test**, **actual stored grant**, **provider readback**, and **independent deployed private real-client acceptance** as four different proof states. No user-visible claim of working God Mode from simply saving a token.

## Frozen original CAP-3 acceptance

1. Only missing applicable optional credential kinds are recommended by exact operation, host and verified requirements, never by broad tool family or invented God-Mode-only privileges.
2. Every stored extra grant binds provider host, numeric verified human identity, tenant/workspace, account, resource/enterprise scope, token kind, permissions, expiry and verification without exposing the secret.
3. One agent-initiated secure setup handoff uses native GitHub App/OAuth consent or the protected service token page only as applicable, returns to its originating scoped client and rechecks capability; no chat-token input.
4. No silent broader fallback, trial-and-error provider authentication, unsupported pass downscoping or unintended privilege carryover during denied provider requests, upgrades or refresh.
5. Disposable PostgreSQL and synthetic-provider integration prove two distinct tenants, the same human in separate workspaces, wrong identity/host/resource, stale/revoked grants, concurrency and interrupted setup.
6. Tests prove secret redaction, restricted service passes, clean replacement/deletion and verified before/after capability gain; incomplete real provider/device acceptance remains independently OPEN.

## Build, verification and non-release rules

Run exact pre-plan baseline `npm run session:bundle -- --card docs/pr-cards/CAP-3.md` then commit this documentation before the first source edit. New DB: additive migration + real disposable PostgreSQL tests and restore/interruption/parallel refresh. Every affected GitHub call needs pinned request-shape fixtures; every write needs the existing nine-check contract. Do a focused type/lint pass after connected feature build, focused tests at changed seams, one full `npm run check`, unit, DB, request-shapes and RTC on the assembled source, final `npm run session:bundle -- --card docs/pr-cards/CAP-3.md --planned-at <PLAN_SHA> --report docs/pr-cards/CAP-3.delivery.json`, exact-head ci/release-policy/review and expected-SHA merge. No real paid or production provider actions, tenant activation, external customer invitations, manual release, merged untested code or cross-project writes.

## 2026-10-21 — first source candidate, not completed

Draft [PR #274](https://github.com/Robinson-AI-Systems/github-mcp/pull/274) has a pure operation- and principal-bound metadata resolver with synthetic denial tests. Official OAuth alternative-scope semantics are preserved. No grant-binding SQL, provider readback, protected user enrollment, token acquisition or lifecycle integration has been committed. Storage implementation was blocked by execution safety checks; do not bypass those checks. **All six original CAP-3 acceptance criteria remain unfinished**, and this code cannot be used to claim God Mode. The separate PUB-4 branch remains untouched. Current source needs exact-head CI, and only independent provider/live acceptance after actual safe enrollment can establish end-user capabilities.

## Recovery implementation — existing private-user foundation only

The narrower recovery adds metadata to `gh_tenant_user_authorizations`, not a new bearer store. `src/tenancy/credential-binding.js` constructs and checks the fixed allowlisted proof; `storePilotUserGrant({verifiedContext})` attaches it only to the verified callback; `storePilotUserAuthorization` atomically checks identity and membership/pilot epochs; `finishPilotUserRefresh` replaces proof with ciphertext under its existing claim and comparison. Unverified replacement clears proof. `createTenantScopedCredentials.operationAuthority` reads current account, membership, subject and stored binding without decrypting, then calls the CAP-3 resolver. `github_check_permissions` attaches this separate result for exact operation requests. Only `GET /user` and `user/<numeric-subject>` are proven; repository and write capability remain unverified. Missing legacy proof never becomes a metadata pass.

Restricted-pass discovery: private App-user bearers cannot honor repository/permission downscoping. The small refusal-before-decryption correction belongs to its own security PR under AGENTS, without completing/recounting CAP-3. Preserve the equivalent check when incorporating that PR into this branch.

Tests: `tests/unit/cap3-user-binding.test.js`, `tests/db/cap3-user-binding.test.js`, and the existing native consent/refresh real-DB cases in `tests/db/pub-2-pilot-identity.test.js`. The DB suite is required on disposable PostgreSQL; no real token or production database may substitute. Before publication, inspect all final exact-head CI families and record actual results.

### Exact remaining implementation for the next continuation

1. Keep this original plan/criterion boundary. Extend the typed lifecycle to actually applicable additional grant kinds using the existing sealed setup paths, with separate identities and restrictive K/P semantics. Never present this one-kind metadata proof as that registry. Bind explicit provider host, verified numeric human, tenant/role epochs, account and exact resource to every newly enrolled grant; preserve legacy credentials without inheriting their authority into another tenant.
2. Wire an agent-initiated protected/native upgrade handoff through registered scoped client return/PKCE state and current membership. `src/tenancy/github-consent.js` already implements ordinary App-user reconnect and return; it does not enroll fine-grained/classic/OAuth-App/service-App credentials. Add the applicable protected enrollment page and its one-use/replay/interruption proof instead of silently routing new credentials through the global owner setup form. No token-valued MCP arguments.
3. Read back the exact documented harmless operation/resource with the explicitly selected grant. Existing `userGrantBinding` proves identity only. Do not infer permissions from a successful `/user`, installation membership, empty permission arrays, tool registration or a saved token. Keep unsupported/unreviewed host/operation decisions unknown, with no trial bearer fallback and no replay of a write after credential changes.
4. Complete expiry/refresh/revoke/replace/deletion for those additional kinds, atomically invalidating their proof and client/pass authority as required. Preserve existing U refresh CAS and membership epoch protections. Exercise two isolated tenants, distinct humans and the same human in different workspaces, wrong host/resource, revoked/stale proof, concurrent refresh, interrupted handoff and restricted passes through real PostgreSQL plus the synthetic provider and actual handlers.
5. Supply `CAP-3.delivery.json` against planning commit `4975bf79b7fdf7c7c8ee30415e64098bcdb18055` with original acceptance strings and honest remaining engineering. Whole-subsection completion is still zero. Run full required gates, review the complete diff and keep #274 draft until original source acceptance passes. Real deployed/provider/device acceptance remains independently open; CAP-4 must not assume source CAP-3 complete.

This list makes unfinished engineering explicit; it does not create a new scope, waive the original acceptance or authorize a provider grant, real token, production write, release or expenditure. The earlier safety rejection has not recurred for this narrower metadata edit; there is no new claimed general execution blockade.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "4a09af622f46c1d99a6544769fe23321945a31b7",
  "outcome": "Optional agent-guided GitHub extra authority: operation-aware typed grants, safe protected or native provider enrollment, verified scoped before/after capability, secure tenant isolation and revocation/recovery without broader fallback.",
  "integrationBoundary": "Reuse current sealed credentials I/U/K/P, GitHub App and OAuth grant handlers, signed private-tenant isolated DB, protected setup pages, CAP-1 pinned evidence and CAP-2 access diagnostics; no account-unverified cross-tenant permissions, password collection, chat tokens or unrelated provider changes.",
  "newEngineering": "Implement a sealed-metadata typed credential registry and deterministic exact-operation resolver, bind GitHub.com/GHE.com/GHES and stable provider principal/tenant/actor/account/resource to stored authority, integrate an agent-initiated guarded enrollment handoff with provider readback, preserve credential refresh/replacement/revocation and test negative/positive capability changes across two isolated real tenants and synthetic GitHub. No live provider mutation without independent approval.",
  "estimatedProductionLines": 850,
  "relatedWorkDecision": "One whole original CAP-3 security-boundary and lifecycle outcome. CAP-2 merged at 4a09af6 and is reused; CAP-4 advanced provider endpoints and CAP-5 real acceptance remain dependent. PUB-4 separate draft #268 owns mobile/desktop independent client acceptance and is not altered.",
  "subsections": [
    {
      "id": "CAP-3",
      "acceptance": [
        "Only missing applicable optional credential kinds are recommended by exact operation, host and verified requirements, never by broad tool family or invented God-Mode-only privileges.",
        "Every stored extra grant binds provider host, numeric verified human identity, tenant/workspace, account, resource/enterprise scope, token kind, permissions, expiry and verification without exposing the secret.",
        "One agent-initiated secure setup handoff uses native GitHub App/OAuth consent or the protected service token page only as applicable, returns to its originating scoped client and rechecks capability; no chat-token input.",
        "No silent broader fallback, trial-and-error provider authentication, unsupported pass downscoping or unintended privilege carryover during denied provider requests, upgrades or refresh.",
        "Disposable PostgreSQL and synthetic-provider integration prove two distinct tenants, the same human in separate workspaces, wrong identity/host/resource, stale/revoked grants, concurrency and interrupted setup.",
        "Tests prove secret redaction, restricted service passes, clean replacement/deletion and verified before/after capability gain; incomplete real provider/device acceptance remains independently OPEN."
      ],
      "remainingEngineering": [
        "Trace existing I/U/K/P storage, GitHub App/user OAuth callbacks and protected form across owner versus private isolated-tenant namespaces; account for legacy unverified credentials without granting them to other users",
        "Define scoped typed grant schema and deterministic exact operation resolver with explicit unsupported/unknown and no automatic fallback; add additive SQL and guarded bind/migration only where necessary",
        "Wire protected one-flow enrollment and scoped return/recheck, user/protected page consent and provider harmless verification with honest exact verification state and no bearer exposure",
        "Implement expiry/refresh/replacement/revocation and cleanup with transactional ownership checks; ensure idempotence and no stored-grant broadening",
        "Run synthetic source/real DB two-tenant identity, host, resource, role, concurrent renewal, token-redaction and restricted-pass acceptance, plus full tests, scope comparator, review and exact-head CI before merge"
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->
