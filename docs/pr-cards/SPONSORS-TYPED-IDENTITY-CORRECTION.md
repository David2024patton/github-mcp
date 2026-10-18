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
