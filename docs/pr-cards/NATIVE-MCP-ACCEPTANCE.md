# NATIVE-MCP-ACCEPTANCE — verify real custom OAuth transport without connector substitution

Status: **MERGED (#164)** only after exact-head CI, review, and merge; deployed/provider proof stays unverified until genuine authorized execution.
Baseline inspected: `012d28236ff5a6e0c666a5b13fd7e1cd7d227354` (PR #163 merged main).
Approved outcomes: `docs/pr-cards/DEVELOPER-CONNECTION.md`, `docs/reviews/2026-10-13-completion-recovery.md`, `docs/STATUS.md` V-1/V-2 acceptance.
Risk area: developer OAuth evidence provenance. Migration: none. Production source: only an explicit operator-run script.

## Read only these
- `src/core/mcp-server.js`, `src/core/mcp-auth.js`, `src/tools/server.js`
- `src/tools/repos.js`, `src/tools/dispatch.js`
- `scripts/rtc-auth-evidence.mjs`, `scripts/rtc-public-evidence.mjs`
- `docs/developer-evidence.json` and `scripts/check-developer-evidence.mjs`

## Drift check A

| Assumption | Actual repository or deployed evidence | Correction |
| --- | --- | --- |
| Standard GitHub connector can certify custom MCP | Native `/api/mcp` uses OAuth bearer and a different service-owned state; standard connector calls are independent | Direct native Streamable HTTP JSON-RPC with protected bearer only |
| A reachable HTTPS endpoint proves connected provider | Live READY at #157; public discovery works but protected `/api/mcp` was not accepted by anonymous Vercel inspection | Require native initialization, visible tool catalog, scratch identity, provider read and explicit denied foreign account |
| A supplied SHA is deployment proof | `/api/contract` self-reports source; Vercel API independently supplies deployment SHA | Pin exact origin and preflight matching revision **before** sending bearer; never claim script independently read Vercel |
| A probe can perform unrestricted test mutation safely | Owner has configured scratch, but no authorized custom OAuth bearer is available in this coding-agent context | Read/denial only; revoked phase separately checks same credential; no seed or deletion in this change |

## Implementation and safety contract
- `scripts/native-mcp-evidence.mjs`: `probeNativeMcp({origin,providerRevision,token,scratchAccount,phase,fetchImpl})`. Only pinned HTTPS production alias; redirects forbidden; bounded body and request timeouts.
- Native MCP JSON-RPC method order: `initialize`, `tools/list`, `tools/call github_whoami`, `tools/call github_repo_list`, foreign-account read denial. Read and revoked phases run separately, with operator-controlled secret supplied by protected environment/vault.
- No credential or provider payload written to disk/stdout/log. Report only named pass/fail observations, never raw tool results, GitHub data, token, URL query or stacktrace.
- `revoked` checks **the same previously authorized and now externally revoked** native bearer returning 401. Script never revokes it and must not treat a generic unauthenticated probe as credential revocation.
- Non-goals: GitHub permitted writes/readbacks, destructive cleanup, RTC 1 certification, Hub direct/relay/Sandbox, production activation, automatic OAuth consent, pricing/spending and preview TEST relabel.
- Tests: `tests/unit/native-mcp-evidence.test.js` fakes transport JSON and SSE; verifies no token before preflight, foreign-scope denial, fail-closed stages, revocation 401, no leaked token and no false external outcomes.
- Commands: `npx vitest run tests/unit/native-mcp-evidence.test.js`, `npm run check`, `npm test`; required exact-head CI including db/shapes and release-policy. No tests run against real GitHub during CI.
- Entry point: `npm run mcp:native-evidence -- read` or `-- revoked`, with private environment entries for origin, exact independently verified SHA, secure OAuth bearer and authorized scratch account.

## Completion and next acceptance
Source/tests/CI establish only a tool *capable* of checking genuine custom service. They do not establish that it was executed against a deployed auth client or scratch GitHub provider. Continue once same native authorization has actually been enrolled in protected runtime; capture permitted read/write, exact provider readback, resource+identity denial, revocation and separately authorized cleanup. `docs/developer-evidence.json` keeps all unobserved layers unverified.
