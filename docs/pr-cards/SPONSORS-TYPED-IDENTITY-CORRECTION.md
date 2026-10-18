# Y-9 Sponsors typed-identity correction

## Frozen before coding

A genuine read using the authorized U credential failed because the current document queries both user and organization roots for each login. GitHub raises NOT_FOUND for the wrong entity kind. An independent organization-only U query succeeds with a complete empty relationship inventory. This is a source defect, not missing OAuth consent.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "57456efd7eb603b3d96674e1f75b115d99fadf37",
  "outcome": "Read and modify Sponsors relationships through verified entity-specific roots without weakening payment or privacy safeguards.",
  "integrationBoundary": "Existing Y-9 Sponsors U identity, provider GraphQL inventory and guarded financial write contract.",
  "newEngineering": "Select payer and recipient roots from verified GitHub account types; distinguish no published listing from unreadable data; reject incomplete or mismatched identities; preserve tier price and cadence; classify privacy/email exposure through the existing access guard.",
  "estimatedProductionLines": 140,
  "relatedWorkDecision": "Live acceptance exposed a bounded defect in existing Sponsors functionality. Corrective maintenance, zero new subsection or bundle credit. No real payment, production enablement or paid plan change.",
  "subsections": [
    {
      "id": "Y-9",
      "acceptance": [
        "User and organization queries each use only the verified entity root; validate payer identity and organization admin membership.",
        "A verified absent Sponsors listing is an honest empty offer, while partial or mismatched results fail closed.",
        "Financial writes retain production, confirmation, spend, replay and independent readback safeguards; tier cadence and privacy widening are explicit.",
        "Real provider evidence and the existing reversible label write are persisted without claiming compound acceptance complete."
      ],
      "remainingEngineering": [
        "Implement typed roots and realistic provider-error regression fixtures; run required exact-head CI and review."
      ],
      "remainingWork": [
        "Scheduled source-bearing release and genuine read acceptance; any real payment remains separately gated by eligible fixture and authority."
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->

## Execution boundary

The local execution environment disconnected before application edits. Repository Git-data authoring and required exact-head GitHub CI provide the execution path; no local test run is claimed for this correction.

## Implementation and acceptance checkpoint

Pre-code plan 5a2b07d509174cc430d6e08f2f05069cc91cb7f7 precedes implementation 098fdb8d43ed5fd7591aeecb2a86559d98bb0397. Payer U is checked against enrolled identity, positive numeric ID and literal User type; personal payer also matches enrolled numeric account ID. Organization payer requires active admin membership. Recipient public REST identity selects a single typed GraphQL root; exact login and full inventories are mandatory. Explicit absent listing returns sponsors_listing_available=false and empty tiers, never a valid paid tier. Price and cadence are checked again before mutation and in independent readback, along with requested privacy/email state. Exposure is declared through the existing access guard. The generic production, confirmation, spend, replay and uncertain-mutation recovery contract remains.

Provider evidence: actual curated own-actor read failed with wrong-root NOT_FOUND; an independent custom U organization-only relationship read returned totalCount=0, nodes=[], hasNextPage=false. This is source-defect proof and valid-U evidence, not a post-release curated pass. Real Sponsors payment/preferences have not been changed. Tests cover all four payer/recipient type combinations with realistic wrong-root errors, malformed and mismatched principals, truncated inventories, absent listing, tier cadence changes, access refusal through handler/dispatch/github_call, existing nine-check financial write contracts and pinned provider schema. Required CI is the verification runner because the local executor is offline; no local test result is claimed.

W-1 actual write proof is recorded in STATUS: apply existing documentation label, repeat existing PR, independent readback, remove only that label, independent exact baseline restoration. Its original compound notification/outsider-denial check remains open. All work is corrective maintenance, zero new subsection/bundle credit. The next action is exact-head CI, self-review and fresh review thread disposition, then authorized expected-SHA merge. Actual deployment and genuine corrected reads remain separate.
