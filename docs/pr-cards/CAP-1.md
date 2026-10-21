# CAP-1 — versioned GitHub operation/credential inventory and gap validator

**Status: APPROVED, ENGINEERING IN PROGRESS.** Baseline inspected: `main=5398c4f53ab4bd64a23876fb0135c0f8d4be3175`, live `315a3259faafa474a9b36cc8410c5718d5b9326f`; existing PUB-4 draft #268 is separate and untouched. No live acceptance, provider permissions, expanded product capability, deployment or God Mode claim. Original owner scope: [MAXIMUM-AUTHORITY](../designs/MAXIMUM-AUTHORITY.md) CAP-1, no new unit.

## Drift check A

| Assumption | Actual main and official evidence (2026-10-21) | Kind | Correction/test |
|---|---|---|---|
| 411 named tools proves GitHub coverage | Registry contains 411 tools but no per-endpoint dispatch/access evidence; U-1 tests enumerate 1,232 pinned REST operations | Product interpretation | Enumerate versioned operation keys; no tool-count coverage metric |
| GitHub REST/GraphQL are a single credential surface | Pinned REST `2026-03-10` @ `58b1e0c`, GraphQL schema @ `be38ec5`; official GitHub App I/U, OAuth App, PAT and App JWT are distinct | Security/product | Preserve separate supported/unsupported/unknown credential columns; infer no token rights from generic OAuth |
| Universal REST covers every route | `assertUniversalAuthority` excludes App JWT/enterprise/secret operations and special scope cases; curated map preserves stronger guards | Mechanical/security | Candidate universal route is not an implemented/verified operation; explicit blocked and unresolved gaps |
| GitHub.com, GHE.com and GHES have identical operation coverage | Only GitHub.com source snapshots are pinned; current docs describe enterprise-preview and GHES-version differences | Provider contract | Distinct host applicability, no guessed enterprise/version parity |
| Cross-client private OAuth is finished | PUB-4 #268 remains draft, no real desktop/Android acceptance | Dependency | CAP-1 reads contracts only; does not edit PUB-4 or call private client endpoints |

## Build contract and risk boundaries

Read only: `src/github/openapi-index.js`, `src/github/graphql-schema.js`, `src/github/hand-built-map.js`, `src/github/operation-classes.js`, `src/tools/index.js`, `src/tools/universal*.js`, the two vendored `SOURCE.md` files, existing `tests/unit/universal.test.js`, owner design CAP-1 and governance rules. Do not read whole pinned schemas into the model's context.

- Add `src/github/capability-inventory.js` pure operation-level enumerator/validator. Input is pinned REST operation list, GraphQL root fields, explicit supported interface workflows, current registry and reviewed route evidence. Output is stable JSON with individual operation keys, source revision/URL/date, GitHub.com vs GHE.com vs GHES applicability, each credential-kind support and exact unknowns, prerequisites, concrete handler/candidate/denial, safety, status, work owner/dependencies and live proof (none by default). No external calls or writes.
- Add `scripts/capability-inventory.mjs` JSON + human gap-report CLI and `tests/unit/capability-inventory.test.js` for keys, source completeness, orphan/duplicate/missing entries, host/credential separation, guarded universal truth, family sum and honest unknown coverage. Integrate read-only validator with repo checks only after targeted tests.
- GitHub.com source: pinned REST 2026-03-10, GraphQL schema `be38ec5...`. Official reference: https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps ; https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app ; https://docs.github.com/en/enterprise-cloud@latest/apps/using-github-apps/installing-a-github-app-on-your-enterprise .
- No new provider action/tool, credential, SQL, schema change, spend, production activation or external registration; this inventory may prove gaps but it never grants authority.

## Full frozen CAP-1 acceptance (source complete only after verified proof)

1. Reproducible schema enumeration and orphan/duplicate/missing-row checks.
2. Every source operation reconciled with dispositions (unknown/unresolved and UI-only must remain visible; no invented coverage).
3. A machine-generated family gap report, reconciling to the operation records.
4. Credential conflicts explicitly unresolved, with no invented coverage percentage; separate genuine implementation and live evidence.


