# Supported package credential correction

## Frozen scope before implementation

GitHub REST Packages overview requires classic personal access tokens; package-specific read/write/delete scopes and actual package access apply. Pinned App routes are unavailable and installation calls return 400. This corrects existing G-6, without claiming another owner App permission.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "7272183b45467a21d3173370675141121d327a8f",
  "outcome": "Make original G-6 package reads, deletion and restoration use a supported explicitly enrolled classic package credential without widening notifications, account or pass authority.",
  "integrationBoundary": "Passphrase/CSRF protected setup -> verified provider actor and scopes -> encrypted dedicated package token -> account-bound package-only GitHub client -> existing guarded package tools.",
  "newEngineering": "Additive credential persistence, onboarding/removal, secret-safe diagnostics, restricted package client and package tool routing, regression and shared PostgreSQL credential contract.",
  "estimatedProductionLines": 330,
  "relatedWorkDecision": "Corrective maintenance of existing G-6, no new subsection or bundle credit. Keep original completion plan separate; real package acceptance requires explicit provider token enrollment and disposable fixture, not another App grant.",
  "subsections": [
    {
      "id": "G-6",
      "acceptance": [
        "Supported package credential can be enrolled, replaced and removed securely; actor identity and scopes checked before storage.",
        "Only exact connected-owner package API routes can use package credentials. Repository/permission-restricted passes cannot use an un-narrowable token; read-only cannot mutate.",
        "Original package reads/deletes/restores preserve previews, production/confirmation, exact state, idempotency and independent readback. Missing/expired/revoked/insufficient tokens fail honestly.",
        "Migration is additive and rerunnable, safe account views never contain ciphertext; original notifications credential stays isolated."
      ],
      "remainingEngineering": ["Dedicated encrypted credential persistence and secure enrollment/removal, restricted client routing, package caller integration and shared DB/behavioral regression proof."],
      "remainingWork": [
        "Deployed acceptance with owner-enrolled classic package credential and exact disposable package fixture."
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->

## Provider contract

https://docs.github.com/en/rest/packages/packages — read:packages for metadata; read:packages + delete:packages for deletion; read:packages + write:packages for restore. Repository-scoped registries can additionally require repo. Provider package-level access, SSO and organization token policies remain authoritative.

## Verification and resume

Implementation not started. Dedicated P credential never falls back to I/U/K. No production activation, paid service, token creation or real package mutation authorized by this plan.
