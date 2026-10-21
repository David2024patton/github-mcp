# CAP-3 — optional additional credentials and typed authority lifecycle

**Status: APPROVED — pre-code frozen plan.** Baseline `4a09af622f46c1d99a6544769fe23321945a31b7`, CAP-2 source merged #273, CAP-1 source merged #272. Preserve concurrent PUB-4 #268; source/live acceptance remain separate. No actual tokens, provider enrollment or user policy changed by this plan.

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
