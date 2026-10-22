# CAP-4 — advanced GitHub gaps: governed enterprise, organization and integration workflows

**Status: IN PROGRESS — source engineering only, whole original CAP-4 incomplete.** Planned 2026-10-22 from main `abb5f177770de8bdedc31cbce0ef7181e85d55be`. CAP-4 is a single original unit, not a sequence of countable helper PRs. CAP-3 real private/device acceptance is deferred, **not declared passed**. CAP-5 cannot be completed without CAP-4 and PUB-4 evidence. Preserve independent PUB-4 draft #268.

## Drift check A and official contract (first coherent code seam)

- CAP-1 pins GitHub REST 2026-03-10 and a GraphQL schema, while `src/tools/org-read.js` already handles enrolled organization reads via `readerFor`, `plain` and profile-controlled `defineRead`. The existing `github_org_list_members` has a bounded result projection but not audited SCIM provisioning or organization audit events. Reuse it; do not invent unverified enterprise principals.
- GitHub's organization audit `GET /orgs/{org}/audit-log` is supported for enterprise-cloud org owners, with reviewed read `Administration` organization permission for fine-grained App tokens; classic/OAuth requires `read:audit_log`. See https://docs.github.com/en/enterprise-cloud@latest/rest/orgs/orgs?apiVersion=2026-03-10 . Audit events can contain sensitive fields: project only approved fields and cap pagination.
- Organization SCIM `GET /scim/v2/organizations/{org}/Users` and per-user GET require a GitHub Enterprise Cloud organization with SAML SSO; GitHub App I/U and fine-grained PAT need `Members` read; classic token requires `admin:org` plus SSO authorization. Do not confuse org-SCIM with enterprise managed-user SCIM, which uses different endpoints and administrative authority. See https://docs.github.com/en/enterprise-cloud@latest/rest/scim/scim?apiVersion=2026-03-10 .
- Enterprise audit `GET /enterprises/{enterprise}/audit-log` has contradictory classic-only versus App-token fine-grained guidance. Keep `enterprise-audit-token-contradiction` unresolved; the current connection has no independently enrolled enterprise principal or JWT route. See https://docs.github.com/en/enterprise-cloud@latest/rest/enterprise-admin/audit-log?apiVersion=2026-03-10 .
- No API finder result, 411 tool count, or accepted App permission is proof of current effective provider access. 403/404 remain permission/visibility denial, not proof a feature does not exist.

## Frozen original full CAP-4 acceptance

1. Every active inventory gap assigned to this unit is implemented or has an explicit provider-evidenced unavoidable disposition, without duplicate names or treating universal discovery as coverage.
2. Enterprise audit/governance and identity; organization versus enterprise SAML/SCIM/IP policy; security/compliance; packages and registry lifecycle; permission and credential administration; App JWT and integration/event lifecycle; remaining active services are reconciled in approved CAP-4 order.
3. Each supported workflow has exact official API/credential/host/tenant/secret/guard contracts with request-shape, guarded-write, isolation, error, replay/readback and bounded-result proof; real provider/device acceptance remains independently open.

<!-- bundle-plan:start -->
```json
{
  "baseRevision": "abb5f177770de8bdedc31cbce0ef7181e85d55be",
  "outcome": "Close all advanced gaps from CAP-1 with reviewed provider and tenant authority, keeping unsupported provider operations explicitly unresolved, not faked.",
  "integrationBoundary": "CAP-4 current GitHub.com source, existing App I/U and scoped tenant credential architecture; no private pilot activation, live provider mutations, public enrollment or new credential class by default.",
  "newEngineering": "First implementation seam: organization audit and SCIM read-only governed views reusing existing organization read tools. Next enterprise-only access requires distinct verified enterprise identity enrollment; registry transport, privileged writes, JWT and event lifecycle stay in the same original CAP-4 until complete.",
  "estimatedProductionLines": 600,
  "relatedWorkDecision": "CAP-3 source merged; private device/PAT acceptance deferred as external work, not waived. PUB-4 #268 remains an independent draft. CAP-5 final acceptance stays dependent on CAP-2/3/4 and PUB-4.",
  "subsections": [
    {
      "id": "CAP-4",
      "acceptance": [
        "Every active inventory gap assigned to this unit is implemented or has an explicit provider-evidenced unavoidable disposition, without duplicate names or treating universal discovery as coverage.",
        "Enterprise audit/governance and identity; organization versus enterprise SAML/SCIM/IP policy; security/compliance; packages and registry lifecycle; permission and credential administration; App JWT and integration/event lifecycle; remaining active services are reconciled in approved CAP-4 order.",
        "Each supported workflow has exact official API/credential/host/tenant/secret/guard contracts with request-shape, guarded-write, isolation, error, replay/readback and bounded-result proof; real provider/device acceptance remains independently open."
      ],
      "remainingEngineering": [
        "Review CAP-1 operation-gap report and exact provider evidence; reject contradictory enterprise audit bearer claims.",
        "Implement and verify same-tenant organization audit and SCIM reads with bounded projections and fail-closed permissions.",
        "Implement/resolve enterprise identity/audit/governance, packages/registry streaming, permission/token administration, App JWT/event integrations, remaining active inventory families.",
        "Test complete pinned request shapes, guarded writes, real disposable PostgreSQL tenant boundaries, stale/revoked credentials, failure/replay, secret redaction and readback.",
        "Run npm run session:bundle plan/report, full source checks and exact-head GitHub CI; keep independent deployed/device/provider acceptance open."
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->

## Source and release separation

Plan commit must precede source edits. First implementation reuses scoped I/U read paths and strict target validation; no extra token, secret input/output, unrestricted raw audit log, or provider write. Add focused synthetic unit tests, repository check, then exact-head CI on assembled source. Complete all remaining same-unit gap families before whole CAP-4 counting/merge per repo rules. The local session:bundle/npm runner is unavailable through the current remote-only GitHub session; no bundle-check pass is claimed. Do not use this record to waive a pre-merge gate. No production activation, customer or tenant enrollment, spend, live credential, release or provider mutation is authorized by this card.
