# Permission versus plan refusal integrity — October 17, 2026

Maintenance within approved H-4 and Y-9 scope. Product capability must reflect the end user's actual delegated GitHub permissions, not the developing agent's default test grant or a guess about plan eligibility. This is a cross-domain correctness remediation; no historical subsection credit or real-world pass is inferred from source tests.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "a822d1d16da9e017b26b14d7a41a0932e1e21fd8",
  "outcome": "Preserve truthful GitHub provider refusal identity across security dependency review and enterprise organization network configuration workflows; remove false plan-only diagnosis without relaxing user authorization, write guards, or provider errors.",
  "integrationBoundary": "GitHub HTTP 403/404 with x-accepted-github-permissions -> existing explainGithubError -> custom MCP read and guarded write refusal; src/tools/security-read.js and org-admin-extras.js, fake response fixtures, W-5/H-4/Y-9 callers.",
  "newEngineering": "Remove blanket plan-only reinterpretations of ambiguous GitHub 403/404; preserve original GitHub HTTP status and permission headers through shared sanitized error translation for read and preflight/update denial; retain explicit entitlement guidance only where independently known; add integration regressions for insufficient app permission, unknown 403, 404, zero writes, and normal successful read.",
  "estimatedProductionLines": 75,
  "relatedWorkDecision": "A demonstrated cross-product end-user authority defect spanning adjacent approved H-4 and Y-9 administration reads. Both original batch subsections are previously merged and receive no repeat engineering credit. A safety/permission-truth correction below rolling code-volume guide is not a standalone completed original bundle. Continue the other approved real-world acceptance obligations; no client/grant/production/billing change.",
  "subsections": [
    {
      "id": "H-4",
      "acceptance": [
        "Security alert inventories and dependency-review diagnostics use enrolled GitHub credentials, return sanitized data, and honestly distinguish non-entitlement from missing permission or inaccessible resources.",
        "A GitHub 403 without specific entitlement evidence must not be reported as proven `not_available_on_plan`; deny with actionable legitimate permission/plan/provider guidance and no mutation."
      ],
      "remainingEngineering": [
        "Correct dependency-compare 403 handling in security-read.js and add protected read/denial tests using real accepted-permissions HTTP error shape."
      ]
    },
    {
      "id": "Y-9",
      "acceptance": [
        "Organization network configuration inventory and mutation remain available for end users legitimately eligible on GitHub Enterprise Cloud, subject to the actual delegated credential and the original guarded write lifecycle.",
        "GitHub network-configuration 403/404 must not be uniformly represented as plan ineligibility; preserve the independent permission/not-found detail and never claim a provider write after denied requests."
      ],
      "remainingEngineering": [
        "Preserve authentic 403/404 across network configuration list, save preflight and provider write rather than collapsing all to a synthesized 422; regression-test missing App permission and unavailable resources."
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->

## Execution requirements

- Freeze this card in a commit before source edits. Inspect the original GitHub error translator and all call sites; reuse it rather than creating an alternative policy.
- Prove code paths on normal provider GET success and on 403 with accepted-permission headers, generic 403, and 404; no raw credentials or error payloads returned.
- Do not turn a user-authorized Enterprise feature into a categorical "not available" claim solely from status code; do not silently grant access or downgrade 403 to 422.
- Keep guarded network writes denied with no provider mutation on missing read/grant; respect developer no-spend, scratch isolation, and release policy.
- Verify tests and all mandatory exact-head GitHub CI; pre-merge review and green checks required. All 55 source-pinned live acceptance rows remain independent.
