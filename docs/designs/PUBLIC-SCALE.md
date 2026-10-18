# PUBLIC-SCALE — private-first, mobile-and-desktop GitHub MCP readiness

**Status: DESIGN / NOT IMPLEMENTED. Owner requirement confirmed 2026-10-18.**
This document specifies the release-barrier design for **GitHub by Robinson AI Systems**. A successful private connector or production-enabled scratch account is **not** evidence that public multi-user service is safe. No owner consent to publish, enroll arbitrary tenants, spend money, or disable developer safety/release rules has been given.


## 0. Preflight / correction plan (frozen before follow-up changes, 2026-10-18)

**Owner requirement:** finish the product on mobile and desktop and engineer isolation for eventual public scale, but keep actual plugin publication, public enrollment and third-party spend PRIVATE/disallowed pending separate approval. **Not approved by the owner:** claiming the unofficial GitHub connector is eligible for the OpenAI public Directory or enabling public customer installs.

**Post-merge PR #261 review corrections, acceptance before changes:**
- Register PUB-1 through PUB-5 explicitly in `docs/pr-cards/work-index.json` with the reviewed `PUB` batch, update `validate-index.py`'s required batch/unit set and the human roadmap, and preserve all original 73 roadmap units and 57 acceptance rows. PUB-1 through PUB-4 must appear as APPROVED unfinished engineering with `WRITE_CARD_AT_START` (JIT card before coding); PUB-5 is BLOCKED on external policy and new publication approval, not silently counted done.
- State at the beginning that current OpenAI **Plugin Directory guidelines refuse plugins primarily functioning as unofficial third-party connectors**, even if technically excellent. The specific GitHub integration is not GitHub-endorsed and is not presumed directory-eligible. First establish legitimate GitHub/OpenAI authorization and policy eligibility for public Directory distribution; if unavailable, the valid product target is a securely scoped **private/workspace** or otherwise expressly permitted distribution route, not public Directory search placement. Never evade plugin review by renaming or wrapping the backend.
- Record owner-facing decision IN-18 as publication/eligibility PENDING and keep backend/plugin registration PRIVATE. Maintain the development agent's $0/CI/live-only safety boundaries separately from end-user product capabilities.
- Run unchanged check/CI, real Postgres, unit shards and release-policy against the exact follow-up PR head; read new reviewer comments before merging. No source implementation or original acceptance pass is claimed for this index-policy correction.

**Actual code work remains PUB-1..PUB-4 following independent just-in-time cards.** This corrective handoff must not be treated as a feature bundle or public release.

## 1. Current verified boundary (do not present as production-ready public SaaS)

- The existing service exposes many GitHub capabilities through a standalone MCP, and an approved owner-only scratch organization is connected. Its 57-row real-world queue was **14 PASSED / 28 PENDING / 15 BLOCKED** at this design checkpoint. Continue existing accepted plan, do not reset or rewrite the original queue.
- `src/db.js` stores `gh_accounts` keyed by GitHub login and a shared `gh_apps` credential inventory; the current owner setup and `src/core/oauth-handlers.js` use one `ADMIN_PASSPHRASE` and `src/oauth/policy.js` offers all connected accounts to whoever proves that password. **This is single-owner infrastructure, not public tenant isolation.**
- Both private plugins were independently confirmed PRIVATE: desktop/direct OAuth candidate `github-by-robinson-ai-systems` and mobile-oriented ChatGPT Sites/cloud adapter `Robinson GitHub Cloud`. The direct plugin's Android deep-link did not open a usable conversation. The cloud adapter's stored OAuth grant remained FULL/PREVIEW even after account-level production activation. Merged corrective PR #260 repairs the owner's protected upgrade flow but awaits checked deployment and real client readback.
- GitHub provider permissions, production mode, scopes, paid operations, existing protected resources, account-specific owner policies and release gates **must** remain effective. Developer-agent $0/no-paid/no-destructive restrictions must **not** become permanent capability limitations for legitimately delegated end users (END-USER-AUTHORITY.md).
- Plugins being PRIVATE is necessary but **insufficient** for public readiness. A production HTTPS endpoint alone does not provide multi-tenant auth, rate budgeting, operational monitoring or data isolation.

## 2. Non-negotiable product acceptance, owner go/no-go

