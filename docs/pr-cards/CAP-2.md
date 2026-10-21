# CAP-2 — Standard Full and effective-access recovery

**Status: APPROVED — PLAN FROZEN BEFORE IMPLEMENTATION.** Source baseline `89a32f39e310846618ff80a925425601ae8fb33f` (CAP-1 merged PR #272); production remains on older `live=315a3259faafa474a9b36cc8410c5718d5b9326f`. PUB-4 #268 independently owns its in-flight real mobile/desktop consent work. **No credentials, production permissions, provider grants, budget, OAuth client, tenant role or scope changes are authorized by this card.**

## Drift check A — inspected current source and owner contract

| Previous assumption | Current code/owner evidence | Correction/test |
| --- | --- | --- |
| Full requires God Mode or a special token | `src/oauth/policy.js` already renders `CONNECTION_PROFILES` including Full, defaulting to Everyday; `src/core/registry.js` filters write profiles | Explain what Full really means; keep intentional defaults; never make Full silently bypass resource or provider permissions |
| One permission checker determines every operation | `github_check_permissions` checks App installation area grants but a clean App result does not prove U/P/K grants, exact operation, tenant role or hosted plan | Diagnose layers separately; ambiguous provider rights remain unknown, not green |
| Upgrading a client permits wider provider authority | GitHub App permission upgrade requires provider acceptance and existing client setting renewal; signed tenant consent enforces active scoped membership/account | Only user-initiated reauthorization, exact bound account and separate provider-grant readback may change effective access |
| A delegated tool can skip profile check | `toolsForProfile`, guarded `defineWrite`, MCP dispatch and meta-call already reuse the same profile setting | Test positive/negative through direct MCP, HTTP/RTC and `github_call` using existing fixtures; repair drift, not duplicate dispatch |
| CAP-1 fully proves provider rights | 1,549 operation records are source-complete; only 15 credential cells have exact official evidence and provider acceptance remains separate | Never label unreviewed or mere universal-candidate routes executable |

## Scope and concrete code boundaries

Read only the named existing seams while implementing: `src/oauth/policy.js`, `src/tools/server-diagnostics.js`, `src/data/permission-needs.js`, `src/core/registry.js`, `src/tools/server.js`, `src/github/capability-evidence.js`, `src/tenancy/github-consent.js`, `src/tenancy/mcp-route.js`, `src/github/credentials.js`, `src/tools/define-github-write.js`, `tests/unit/diagnostic-tools.test.js`, `tests/unit/rtc-http.test.js`, `tests/db/pub-2-pilot-identity.test.js`; extend existing fixtures, no new auth protocol. Follow `docs/UNIVERSAL-IDENTITY-HANDOFF.md`, `docs/END-USER-AUTHORITY.md`, `docs/HUB-COMPATIBILITY.md` and existing developer credential review.

- Plain Full selection in the normal server-owned consent form; no extra secret or God Mode credential required. Never change an existing user's saved profile automatically.
- Effect of `profile`, `mode`, account selection, tenant membership, provider token kind/permission, installation repository selection, spend/production/confirmation and pass policy must be independently named; green tool listing is not permission evidence. API source data alone never grants a user rights.
- Read-only diagnostics may guide a deliberate consent or installation upgrade, but cannot itself change settings, expose a bearer, accept a token through tools, move a private tenant, widen policy or make a provider write. Preserve fail-closed unknowns.
- Keep the original private owner setup, tenant-pilot OFF defaults, encrypted credentials, exact-account authorization and production/scratch restrictions. Keep the U/P/K family distinct from I, and do not invent a fallback.
- Tests must distinguish builder-safe synthetic proofs from actual private mobile/desktop consent and provider operations, which remain separate under PUB-4 and the original live acceptance ledger.

## Original five criteria — freeze all

1. Ordinary Full setup without extra credentials.
2. Intentional Everyday and read-only limits preserved.
3. Same-user Full execution through all actual dispatch doors.
4. Permission upgrade and denial recovery.
5. Provider/tenant limits still enforced.

## Verification and owner handoff

Run `npm run session:bundle -- --card docs/pr-cards/CAP-2.md` at baseline before the plan commit; retain this first plan SHA. During coding run focused unit/DB/RTC and route-shape regressions. Final tree needs `npm run check`, `npm test`, `npm run test:db`, `npm run test:shapes`, `npm run test:rtc`, frozen delivery comparison, exact-head `ci` and `release-policy`, reviews and expected-head merge. Source tests never substitute for deployed device/enterprise acceptance.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "89a32f39e310846618ff80a925425601ae8fb33f",
  "outcome": "Ordinary GitHub Standard Full setup and accurate operation-level effective-access diagnosis through native and RTC paths, with intentional profile limits and safe scoped permission-upgrade recovery.",
  "integrationBoundary": "Existing owner OAuth policy, private tenant GitHub consent, scoped connection context, read-only permission diagnostics, registry/profile filtering, native MCP, HTTP, RTC and meta-call dispatch. Reuse encrypted I/U/P/K; no additional credential types or live provider writes.",
  "newEngineering": "Complete secure Full selection clarity, exact operation/tool/account diagnostic layers, scoped reauthorization and permission repair guidance, all-door positive and negative tests and accurate documentation without overriding GitHub grants, memberships, user policy, production/money and existing other credentials.",
  "estimatedProductionLines": 650,
  "relatedWorkDecision": "One full original CAP-2 subsection spans one coherent setup/permission-recovery feature, not helpers. CAP-3 is a separate subsequent credential storage and lifecycle boundary; concurrent PUB-4 #268 owns separate client/mobile consent files and is not overwritten.",
  "subsections": [
    {
      "id": "CAP-2",
      "acceptance": [
        "Ordinary Full setup without extra credentials.",
        "Intentional Everyday and read-only limits preserved.",
        "Same-user Full execution through all actual dispatch doors.",
        "Permission upgrade and denial recovery.",
        "Provider/tenant limits still enforced."
      ],
      "remainingEngineering": [
        "Map the existing owner and private-pilot setup profile selection and emit truthful Standard Full guidance while preserving consent/installed grants",
        "Trace registered tools, connection account/role/profile/mode, credential kind, missing installation permissions, resource selection and user-policy denials through all entrypoints",
        "Implement operation-specific effective-access diagnostics and secure explicit upgrade and reauthorization recovery that never silently raises a stored profile or token grant",
        "Test independent preview/Full/read-only and everyday positive and refusal paths across direct MCP, HTTP, RTC and meta calls with real isolated tenant/database fixtures",
        "Reconcile original card/index/owner guide and provider permission evidence, pass focused/full exact-head CI and bundle comparison, self-review and merge without production enrollment or spending"
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->