## Implementation checkpoint — 2026-10-21, awaiting independent exact-head CI

- `src/github/capability-inventory.js` constructs deterministic operation rows from the pinned 1,232 REST operations, all actual query and mutation root fields of the pinned GraphQL SDL, and independent Git HTTPS/SSH, registry and MCP workflows. Stable method/path/schema keys prevent a catalog/tool-count percentage from masquerading as functional coverage.
- Each row records official/pinned source revision/date, evidence, GitHub.com versus GHE.com and explicitly-versioned GHES 3.20/3.22 applicability (unknown for unproven versions), all eight credential kinds (unknown when not reviewed), prerequisites, lifecycle/safety constraints, implementation candidate versus curated mapping, responsible CAP unit and separately open external acceptance. Git and package protocols carry unversioned reference evidence, not REST schema authority.
- `scripts/capability-inventory.mjs --json|--summary|--validate` exposes the complete machine-readable census, family gap report and validation. `npm run check` invokes its validator; `tests/unit/capability-inventory.test.js` covers missing/orphan/duplicate source keys, host/credential separation, fake verified statuses and summary/percentage truthfulness.
- **Not yet evidence of passing tests, provider acceptance, implemented enterprise actions, effective credential rights or CAP-1 completion.** The unreviewed per-operation permission/credential cells deliberately remain `unknown`; completing permission evidence and proving the full original contract requires explicit review/test outcomes. Original original CAP-1 criteria remain frozen and incomplete until checked.
- No token, SQL, production/fixture or other service changes. Concurrent PUB-4 draft #268 is untouched. Do not treat a new checked CI run as genuine mobile device acceptance.

## Tests and publication

`node scripts/capability-inventory.mjs --validate`; `node scripts/capability-inventory.mjs --summary`; `npx vitest run tests/unit/capability-inventory.test.js`; `npm run check`; `npm test`; `npm run test:db`; `npm run test:shapes`; `npm run test:rtc`. Exact-head `ci`, `release-policy`, self-review and merge gates remain required. Local shell cannot access the public GitHub origin in this session; use actual required GitHub CI, never invent a local pass. Reconcile existing acceptance separately at review/merge.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "5398c4f53ab4bd64a23876fb0135c0f8d4be3175",
  "outcome": "Reproducible, truthful operation-level GitHub interface, permission and provider-gap inventory for all pinned source operations, instead of a misleading catalog credential percentage.",
  "integrationBoundary": "Pinned GitHub REST and GraphQL schemas, specialized tool registry, guarded universal API paths, explicit other protocol workflows, and per-host availability evidence; all read-only static analysis.",
  "newEngineering": "Implement a versioned operation inventory generator, credential/host applicability ledger, route evidence classifications, strict validator, machine-generated family gaps, and tests for every frozen criterion.",
  "estimatedProductionLines": 650,
  "relatedWorkDecision": "CAP-1 is one inherently large full approved subsection and a required foundation for dependent CAP-2/3/4. PUB-4 #268 remains concurrently owned; do not mix its OAuth files into this PR.",
  "subsections": [{
    "id": "CAP-1",
    "acceptance": [
      "Reproducible schema enumeration and orphan/duplicate/missing-row checks.",
      "Every source operation reconciled with dispositions (unknown/unresolved and UI-only must remain visible; no invented coverage).",
      "A machine-generated family gap report, reconciling to the operation records.",
      "Credential conflicts explicitly unresolved, with no invented coverage percentage; separate genuine implementation and live evidence."
    ],
    "remainingEngineering": [
      "Reconcile pinned REST/GraphQL and official host/credential contract differences without assumed token rights",
      "Enumerate stable operation keys and other documented supported interfaces with strict no-orphan/no-missing validator",
      "Map audited handler/universal eligibility, provider denials, prerequisites and external acceptance without promoting search-only routes",
      "Generate per-family gap summaries; prove input corruption detection and honest unknowns with focused/full test evidence",
      "Update existing card/status/index/owner guidance and pass exact-head required checks and review"
    ]
  }]
}
```
<!-- bundle-plan:end -->