1. **Both platforms:** a real Android or iOS ChatGPT session and a real supported desktop/web ChatGPT session can independently install/connect the private product, authorize their own GitHub identity, select allowed accounts/profile/PREVIEW vs PRODUCTION (when explicitly enabled), invoke `github_whoami`, exercise bounded reads and an independently confirmed disposable write, and revoke without breaking the other client. Do not count plugin listing/install, Codex-only deep link, MCP handshake or mock OAuth as actual acceptance.
2. **Same service-owned backend:** each client points to one versioned standalone GitHub MCP contract, uses fresh delegated credentials and is free to connect without the Hub. The Sites adapter is a compatibility layer, not a separate source of account authority.
3. **True tenant boundary:** a user of tenant A cannot list, query, edit, infer existence of, enumerate IDs from, decrypt, refresh or replay tenant B's accounts, clients, runs, retained results, usage, secrets, logs or settings. Two legitimate users may have the same GitHub login visible through separate delegated installations without joining tenants. Identity is provider-verified stable numeric subject plus explicit tenant membership, **never user-typed login or ChatGPT email alone**.
4. **Per-user authorization:** no public customer is ever asked for the developer's global admin passphrase. A real GitHub/OAuth or other explicitly approved identity login binds a verified account subject, tenant, client redirect + PKCE/nonce, permitted installation/repository inventory, and renewable/revocable per-tenant session. Production, money, deletion and access widening are separately delegated under that customer's own policy.
5. **Capacity and abuse:** prove bounded OAuth client registration, login attempts, provider API budgets and spend exposure, concurrent request/refresh behavior, job/result limits and automated incident revocation. Shared hosting must not let one abusive tenant exhaust all others' rate capacity. No new paid infrastructure or provider-billed load test is authorized by this design.
6. **Support and compliance:** have truthful plan/permission errors, privacy/terms/support and data-deletion/retention policies, an abuse reporting route, security disclosure/incident procedures, and tenant-bound audit records, with no secret values in returned messages or telemetry. Review the provider's public GitHub App installation rules and required OpenAI plugin submission standards as they exist at submission time.
7. **Publication hold:** all test plugins and registration remain PRIVATE/allowlisted. No public listing, universal-directory submission, public GitHub App installation, outside-user invitation, or billing activation without independent owner approval **after** all earlier gates and real-world criteria have concrete evidence.

## 3. Implementation sequence: coherent release-gated outcomes

### PUB-1 — isolated identity + additive storage foundation (security-first bundle)

- Add separate stable identities, tenants and memberships with explicit roles and membership revision to the schema. Use additive migrations and a backfill for existing owner records that **preserves** encrypted credentials, protected entries, result ownership, audit references, application jobs, and the enrolled scratch account; no destructive schema replacement or production data migration by the developer.
- Inventory every global key and every account-reaching table or cache (`gh_apps`, `gh_accounts`, `oauth_*`, `rtc_*`, `gh_installation_tokens`, `change_log`, `gh_async_jobs`, `dev_*`, `known_projects`, `protected_resources`, `server_settings`, `result_store`, `gh_rate_state`, `gh_etag_cache`, secret entry requests). Choose tenant-scoped composite/foreign keys and enforce isolation on **every** query; fail closed on missing tenant, never default to legacy owner.
- Preserve a narrow legacy owner-only connection path until migration and actual owner reauthorization complete. A public client must not be able to pick this path by parameter.
- Real disposable-Postgres contracts: two tenants with overlapping GitHub names, simultaneous OAuth registration, refresh, result handles, project rules, change journal and cleanup; each cross-tenant read/write/delete returns denial and leaves both records unchanged. Fake tests alone never count.

### PUB-2 — customer onboarding + delegated GitHub authority (one provider bundle)

- Serve separate owner/admin and public user authorization journeys. A new customer must verify provider identity before any account appears; allow only accounts/installations genuinely delegated to that principal. Account discovery and per-repository permissions reflect GitHub's actual installation grant and current membership.
- Move connection issuance to consent for exact tenant, verified user, OAuth client, selected account(s), mode, profile, and owner-configured policies. Preserve S256 PKCE, exact redirect registration, CSRF, single-use codes, revoke/refresh races and account-level production consent; end-user self-service does not get privileged owner setup routes.
- Keep the GitHub App private until publication approval. Support an allowlisted disposable two-tenant pilot with synthetic/provider test accounts; do **not** silently change GitHub App visibility, permissions or customer data.
- Verify test-provider installation revoke/suspend, user revoked/removed, identity change, invited collaboration, duplicate submit, and multi-client replay with real isolated Postgres.

