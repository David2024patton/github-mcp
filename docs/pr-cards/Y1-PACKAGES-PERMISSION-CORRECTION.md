# Y-1 / B-8 — GitHub.com package permission diagnostic correction

Owner-requested corrective maintenance, 2026-10-17. Original subsections were already delivered; no new bundle credit.

## Drift check A

The deployed scratch installation has accepted `packages: write`, runners, merge queues and seven other approved updates. The real MCP still reports 23/24 because both the manifest and diagnostic needs require `organization_packages`, absent from the GitHub.com App settings UI. The pinned API schema lists that name, which is insufficient evidence of a selectable grant.

Evidence: https://github.com/orgs/community/discussions/32195 (author reports GitHub Support confirmed the mismatch; follow-up August 2025). Actual owner-authorized settings inspection October 17 corroborated absence. Current package REST documentation: https://docs.github.com/en/rest/packages/packages?apiVersion=2026-03-10 . Provider documentation has conflicting credential statements; do not infer runtime package success from a grant check.

## Boundaries and verification

No provider route, mutation guard, credential selector, token downscoping, saved permission, production activation or spend policy changes. Preserve `packages: write` as the existing available App grant. Package-specific authorization and independent delete/restore acceptance stay open. No live destructive probe.

Read: `src/github/app-manifest.js`, `src/data/permission-needs.js`, `src/tools/server-diagnostics.js`, `tests/unit/app-manifest.test.js`, `tests/unit/diagnostic-tools.test.js`.

Focused proof: manifest, diagnostics, existing package read/delete/restore unit suites. Publication: `npm run check`, unit and shapes suites; real DB proof via isolated CI if local Postgres unavailable. Self-review and exact-head `ci` plus `release-policy` required; normal scheduled release only.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "a4d0f3bd28ed30345105e0600dd2370987fa8f19",
  "outcome": "Correct the impossible organization_packages installation requirement without claiming package runtime acceptance.",
  "integrationBoundary": "Y-1 App manifest and B-8 installation diagnostics, their regression fixtures and owner onboarding guidance.",
  "newEngineering": "Remove the GitHub.com-unavailable organization_packages key from the manifest, upgrade list and diagnostics; test real-world permission-map absence and preserve genuine package grant failures.",
  "estimatedProductionLines": 12,
  "relatedWorkDecision": "Scoped owner-requested corrective maintenance of previously merged Y-1/B-8; zero new completed subsections or bundles. No credential, production, spending or provider-write changes.",
  "subsections": [
    {
      "id": "Y-1",
      "acceptance": [
        "New GitHub.com App manifests and permission upgrade lists do not request organization_packages.",
        "Installation diagnostics pass the package area with packages write and without organization_packages, and still report missing or read-only packages grants accurately.",
        "Owner instructions distinguish available App grants from operation-specific provider/package access and real live acceptance."
      ],
      "remainingEngineering": [
        "Update manifest and permission needs data.",
        "Add manifest exclusion and handler-level positive/negative regression tests.",
        "Update owner guidance and status; run checks, review and exact-head CI before merge."
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->

