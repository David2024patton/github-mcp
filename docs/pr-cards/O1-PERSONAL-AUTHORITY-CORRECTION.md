# O-1 genuine personal authorization read correction

## Frozen before coding

Current deployed 20389ae0 has a valid owner-consented U, verified by actual tasks and O-4 reads. The O-1 organization and personal branches nevertheless unconditionally label personal status unreadable, never attempting U. This is internal missing code, not missing account-holder consent.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "a645ae56fe1d5a8edb071117ee36e22105c8008f",
  "outcome": "Correct O-1 owner overview to read genuine already-enrolled personal GitHub U identity rather than unconditionally claim missing authorization.",
  "integrationBoundary": "Existing O-1 account ownership -> enrolled U client -> provider GET /user -> minimal verified personal status with honest missing/denied/foreign identity.",
  "newEngineering": "Replace both organization and personal-account unconditional credential-unreadable stubs with a shared explicit U read, validate actual actor against enrollment, avoid I fallback and unnecessary private profile fields; add positive/denied/no-U tests.",
  "estimatedProductionLines": 40,
  "relatedWorkDecision": "Newly reproduced source defect during owner-requested pre-release completion: native whoami and U task/O-4 reads prove personal authorization exists, yet current admin overview always says personal unreadable. Bounded O-1 correction, not newly credited subsection/bundle. Package correction remains separate.",
  "subsections": [
    {
      "id": "O-1",
      "acceptance": [
        "When U is genuinely enrolled, verify GET /user identity and expose minimal actual personal status for org-associated or personal account.",
        "Missing/revoked/denied/mismatched authorization stays honestly unreadable, with no App-token fallback, private profile leakage or account-scope widening.",
        "Preserve every existing organization, billing, cap, production, read-only and guided/browser acceptance boundary."
      ],
      "remainingEngineering": [
        "Implement verified shared personal-status read in both branches and meaningful request-boundary regression coverage."
      ],
      "remainingWork": [
        "Source-bearing scheduled deployment and genuine custom personal-status plus original guided browser acceptance."
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->

## Provider and safety boundary

Use the pinned GET /user already used by O-6 and O-4. Match actor to stored user_login for organization U, or the enrolled account login for a personal account. Return id/login and optional 2FA/plan only; withheld settings remain null, no email or other private profile fields. Credentials stay encrypted and never appear in arguments/results. No GitHub mutation, new permission, production activation or expenditure.

## Implemented proof before integration

Shared personal-status read now uses only enrolled U and GET /user in both organization and personal branches, validates positive numeric identity/type and expected enrolled login, and verifies personal account numeric ID. It exposes only id/login and optional 2FA/plan; withheld values remain null. No U gives protected setup guidance; 401/403 and foreign/malformed identities remain unreadable, with no I fallback. Existing organization/cap/billing status is unchanged.

Local focused O-1 tests: 23 passed. Full unit suite on inspected a645ae56 plus this correction: 8,155 tests/210 files, 272.45 s, two workers. Actual request headers prove U and method/route validation reports no invalid provider calls; private email/bio/token fields are omitted, and all requests are GET. This is a small existing O-1 defect correction, not newly credited roadmap work. Local pre-code plan 270374b is reproduced as published planning commit 667c17d7 with the same baseline/content and is preserved on a local recovery branch.

Package PR #253 is independently pending final review CI. Before this correction is published, integrate its final main tree, rerun shared-boundary focused proof and all required publication checks, and keep O-1 deployed/UI acceptance open. No DB, credential-store, production, paid, account grant or manual release changes.

## Integration checkpoint

Merged main 86bb77be (PR #253) into this isolated worktree without conflict, preserving both frozen plan histories and tested package credential boundaries. Implementation source c2bdb909 is the actual minimum original O-1 acceptance pin; all other original queue requirements stay intact. Current serving source remains READY 20389ae0, so the new personal read is not yet genuinely deployed. Source/schema/fixture integration checks and fresh exact-head CI/review run before publication/merge; real post-release identity/UI proof remains pending.

## Final local publication proof

Integrated focused suite: 170 tests across six files, including O-1, package credentials, setup, universal routing, server status and persistence contract. All 21 provider request-shape tests and npm check pass. Pre-integration full O-1 suite: 8,155/210 files; merged package tree independently passed full units and every exact-head CI family. No relevant shared behavior changed on integration: the new optional fixture flag defaults false, credential stores and request guards remain independent. Required fresh CI verifies the complete combined tree. Meaningful production diff excluding comments/blanks: 26 added/5 removed, a bounded correction to already merged O-1, zero new subsection/bundle credit. Original live identity/UI proof remains pending.

## Review correction before merge

First exact-head CI at 057de7db passed all required families. Independent review correctly identified that a valid id/login without the provider-required type could pass. The helper now requires literal type User, with missing and empty type payloads added to malformed-identity regression cases. No good provider response, permission, output field or account scope changes. Focused/shapes/check proof and fresh exact-head CI are required before merge; the live queue must pin this stricter implementation.

Final reviewed implementation pin is 41f1655e, requiring provider type User rather than accepting a missing/empty type. Corrected integrated focused suite passes 172 tests/6 files; all 21 provider shapes and npm check pass. Original O-1 real deployed/UI criteria remain unchanged and pending.
