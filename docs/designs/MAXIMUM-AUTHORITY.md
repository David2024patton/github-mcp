# Maximum legitimate GitHub authority — approved plan, 2026-10-21

Owner request: expand the capability audit and roadmap so Standard exposes every
operation supported by its GitHub authorization, while optional **God Mode** makes
genuinely additional credentials easy to enroll. This is approved engineering
scope, not a claim of implementation, live verification or new developer authority.
[END-USER-AUTHORITY](../END-USER-AUTHORITY.md) governs product restrictions;
[SESSION-START](../SESSION-START.md) governs implementation and acceptance.

## Binding semantics

- Standard includes Full App/user authorization. `read_only`, `everyday` and `full`
  are user-chosen connection profiles, not subscription tiers or credential types.
  Full must be clearly accessible in ordinary setup without God Mode. Preserve
  deliberate existing restrictions; never silently upgrade a connection.
- God Mode is optional guided enrollment/routing of additional legitimate GitHub
  authority. It cannot manufacture privileges, bypass GitHub plans/SSO/approval,
  tenant boundaries, explicit user policy, revocation or guarded execution.
  The same operation remains available in Standard whenever its credential works.
- Distinguish OAuth App tokens from GitHub App user tokens and installation tokens;
  the word OAuth alone does not establish equivalent endpoint support.
- Developer $0, fixture, production, release and real-credential test restrictions
  remain binding. Robinson AI Systems is the developer/operator and can separately
  be a product customer: decide from environment, tenant, role, session and action,
  never company identity alone. No cross-tenant operator authority is implied.
- Retire **98.3% as a functional-coverage claim**. No such claim was found in current
  tracked docs during this review; a catalog credential classification is not an
  endpoint denominator. 411 named tools and universal dispatch do not prove coverage.

## CAP-1 — reproducible operation and credential inventory

Inputs: pinned REST descriptions and GraphQL schema with SOURCE revisions, current
GitHub official references/changelog, implemented tool registry, universal route
classifications, guards, credential store and tests. Start at the actual source
revision, not an old catalog count. Use bounded schema queries, never whole-schema
context dumps. Include GitHub.com, Enterprise Cloud/GHE.com and supported GHES
versions as distinct applicability records, rather than assuming host parity.

Produce a machine-readable inventory and validator with one stable key per REST
method/path/version, GraphQL root field (query and mutation), Git protocol workflow,
registry protocol operation and other documented supported interface. Family
summaries must reconcile to these records. Record:

| Field | Required content |
|---|---|
| Identity | Stable operation key, interface, host/product/version, family |
| Evidence | Official URL, checked date, pinned schema/source revision; conflicts |
| Authority | App I, App U, OAuth App, fine-grained PAT, classic PAT, App JWT, Git/SSH or workflow token support separately; supported/unsupported/unknown per type |
| Prerequisites | Exact permissions/scopes, actor role, plan, SSO, installation, resource selection and previews |
| Implementation | Named tool or concrete universal handler/classification, file/export and request-shape test; missing engineering |
| Safety | Target/tenant binding, secrets, paid effects, confirmation, replay and readback |
| State | Missing, implemented-unverified, verified, provider-retired, provider-UI-only or unresolved; evidence at exact revision |
| Delivery | Owning CAP unit, dependency, priority, next action and external acceptance prerequisite |

Count operation keys once even if several tools/credentials reach them. Report
inventory completeness separately from source implementation and live verification;
publish numerator, denominator, version and explicit exclusions. Unknown, retired,
UI-only and unresolved rows remain visible. Universal coverage needs evidence that
the actual guarded route can express the request, authenticate, dispatch and read
the response; an API finder result alone counts zero implemented operations.

Acceptance: reproducible schema enumeration and orphan/duplicate/missing-row checks;
every source operation reconciled with dispositions; a machine-generated family gap
report; credential conflicts explicitly unresolved; no invented coverage percentage.

## CAP-2 — maximize Standard and explain effective access

Inspect `src/oauth/policy.js`, private tenant authorization routes, profile filtering,
`src/github/credentials.js` and permission discovery before choosing exact seams.
The current owner form already offers Full and defaults to Everyday: improve clarity
and parity, rather than pretending Full is absent or silently changing the default.
Explain the intersection of provider authority, tenant/resource selection, connection
profile/mode and user policy; identify which layer blocks a requested operation.
Provide a secure explicit upgrade/reauthorization path retaining existing grants
when valid. App-supported enterprise/package operations must not require God Mode.

Acceptance: ordinary Full setup without extra credentials; intentional Everyday and
read-only limits preserved; same-user Full execution through all actual dispatch
doors; permission upgrade and denial recovery; provider/tenant limits still enforced.

## CAP-3 — guided additional credential lifecycle

Use CAP-1's operation requirements to offer only missing applicable credentials.
Inventory/reuse current encrypted I/U/K/P and fine-grained paths; do not relabel K
or P as unrestricted fallback. Build a typed credential registry and deterministic
operation-aware resolver. Each capability advertises its verified requirements and
each stored grant binds provider host, numeric human identity, tenant, account,
resource/enterprise scope, credential kind, permissions, expiry and verification.

One agent-initiated flow launches secure provider consent or protected service setup,
returns automatically and rechecks effective capability. Prefer provider OAuth/App
authorization; use protected token entry only where GitHub requires it. Never ask
for token values in chat/tool arguments. Never promise automatic issuance of a PAT
or approval GitHub does not expose. Additional enterprise principals require explicit
authorization and verified membership; matching names/email domains are insufficient.