### PUB-3 — scalable execution, limits and observability (runtime bundle)

- Tenant-aware database indexes/transactions and rate budgets; bound queues, result handles, job polling, retained data and GitHub API work per account/client. Confirm provider-specific ceilings where enforceable; otherwise fail closed for developer actions and expose honest product user-consent guidance rather than pretending a guaranteed spend ceiling exists.
- Per-tenant access, spend, production, audit, notifications and protected-resource policy remain independent. Every write still retains deterministic request key, correct target, dry-run/confirmation, readback, and safe uncertainty handling.
- Instrument latency, error classification, burst/abuse patterns, OAuth completion, token refreshing, deploy and provider availability without recording tokens, secret values or private repository content. A tenant can request credential revocation and deletion without removing another tenant's references.
- Run isolated synthetic concurrency/load/failure-injection in approved no-spend runners. Choose measured budgets and a validated rollback protocol **before** provisioning paid scale capacity.

### PUB-4 — private mobile + desktop product acceptance and migration (integration bundle)

- Native/direct OAuth remains the primary standalone MCP path. For mobile ChatGPT, verify an actually supported hosted/app path rather than a Codex desktop-deep-link shim; verify its authorization flow genuinely conveys tenant, selected profile and account to the server. No silent PREVIEW→PRODUCTION mode change on ordinary refresh.
- Create/verify independent genuine mobile and desktop test connections from private plugin listings. Capture exact client, account, mode, profile, source SHA and provider readback; independently verify both read and guarded disposable write. Test recovery from expired access with refresh credentials, reconnect without grants widening, revocation and account switching.
- The desired branding is **GitHub by Robinson AI Systems**, visibly identifying the developer rather than pretending affiliation with official GitHub or OpenAI. Keep PRIVATE in metadata and the Plugin Directory during every pilot. Do not assume changing a plugin's description updates an App-backed Sites presentation.

### PUB-5 — independent pre-publication gate (completion, not development approval)

- Audit system threats: cross-tenant access, OAuth attacks, installed App abuse, forged webhook delivery, stolen refresh token, shared rate exhaustion, paid/provider exposures, delete/replay, and tool prompt injection; complete real-Postgres + provider/test-client evidence.
- Define measured SLO/capacity and support/incident ownership, cost model, privacy/retention obligations and required verified developer/business identity for directory publishing.
- Compile approval evidence: all 57 original release acceptance criteria properly dispositioned (passed or an explicitly owner-accepted, documented provider-unavailable exception), tenant isolation, two-platform first-hand acceptance, operational and legal checks. Obtain a **new explicit owner publication decision**. Until then, PRIVACY=PRIVATE / no public enrollment, even if product features work in personal production.

## 4. Test and compatibility boundaries

- No direct GitHub writes to production or real customer accounts by implementing agents. Use only exact previously approved scratch artifacts, with independent approvals for deletion, paid Actions, notifications, grants, merge/publishing and per-account production.
- Reuse original `docs/STATUS.md` 57-row acceptance evidence and `docs/GO-LIVE-CHECKLIST.md`; public-scale tests are **additional** and cannot convert PREVIEW-only denials into production passes.
- Preserve current Vercel `live`-only scheduled 00:01 Denver promotion, CI/release-policy, no preview builds, Neon limits and $0 autonomous spending while implementing. Any capacity change with a bill requires independent approval.
- Each PUB subsection needs its own JIT card with full acceptance strings, pre-code plan commit, real Postgres/focused tests, complete intended code and exact-head self-review/CI; group 2–3 related full cards into one outcome PR when naturally connected. Never add a partially working public auth path to the existing single-owner code without an explicit flag that defaults CLOSED.

## 5. Sources to re-check before eventual public plugin submission

- OpenAI plugin guidelines: https://developers.openai.com/plugins/plugin-guidelines (notably desktop+mobile acceptance and accurate branding).
- OpenAI remote MCP submission: https://developers.openai.com/plugins/deploy/app-review (stable HTTPS endpoint, business verification and voluntary publication).
- OpenAI custom MCP app availability: https://help.openai.com/en/articles/12584461-creating-custom-mcp-apps-in-chatgpt (surface/plan restrictions can change).
- GitHub Apps and REST/API permissions: pinned repository GitHub API facts and GitHub's then-current App distribution/installation policies.

No work in this document alone counts as PUB implementation, a live acceptance pass, an owner publishing decision or a proven capacity target.
