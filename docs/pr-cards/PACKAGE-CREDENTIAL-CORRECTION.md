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

## Published planning provenance

The local pre-code plan was frozen at f8a14e3, following completion plan 758e547. Git-data publication reproduces those planning snapshots as 7272183b and 975051a0 (with only the engineering baseline SHA translated to its published parent). No scope or criterion was changed after coding. The original local planning branch is preserved for recovery.

## Implemented proof and limits

Dedicated P is implemented across additive DB/fake contracts, encrypted credentials, protected setup, safe account view, package-only client, curated G-6 tools and explicit universal package reads. Existing package write contracts still pass through every door. Added tests verify actor/scope rejection, personal and org enrollment, replacement/removal/expiry, purpose/account ciphertext binding, missing-token no-fallback, foreign URLs/accounts, repository/permission-limited passes, read-only mutation denial, operation-specific scopes, provider SAML refusal, token authorization on the actual outbound request and rerunnable persistent schema. Local full units: 8,173/211 files (267.62 s, two workers); request shapes 21/4 files; final focused 123/3 files. All check validation must pass on the final ledger; actual PostgreSQL is unavailable locally and required exact-head CI must supply DB proof.

No new package credential was generated or enrolled and no real package was mutated. Live provider acceptance remains open. Current serving deployment is READY 20389ae0; this source correction awaits release.

## First publication CI and review

Exact published head 4540d93e passed every required CI family including real PostgreSQL, both unit shards, shapes, RTC, check, aggregate ci and release-policy. No review threads were present. Final accounting correction re-ran newly available O-1/U-1/W-7 because exact ancestry proved their earlier fixes deployed; this is an evidence correction, not a CI failure. A single final correction push also explicitly extends nonproduction setup refusal coverage to both package enrollment and removal. Fresh exact-head checks remain mandatory.
