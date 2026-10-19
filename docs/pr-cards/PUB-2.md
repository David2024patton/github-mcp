# PUB-2 — Private delegated GitHub identity and scoped client OAuth

**Stage: IN_PROGRESS / substantial private-source implementation, but real-provider/client acceptance remains open; DRAFT PR #264 NOT merged, not deployed.** Prior PUB-1 merged commit `692c38550217c84b6afa5fc4840ea753be8e049f` with exact-PR and merged-main green, providing dormant tenant directory/store. Requires no new owner decision for the private test code, but **public GitHub App distribution and Directory remain blocked by IN-18**.

## Drift check A
| Area | Today | PUB-2 target |
|---|---|---|
| Owner auth | `src/core/oauth-handlers.js` uses global `ADMIN_PASSPHRASE`, `src/oauth/policy.js` lists owner-account options | Preserve for owner; separate provider-verified tenant consent with no global password |
| User proof | Protected setup page `start-user-auth` exchanges code, verifies `GET /user`, stores owner U | Reuse request/PKCE patterns only; new tenant context cannot overwrite owner authorization |
| Storage | `createDb(sql)` owner namespace; dormant `src/tenancy/directory.js` supports isolated 28-table tenant storage | Bind client, grant, code/token, bearer dispatch and account authority to a verified tenant, no global fallback |
| Distribution | Existing ChatGPT connectors private; custom desktop candidate shows Codex deep link on mobile | Private pilot consent only, no claim of supported mobile UX until PUB-4 |
| Release | `main` ahead of READY `live`, scheduled 00:01 Denver only | Do not deploy manually, invite an outside user or enroll paid hosting |

## Design/read anchors
`src/core/oauth-handlers.js` §register/authorize/token; `src/core/oauth.js` PKCE/hash/replay; `src/oauth/policy.js` legacy owner account list; `src/github/setup-page.js` §start-user-auth/userCallback; `src/github/credentials.js` §clientCredentials/token refresh; `src/tenancy/directory.js` (PUB-1); `src/db.js` §OAuth session and tenant table families; `api/` routes and HTTP harness; `tests/db/connections.test.js`, `tests/unit/setup-page.test.js`. Inspect current symbols and provider-callback redirect registrations before coding.

## Full original PUB-2 acceptance (no source credit before all pass)
1. [ ] A private allowlisted prospective customer authenticates directly with real GitHub provider OAuth; the server independently checks stable numeric /user identity, tenant membership, App/repository delegation and single-use CSRF/PKCE; no email/login string or global owner passphrase grants access.
2. [ ] Every custom MCP OAuth client, authorization code, scoped access/refresh token, saved account, connector session, job/result/audit, and revoke request is bound to one authorized tenant and validated on each call; no tenant ID may be taken from an untrusted request or inferred from a display name.
3. [ ] Native desktop MCP and mobile-compatible future ChatGPT clients can both use the same backed provider identity and tenant-choosable PREVIEW/PRODUCTION, profile and account delegation without silently widening on refresh; actual UI/device acceptance remains independently tracked in PUB-4.
4. [ ] Pilot registration remains disabled by default; enablement requires an owner-controlled allowlist and an already installed, legitimately delegated GitHub App, no new public App distribution or unauthorized GitHub resource mutation.
5. [ ] Two-tenant overlapping GitHub login/client identifiers, replay, simultaneous code redemption, refresh revocation, forbidden account selection, inaccessible installation, provider sign-out and membership revocation are proven through real disposable PostgreSQL plus mocked GitHub API and HTTP, not merely fake in-memory stores.
6. [ ] The legacy owner setup/connection works unchanged; all existing product write/production/spend/notification/protected-resource gates apply to each new customer according to that customer's own delegation, not the developer's $0 testing budget.

## Private connection and privilege rules
- The returning GitHub OAuth code is redeemed once by the service and GET /user must positively match a stable provider subject already granted membership in this tenant, together with actually authorized GitHub App installation/repositories. Never use a ChatGPT email or client-supplied login as proof.
- The pilot must be default OFF and restricted to owner-enrolled pilot subjects/installations. No public customer creates a namespace without provider proof and private owner consent.
- A raw OAuth client ID is not identity proof. Registered client, codes, bearer-hash locator, refresh credentials and attached policies must be tenant-bound **atomically**; never try the legacy global store when tenant lookup fails. Revoke invalidates all routes.
- Preserve S256 PKCE, state nonce, exact redirect and resource target, CSRF, independent payer/spend/production/access confirmation, per-tenant service policies and provider plan limits. The old owner passphrase route remains unchanged.
- Real PostgreSQL negative tests include one-use code, two clients racing refresh, overlapping account identities, revoked member, unknown tenant, suspended App, malicious return URI, and old-tenant session reuse. Never add real provider credentials or paid fixtures to tests.
- Mobile and desktop HTTP client flows may be exercised synthetically here; **PUB-4** still requires authentic real client tool calls on supported Android/iOS and desktop/web. **PUB-5** remains blocked from public Directory submission without separate applicable provider eligibility and owner approval.

