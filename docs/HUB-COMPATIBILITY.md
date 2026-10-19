# Robinson Toolkit Hub compatibility reference

**Owner decision, 2026-10-19:** This independent MCP server is a Hub-compatible provider, not a Hub client. The **Hub initiates** discovery, authorization and selected tool calls. The coding agent sees **one Hub MCP connection and a fixed, small set of gateway tools**, even as thousands of provider tools become searchable. The human and coding agent do their own planning. **Never create a server-to-Hub callback, brand-specific Hub adapter, unconditional eager `tools/list` expansion or provider-side automated planning.**

## Governing shared specification

- [Frozen RTC 1 contract](https://github.com/Robinson-AI-Systems/robinsons-toolkit-hub/blob/main/docs/CONTRACT.md) is the cross-repository baseline.
- [Hub connection compatibility specification and per-server checklist](https://github.com/Robinson-AI-Systems/robinsons-toolkit-hub/blob/main/docs/HUB-CONNECTION-SPEC.md) explains optional standards-based OAuth, independently delegated identity, bounded RTC meta-tool search/describe/call, pagination and result/refusal rules.
- Work from the **latest reviewed Hub main specification**; record the exact Hub commit and the selected provider's exact source and deployed commits whenever demonstrating compatibility. Treat a future breaking contract change as a separate versioned design decision, **never** a silent per-server wire-protocol tweak.

## Required integration boundaries

1. **Stay standalone.** Existing direct MCP clients and original provider credentials must continue working without Hub, and an authorized user may exercise the provider's full legitimate capabilities. Development-team spending, TEST and no-production safeguards are not permanent end-user product policy.
2. **Advertise, don't push.** Serve truthful public RTC 1 `/api/contract` metadata, stable tool prefix, areas, modes, profiles and authorization availability. Do not connect outward to Hub.
3. **Lazy, bounded tool access.** Serve the standard RTC meta-tool search/describe/call family under the *provider's own* authorization and risk checks. A Hub query returns a **small bounded search page** and fetches an individual schema only on demand. Preserve actual page/offset/cursor fields and exact denial codes. No eager full catalog into the agent context.
4. **Provider-owned consent.** Support the provider's independent RTC credential verification and, where implemented, standard OAuth protected-resource/issuer discovery, S256 PKCE, resource-bound consent, token refresh and revocation. The Hub never creates or widens provider scopes. A protected whoami identity that does not attest complete mode/profile/area grants is only enough for the Hub's **read-only** fallback; source must not claim full/write authorization from a successful OAuth callback.
5. **Accurate results.** Keep outputs bounded, protect large pages and handles from cross-account/caller reuse, and reject expired, revoked or narrowed permissions. Unexpected provider POST results must not be retried without a safety guarantee.
6. **Provider conformance separate from Hub integration.** Before marking this server contract-conformant, independently verify the deployed RTC manifest, a genuinely authorized **direct service-issued** read/denial, revoked/expired grant, refresh if offered, provider audit and direct standalone tools. The Hub owns actual Hub-to-server discovery, OAuth onboarding, callback, gateway relay, Sandbox routing and live Hub UX acceptance; none is a GitHub MCP standalone completion gate. Source tests or historical forced TEST connections are not genuine direct-provider live acceptance.

## Source boundary and owner completion correction (2026-10-19)

Reviewed Hub main source `3cc7f4ad4332155d639125b23e8a5c4c13804a3d` `docs/HUB-CONNECTION-SPEC.md`. Provider-owned conformance includes RTC1 discovery contract, independent protected OAuth/RTC passes, guarded lazy bounded meta tools, pagination/refusal semantics, and genuine direct-service verification. Hub owns discovery/connection/external route success. `GITHUB-RTC-RELAY` and `GITHUB-RTC-SANDBOX` remain historically blocked but optional, not required and not falsely PASSED. `GITHUB-RTC-DIRECT` remains a required standalone provider proof. A demonstrably nonconforming provider reply must still be fixed here; missing Hub federation setup or deployment alone does not block this service's completion. No server callback, Hub-specific adapter, default Hub dependency or public plugin launch.

## Current adoption status

This is a **documentation/implementation reference**, not a deployment, a new token, a registry enrollment or a successful live connection. Existing source and hosted service remain unchanged. Inspect the actual source and real issuer before claiming any checklist row passed.

When implementing a future tool or modifying authorization, include this contract compatibility check in the existing repository roadmap/card and tests, rather than duplicating the Hub's provider-independent router here.
