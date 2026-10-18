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

## Verification checkpoint

- Focused manifest/diagnostics/package read-delete-restore suites: 6 files / 131 tests passed.
- `npm run check`: passed locally. Full unit suite: 210 files / 8,143 tests passed (264.48 seconds with two local workers). Request-shape suite: 4 files / 21 tests passed. Publication base comparison current/clean; docs consistency and index validation passed.
- Current main independently matches baseline a4d0f3bd28ed30345105e0600dd2370987fa8f19; live remains 20389ae0c667ec49d8ce80c5d48f4e2c42f7b2a2. Original acceptance ledger stays 10 passed / 15 blocked / 30 pending.
- Read-only custom `github_package_list` scoped to scratch container packages returned actual provider HTTP 400 Invalid argument. This is not a package capability pass and is not attributed to missing organization_packages. No package writes or retries were attempted; provider package acceptance remains open.
- Local Postgres binaries unavailable per `session:prepare`; isolated required database CI will supply that proof. No test skip or weakened assertion.

## Delivery and self-review

Implementation complete: unavailable grant removed from all three runtime data exports; available Packages write requirement retained. Positive package-area and genuine missing/read-only/irrelevant-key denials tested through the actual diagnostic handler. Manifest regression rejects the schema-only grant in new Apps and upgrade lists. Owner guide/checklist/status/decision updated. Initial production source +8/-4 (comments included; see review amendment for final scope), zero new whole subsections or bundles; this is a bounded correctness repair, not a normal-volume feature bundle. Published plan equivalent: ec940c49abe9043c09c344ff4e244ed7700cc752 (local pre-code freeze c0a11022d62533d8b5e2fb1912969e67c871fc4a).

Self-review: no credential storage, profile/downscoping, provider request, secret handling, protected-resource, production, spending, access-write, replay, RTC or package lifecycle changes. All actual provider refusals remain authoritative; no new capability acceptance is asserted. Local database proof unavailable; required isolated CI database, aggregate ci and release-policy must be green at the exact PR head before merge. No release is authorized by this repair.

## Review-driven amendment before the corrective patch

Exact-head CI passed for 235f0aa, then review PRRT_kwDOVD_LK86tmQeU identified the pinned package operations' `enabledForGitHubApps: false` metadata while current handlers select installation credential I. The observed real HTTP 400 reinforces that a satisfied App grant cannot prove package capability. Extend the same diagnostic repair: report package permissions satisfied but capability unverified, keep brief/full output explicit, count it separately from missing grants, and offer no impossible settings instruction. Other areas keep their normal ready status. Add handler tests for brief/full truthful counts and supported-area readiness. This preserves the original acceptance's installation-grant intent while making runtime uncertainty explicit; it neither completes a supported package credential path nor claims live acceptance.

Review patch verification: 132 focused tests across six suites passed, including brief/full unverified output with `permissions_ok: true`, `ok: false`, zero missing grants and no settings instructions. `npm run check` passed again. The earlier 8,143-test full local suite and initial exact-head CI preceded this review patch; fresh exact-head CI must validate the changed diagnostic behavior. No repeated full local suite is claimed for this patch.