## Work started after plan (2026-10-18; INCOMPLETE)

- Dormant `src/tenancy/github-identity.js` verifies real GitHub `GET /user` immutable numeric subject using an OAuth bearer without storing or echoing it, and denies missing/stale pilot membership. A `GITHUB_PRIVATE_TENANT_PILOT=enabled` opt-in exists but is **not set** and no public or ChatGPT route invokes it.
- Internal `src/tenancy/directory.js` owner-issuable `gh_tenant_pilot_allowlist` maps a verified numeric identity to an active tenant membership; allowlist revocation and membership revocation are independent and fail closed. Private real PostgreSQL and fake provider tests added.
- Subsequently added: browser-first private tenant GitHub OAuth with real GET /user and /user/installations checks, signed tenant client/code/access/refresh, independent MCP dispatch with no owner fallback, owner-only pilot bootstrap with real PostgreSQL double-submit protection, and a mobile-sized mode/profile consent form. All clients remain PRIVATE; no live provider acceptance has been claimed.
- Privacy correction: a GitHub App user's U token now belongs to that **specific verified human and tenant**, not a shared organization account. AES-GCM authentication context includes tenant, identity and account. Each individual U refresh has a PostgreSQL one-use lease, provider identity/installation revalidation and compare-and-delete invalid-grant handling. Default I-mode member requests use the member's own GitHub App U token, whose repository/permission reach is provider-intersected; only tenant-owner I uses the installation token. K/P personal tokens remain separately unimplemented for pilot members rather than sharing another person's secrets.
- Remaining original completion: final exact-head review/CI, truthful GitHub provider authorization/callback and revoked/suspended installation tests with a genuine privately enrolled account, mobile and desktop actual client acceptance (PUB-4), and any unresolved documented provider/pilot configuration dependency. No public enrollment, owner credential migration or universal Directory publication.
- This checkpoint is **partial engineering** and 0 completed PUB-2 criteria until the whole original acceptance and exact-head CI/review pass. Do not merge as a finished PUB-2 unit, or pretend unit helper tests prove real client functionality.

## 2026-10-19 — current private-source checkpoint (no false live acceptance)

- PR #264's reconciled head `2b74fe14f0a4926d5b6496f9b5a558bafe4ddceb` passed exact-head `ci 39294035222 SUCCESS` (PostgreSQL, both unit shards, shapes, RTC, static) and `Daily live policy 39294035253 SUCCESS`; it **preceded** final member-scoped I/U delegation and callback-cookie regression and is not proof for those latest commits.
- Current source/test additions: `src/tenancy/user-authorization.js`, `src/tenancy/github-consent.js`, `src/tenancy/directory.js` and `src/tenancy/mcp-route.js`; `tests/db/pub-2-pilot-identity.test.js` proves two tenant users with identical organization accounts never share encrypted U/refresh values, uses an atomic PostgreSQL refresh claim under concurrent calls, and retains another member's credential after individual revocation; `tests/unit/pub-2-pilot-api.test.js` now asserts ordinary spaced browser Cookie header parsing.
- GitHub provider docs establish that user-to-server App tokens carry the intersection of the App and user's own repository and permission grants; direct source: `https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user`. Installation tokens are broader and must not be lent to ordinary members.
- Required before any merge: exact latest PR head CI success after these changes; independent issue/review thread security audit; no missing client-registration or revocation invariants; consistency checks; and a truthful determination whether PUB-2 original real-provider acceptance is met or remains external-gated. **The current card still counts zero complete PUB-2 work until that review is done.**
- No environment flag, App callback, paid capacity, external customer, production data, plugin visibility, or live deployment was changed by this source work. The pilot still defaults OFF. The original 57 real-world provider acceptance criteria remain unchanged.