Keep encryption context binding, CSRF/PKCE/one-use state and tenant routing. Verify
identity and minimal harmless capability reads; record honest unverified scope if
the provider cannot expose it. Unsupported downscoping refuses restricted passes
rather than borrowing a broad token. No credential trial-and-error or silent fallback
on a refused write; retry only after explicit remediation and existing replay rules.
Support permission upgrades, expiry, refresh, revocation, replacement, deletion and
safe recovery without losing unrelated grants or exposing secrets.

Acceptance: synthetic provider plus disposable PostgreSQL tests for two tenants,
same human in distinct workspaces, wrong identity/host/resource, stale/revoked grants,
concurrent refresh, interrupted setup, secret redaction and restricted passes; each
successful enrollment yields a verified before/after capability difference. Real
credential acceptance stays separately gated under existing developer rules.

## CAP-4 — close advanced functional gaps

After CAP-1, implement in this order: enterprise audit/governance and identity;
package/registry lifecycle; permission and credential administration; GitHub App and
integration/event lifecycle; remaining active services from the inventory. Include
organization versus enterprise APIs, SAML/SCIM/IP policy, security and compliance,
App JWT operations, webhook subscription/delivery verification and bounded results.
Where current tools already work, add evidence and close only the missing workflow;
do not manufacture God-Mode-only names or duplicate tools to raise counts.

For each family, write its exact current API/credential/secret/guard contract into
the JIT card before implementation; enumerate remaining inventory rows under the
same original unit until complete. CAP-4 is not complete after one enterprise read.
Respect provider-supported automation boundaries: UI-only and retired operations
remain documented dispositions, not fake tools. Registry upload/download and Git
protocol workflows require their own real streaming/size/host contracts; REST
metadata access does not prove publish/pull/push coverage. Secrets stay on protected
entry/one-time pages, including audit streaming credentials and App private keys.

Acceptance: every active inventory gap assigned to this unit is implemented or has
an explicit provider-evidenced unavoidable disposition; request-shape, guarded-write,
tenant isolation, error, replay/readback and workflow evidence per family. A missing
owner test grant does not prevent inactive implementation with synthetic proof.

## CAP-5 — end-to-end acceptance and truthful coverage reporting

Freeze acceptance before execution: same identity/resource/operation with ordinary
Full authorization, then a genuinely additional-credential operation before/after
enrollment; readonly denial, explicit policy denial, wrong tenant/resource/principal,
revocation, expiry recovery and ambiguous-write replay. Record exact deployed revision,
credential kind (never value), permitted fixture, observed provider effect/readback
and cleanup. Real enterprise/paid credentials or destructive tests need existing
independent approvals; no account upgrade or spend to generate evidence.

Acceptance: independently executed Standard and added-authority workflows, supported
client flows under PUB-4, all safety denial/recovery tests, bounded result provenance,
no cross-tenant escalation, and a generated capability report with reproducible
denominators. Missing external proof stays open with its precise re-entry trigger.
Keep the original 57-row acceptance queue unchanged; append new exact-source live
criteria when implementation supplies real procedures. Hub connection and public
distribution are not prerequisites for these capabilities.

## Current official-source corrections (checked 2026-10-21)

- [Enterprise audit reference](https://docs.github.com/en/enterprise-cloud@latest/rest/enterprise-admin/audit-log?apiVersion=2026-03-10):
  broad classic-token guidance, a note that Enterprise administration permission is
  unavailable, and per-endpoint App U/I support appear together. Treat support for
  audit-log GET as **unresolved** pending schema/changelog/provider reconciliation;
  stream-key documentation explicitly excludes fine-grained token types. Do not use
  the family as blanket proof that every audit operation needs another credential.
- [Packages REST reference](https://docs.github.com/en/rest/packages/packages?apiVersion=2026-03-10)
  has classic-token overview guidance alongside per-operation fine-grained support.
  Resolve each operation separately from registry authentication and existing P
  routing; no immediate security-sensitive credential routing change is authorized
  merely by a contradictory documentation table.
- [GitHub Models](https://docs.github.com/en/github-models) is fully retired as of
  July 30, 2026, including catalog, inference, playground and BYOK. Record a retired
  disposition, not an implementation opportunity. Copilot is a separate active
  product and still belongs in the inventory.

## Execution order and completion accounting

Existing eligible acceptance and PUB-4 continue in repository order. CAP-1..CAP-5
are registered after PUB; blocked publication-only PUB-5 must not block CAP work.
CAP-1 precedes CAP-2/CAP-3/CAP-4; CAP-4 also needs both authorization units;
CAP-5 needs completed CAP-2..CAP-4 and PUB-4 client evidence. Write bounded JIT cards
with the drift protocol and frozen original criteria before code. This planning
change completes **zero** implementation subsections and adds no live passes.

## Sol 5.6 implementation entry — owner 2026-10-21

The [concrete implementation handoff](../UNIVERSAL-IDENTITY-HANDOFF.md) maps these existing units to current files, migration boundaries, negative/positive fixtures and exact verification families. Use it with the original cards; no units, approval states or acceptance results change. Independent user/tenant/role/grant implementation is eligible engineering, not a live-provider prerequisite. Reconcile original unfinished work before dependent expansion.
