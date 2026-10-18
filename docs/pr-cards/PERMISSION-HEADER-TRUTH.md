# B-5 provider permission-header truth correction

## Frozen before coding

Actual deployed custom explicit U package GET on owned scratch returned HTTP403 Resource not accessible by integration. Current parser turns the boolean allows_permissionless_access=true into a write grant and sends the owner to settings. The App settings do not offer that flag, and the package source already uses a supported separate credential. No additional App consent is established by this refusal.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "86bb77be911583138676bbea3c53b129cc17204f",
  "outcome": "Stop turning non-grant provider permission headers into impossible App approval instructions.",
  "integrationBoundary": "Existing B-5 accepted-permission parser -> safe 403 explanation -> actual read/write dispatcher refusals; preserve real grant hints and all guards.",
  "newEngineering": "Strictly parse explicit permission levels, exclude permissionless/schema-only nonselectable entries, and report unnamed integration refusal without inventing a missing grant; actual provider-response regression.",
  "estimatedProductionLines": 20,
  "relatedWorkDecision": "A new actual deployed U package GET returned HTTP403 with allows_permissionless_access=true, and the translator fabricated a write-grant approval request. This directly reproduces the owner\u2019s permission-confusion problem. Bounded B-5 corrective maintenance, no new subsection/bundle credit and no provider mutation.",
  "subsections": [
    {
      "id": "B-5",
      "acceptance": [
        "Boolean or malformed levels and known nonselectable metadata/schema-only entries never become App grant instructions.",
        "Real explicit read/write/admin permission diagnostics remain actionable and sanitized.",
        "An integration 403 without an actual selectable grant remains an honest credential/target/provider-policy refusal, not an assertion of unfinished owner consent.",
        "Preserve HTTP/request evidence, rate/rule handling, redaction and preflight/no-write semantics through real handlers."
      ],
      "remainingEngineering": [
        "Implement strict header parsing and honest unnamed 403 explanation; retain actual read-dispatch/preflight and parser regression proof."
      ],
      "remainingWork": [
        "Source-bearing scheduled deployment and recheck exact refused package U operation without phantom App grant instructions."
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->

## Provider/authority boundary

Current official package API documentation identifies classic token scopes and says several App-token endpoints require no permission. Only explicit read/write/admin grant levels are eligible permission hints; a boolean does not justify a synthesized write grant. organization_packages is also a known GitHub.com schema-only unselectable key already corrected in PR #252. Preserve exact provider status/request details, never infer paid plan or retry a write.

## Implemented scope and evidence provenance

Only explicit read/write/admin levels are parsed; the permissionless signal and known unselectable organization_packages key cannot become grant instructions. A permissionless alternative prevents inferred named-grant requirements. Real grant entries remain visible, with conditional comparison against actual grants rather than declaring an approval missing from response metadata alone. Unnamed integration refusal preserves HTTP/request evidence and points to credential support/target access. Rate/rule handling and all write guards are unchanged.

The real native probe exposed a sanitized error naming allows permissionless access (write), HTTP403 Resource not accessible by integration, request 8AE2:16FAD4:4738A3:E6F970:6AD438B1. The adapter did not expose raw response headers. We traced that rendered name to the parser’s synthesized write fallback; boolean and malformed header values are representative regression fixtures, not a claim of captured raw headers. Current official package docs state that these endpoints require no fine-grained permission and identify a supported classic-token path.

Focused parser and actual dispatcher tests pass 30 cases. The first new write-preflight fixture incorrectly requested a dry run, which intentionally returns a preview even when state is unreadable; after tracing core/write ordering it now uses an isolated confirmed fake intent and proves refused_by_guard/read, one GET and zero mutations. No implementation guard/assertion was weakened. A final stable full suite runs after the named-grant guidance became conditional; the earlier overlapping run is not claimed as final-tree proof. Local pre-code plan 5ccb26c is reproduced identically as d470755e, with the original preserved for recovery.