## Verification / delivery
Before coding: commit this card; run `npm run session:bundle -- --card docs/pr-cards/PUB-2.md` and the documented plan check; after code run type/lint, focused provider HTTP and real database checks, then the full CI suite on the final head. Record new production lines, independent self-review including AI-PR-READ-FIRST and original acceptance queue unchanged. Finish in a coherent whole PUB-2 PR (not a helper PR). If external credential or owner-dependent pilot callback settings are not yet available, implement and verify all synthetic/private safe behavior and record the exact external blocker without asserting a real acceptance pass.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "692c38550217c84b6afa5fc4840ea753be8e049f",
  "outcome": "Private allowlisted provider-verified delegated GitHub OAuth enrollment and tenant-bound MCP token routing, without public enrollment, global-owner credential exposure, or mobile/desktop acceptance claims.",
  "integrationBoundary": "PUB-1 tenant registry and namespace, GitHub App OAuth provider, existing MCP protocol auth and dispatch, protected owner setup controls; no public Directory publishing, money, additional installations or live release.",
  "newEngineering": "Verified GitHub identity and grant evidence, tenant-bound OAuth state/client/code/bearer/refresh mapping, fail-closed tenant dispatch, cryptographic replay/consent safeguards, private closed pilot and two-tenant real-Postgres/HTTP/provider tests.",
  "estimatedProductionLines": 800,
  "relatedWorkDecision": "Separate whole PUB-2 provider OAuth engineering subsection due its independent external GitHub identity boundary; PUB-3 capacity/abuse runtime and PUB-4 actual Android/desktop experience remain independent; no helper-only PR or completion credit until whole acceptance passes.",
  "subsections": [
    {
      "id": "PUB-2",
      "acceptance": [
        "A private allowlisted prospective customer authenticates directly with real GitHub provider OAuth; the server independently checks stable numeric /user identity, tenant membership, App/repository delegation and single-use CSRF/PKCE; no email/login string or global owner passphrase grants access.",
        "Every custom MCP OAuth client, authorization code, scoped access/refresh token, saved account, connector session, job/result/audit, and revoke request is bound to one authorized tenant and validated on each call; no tenant ID may be taken from an untrusted request or inferred from a display name.",
        "Native desktop MCP and mobile-compatible future ChatGPT clients can both use the same backed provider identity and tenant-choosable PREVIEW/PRODUCTION, profile and account delegation without silently widening on refresh; actual UI/device acceptance remains independently tracked in PUB-4.",
        "Pilot registration remains disabled by default; enablement requires an owner-controlled allowlist and an already installed, legitimately delegated GitHub App, no new public App distribution or unauthorized GitHub resource mutation.",
        "Two-tenant overlapping GitHub login/client identifiers, replay, simultaneous code redemption, refresh revocation, forbidden account selection, inaccessible installation, provider sign-out and membership revocation are proven through real disposable PostgreSQL plus mocked GitHub API and HTTP, not merely fake in-memory stores.",
        "The legacy owner setup/connection works unchanged; all existing product write/production/spend/notification/protected-resource gates apply to each new customer according to that customer's own delegation, not the developer's $0 testing budget."
      ],
      "remainingEngineering": [
        "Map existing owner /api/github/user-callback and GitHub App token exchange into a separate private tenant authorization route using provider-verified GET /user ID and exact callback, not a user-typed tenant choice",
        "Bind tenant namespace at client registration/code/token issue/refresh/revoke/MCP dispatcher without exposing bare hashes or routing to global legacy owner on lookup failure",
        "Implement owner-managed allowlisted pilot opt-in OFF by default and resource/installation-bound authorization; no external GitHub App distribution",
        "Run separate tenant A/B real Postgres contracts, exact HTTP OAuth/PKCE/provider fake, revoked owner and cross-tenant replay tests, and full suites",
        "Preserve owner route, product policies, deployment controls and permanent docs; independently review exact head before merge"
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->


## 2026-10-18/19: continued synthetic integration proof (still not complete)

Built signed tenant-only `tcl_` client / `tac_` access / `trf_` refresh routing, custom tenant-only MCP and OAuth routes, a private GitHub user installation verifier, one-use registry callback state, mobile-sized mode/profile consent form and restricted client registration. Synthetic and real disposable PostgreSQL tests exercise code exchange, stored token/refresh hash and revocation. Draft source `cbd9412e6ab86bd4c71574370b35312ac0ff9755` passed full `ci 39182803768` and Daily live policy `39182803752`. **This is a source-only test pass, not real Android/desktop or provider acceptance.** The private pilot remains disabled by default with no production credentials configured. Remaining original PUB-2 engineering: owner-operable safe provisioning/enrollment, native OAuth discovery/registration from actual ChatGPT clients, fully concurrent verification/cleanup, and genuinely delegated App install/revoke acceptance. Preserve entire original card as unfinished, draft PR #264 not ready for merge, no publication. The final documentation source revision must itself pass exact-head CI.

## Product boundary (owner clarification 2026-10-19)

Private pilot is a controlled test/early-access facility, **not** a permanent customer onboarding policy. Finished customers will authorize their own GitHub identities in the supported native MCP OAuth workflow, without Robinson AI Systems administrator passphrase or scratch account. The owner-approved pilot invitation source is strictly a private test aid for multi-user isolation and is never an alternative public signup. **Implementation tests and merge gates** are separate from real **deployed/provider/mobile/desktop acceptance**; a CI-green implementation may be merged under repository rules even if external proof is pending. Neither CI nor source merge marks live acceptance passed.
