# PUB-3 — Private tenant capacity, abuse controls and incident isolation

**Stage: frozen full approved acceptance criteria, implementation pending**. Source baseline `3c68af7dfe0a2352d53f490a395908bc3b2be260`. Existing private tenant OAuth was merged in PR #264; no live/private device acceptance is asserted. Keep plugins private and do not create a customer signup or pay for load testing.

## Drift check A — shared caller paths and safety policy

- Existing GitHub rate limiter `src/github/rate.js` uses **per-tenant isolated database** for per-account/installation provider blocks; owner global legacy path unchanged. Private tenant aggregate budgets and abuse limits are missing.
- Existing `src/db.js` result_store and gh_async_jobs retain 24-hour entries, but have no per-tenant storage ceiling/concurrency cap. Private namespaces already isolate all tables; avoid weakening provider permissions or user abilities to solve capacity.
- Existing `api/mcp.js`, `src/tenancy/mcp-route.js`, `src/tenancy/oauth-token.js`, OAuth and job start/result read seams are available. Limit only after verified tenant resolution; unauthenticated abuse receives refusal with no owner database fallback.
- Keep private tenant opt-in OFF by default. App storage/limits are separate from product spending caps and the developer's $0 execution budget. Existing owner may choose additional user-authorized capabilities.
- Do not add PII/credentials to telemetry; redact errors categorically; use opaque event/operation classes and bounded duration histograms.

## Original whole PUB-3 acceptance

1. [ ] Every active private tenant has atomic, independently configurable Postgres-backed account/connection request budgets and failure-path burst defenses across multiple Vercel instances; a burst by tenant A never consumes tenant B's counters or lets unauthorized calls reach GitHub.
2. [ ] Existing jobs, retained results and GitHub API access obey tested per-tenant/per-client bounded concurrency, size, lifetime and stored-row caps; expired records are reclaimed safely without deleting live work or data belonging to another tenant.
3. [ ] An authenticated tenant revoke/suspend/cancel makes further private traffic fail closed, including already-issued bearer refresh, outstanding jobs and result reads; previous and other tenants' data remains confidential.
4. [ ] Private operational metrics record bounded nonsecret rate decisions, request duration buckets, OAuth/refresh outcome classes and service/provider failures with no tokens, credentials, private repository content, raw URL queries, email or user-provided error strings.
5. [ ] Real disposable PostgreSQL two-tenant tests exercise concurrent requests, duplicate submissions, quota recovery, malicious/oversized payloads, tenant revocation, retention deletion and provider failure; unit/shape/RTC/CI and release-policy remain intact.
6. [ ] Current legacy owner path, all end-user delegated GitHub capabilities and production/approval/spend/protected-resource rules stay unchanged; operational fair-use limits are explicitly disclosed and must not silently impose the developer agent's $0 testing policy on customers.

## Implementation / proof plan

Atomic fixed-window tenant and per-connection quota claims in a shared per-tenant PostgreSQL schema, implemented with parameterized single-statement upsert and strong scoped keys. A reserved slot counts even if GitHub refuses; honest retry metadata. Bound concurrent jobs by tenant and client with read-before-insert prevented by a lock; cap retained result bytes/count while allowing normal shaped pagination. Expired results/jobs removed in bounded batches without touching active records. Telemetry uses predefined event types, coarse duration buckets, no raw bearer/url/errors or content, and a 24-hour retention cut.

Stress the real DB with concurrent two-tenant connections and the same IDs to prove separate quotas; verify rollback/retry, no job oversubscription, throttled cleanups and revocation. Validate all existing write and OAuth tests and both full unit shards. Update docs/STATUS.md, owner guide, roadmap, risk/decision notes and record line counts. No external runtime config, paid capacity, public listing or live write.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "3c68af7dfe0a2352d53f490a395908bc3b2be260",
  "outcome": "Complete PUB-3 PRIVATE tenant-aware runtime capacity and reliable isolation across requests, jobs, results, telemetry and revocation, while preserving legacy owner behavior and user permissions.",
  "integrationBoundary": "Private tenant MCP and OAuth path, isolated Postgres namespaces, existing job/result storage, no public customer enrolment, no new spending/provisioning/release.",
  "newEngineering": "Per-tenant atomic quota storage and enforcement, bounded retained data, safe cleanup and abuse-aware metrics, per-tenant independent DB tests with concurrent clients, auth refusal and real write gates untouched.",
  "estimatedProductionLines": 650,
  "relatedWorkDecision": "One substantial complete PUB-3 runtime isolation and resource protection trust boundary in one PR; PUB-4 real two-device acceptance remains a separate integration bundle.",
  "subsections": [
    {
      "id": "PUB-3",
      "acceptance": [
        "Every active private tenant has atomic, independently configurable Postgres-backed account/connection request budgets and failure-path burst defenses across multiple Vercel instances; a burst by tenant A never consumes tenant B's counters or lets unauthorized calls reach GitHub.",
        "Existing jobs, retained results and GitHub API access obey tested per-tenant/per-client bounded concurrency, size, lifetime and stored-row caps; expired records are reclaimed safely without deleting live work or data belonging to another tenant.",
        "An authenticated tenant revoke/suspend/cancel makes further private traffic fail closed, including already-issued bearer refresh, outstanding jobs and result reads; previous and other tenants' data remains confidential.",
        "Private operational metrics record bounded nonsecret rate decisions, request duration buckets, OAuth/refresh outcome classes and service/provider failures with no tokens, credentials, private repository content, raw URL queries, email or user-provided error strings.",
        "Real disposable PostgreSQL two-tenant tests exercise concurrent requests, duplicate submissions, quota recovery, malicious/oversized payloads, tenant revocation, retention deletion and provider failure; unit/shape/RTC/CI and release-policy remain intact.",
        "Current legacy owner path, all end-user delegated GitHub capabilities and production/approval/spend/protected-resource rules stay unchanged; operational fair-use limits are explicitly disclosed and must not silently impose the developer agent's $0 testing policy on customers."
      ],
      "remainingEngineering": [
        "Scoped atomic rate/capacity decisions in private tenant PostgreSQL and requests",
        "Bounded per-tenant async jobs/results and retained bytes, cleanup and revocation",
        "Privacy-safe operational metrics without token/repository/PII leaks",
        "Real two-tenant Postgres concurrency, oversized payload, replay and revoked session tests",
        "Check, full exact-head CI, review and documentation; no live/public/spend changes"
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->
