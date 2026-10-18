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
