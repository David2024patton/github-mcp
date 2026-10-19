# Hub-owned discovery, provider-owned conformance — completion correction (2026-10-19)

**Status:** owner-approved corrective maintenance; no new roadmap feature credit and no provider connection test pass claimed.

## Binding owner decision

GitHub MCP is an independently usable provider. **GitHub MCP's completion requires implementing and verifying the latest reviewed Hub-compatible RTC/MCP contract on its own server, NOT a successful real Hub discovery, relay or Sandbox connection.** The Hub owns entering the provider origin, client discovery, authentication handshake, gateway tool routing and Hub-specific acceptance. Provider direct MCP/RTC conformance, correct server-issued credentials, standalone auth/refresh/revocation, truthful manifest and bounded guarded meta tools remain GitHub MCP responsibilities. Do not add a dependency on the Hub or unapproved publication.

Canonical Hub main specification reviewed: `3cc7f4ad4332155d639125b23e8a5c4c13804a3d` at `docs/HUB-CONNECTION-SPEC.md`, frozen RTC1 `docs/CONTRACT.md`. Our current reviewed main/live: `f98b45c4e53a154b369d126c59cda35b7a1886fa` READY. Historical provider queue remains unmodified until separately reviewed.

## Acceptance criteria (all necessary)
1. Preserve **all 57** historical acceptance rows, their true PASSED/BLOCKED/PENDING evidence and source revisions. Annotate only genuine Hub-run relay and Sandbox with `completionGate:false`; keep provider's own standalone direct RTC evidence row REQUIRED. Neither of the optional rows is marked passed or deleted.
2. `scripts/session-status.mjs` and its real tests must validate an explicit allowlist for excluded Hub rows; wrong IDs/invalid flag are rejected, optional rows remain in the ledger and snapshot, but don't hold standalone completion or require deferred Hub acceptance accounting. Other BLOCKED rows remain required and must still be rechecked. Counts report both required and optional truthfully.
3. Provider-side source `docs/HUB-COMPATIBILITY.md` correctly defines the boundary: versioned manifest, independent OAuth/RTC, bounded search/describe/call, authorization and denial/revocation, real deployed direct source evidence; no Hub-only callback or live Hub route is required. Hub-owned discovery remains optional integration evidence.
4. Reconcile `docs/MASTER-ROADMAP.md`, `docs/GO-LIVE-CHECKLIST.md`, `docs/STATUS.md` and owner decisions; record exact Hub spec revision, keep public plugin PRIVATE and no buyer/source acceptance inflation. Do not change runtime API, token authority, live data, GitHub provider credentials, paid capacity or release policy.
5. Full mandatory `ci`, release-policy, index/static checks, both unit shards and real PostgreSQL remain green at exact PR head; collect review comments and merge only under repo rules.

## Proposed implementation and security scan

This is corrective acceptance/workflow accounting rather than product features. Keeping informational Hub rows visible prevents silently erasing prior route work; the explicit optional-only whitelist prevents arbitrary developers from changing a required live security check to optional. No external pass, provider write, GitHub App change, Live deployment or money authorization. Source-only spec review is not a live contract certification. No new user approval needed for implementation of this documented architectural decision.
