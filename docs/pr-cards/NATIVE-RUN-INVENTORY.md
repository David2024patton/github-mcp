# NATIVE-RUN-INVENTORY — truthful remote scratch cleanup readiness via direct MCP

Status: **MERGED (#165)** only after exact-head CI, review and merge. Genuine deployment/connection/external run not yet observed.
Baseline inspected: `051cba864b4db23f0bd0e2e25943bd21d3518c12` (PR #164 merged main).
Scope: approved V-1/V-2 developer acceptance and recorded-run cleanup readiness; **no new provider mutation**. Migration: none.
Risk: treating a read-only remote inventory as a destructive permission or a complete/atomic snapshot.

## Read only these
- `scripts/native-mcp-evidence.mjs`, `src/core/mcp-server.js`
- `src/tools/dev-runs-read.js` and `src/tools/dev-cleanup-inspect.js`
- `src/dev/cleanup-execute.js`, `src/dev/cleanup.js`, `src/dev/birth-report.js`
- `docs/pr-cards/V-1.md`, `docs/pr-cards/V-2.md`, current `docs/STATUS.md`

## Drift check A

| Assumption | Actual at main | Correction |
| --- | --- | --- |
| Scratch app setup proves real V-2 cleanup eligibility | IN-06 owner configuration exists but no OAuth-connected custom TEST or run/remote proof | Require direct OAuth native MCP initialization/provider read and exact account denial before inspecting a run |
| Journal readiness is deletion permission | V-2 intentionally separates recorded inventory, remote preflight and fresh guarded confirmed deletion | This workflow observes only read-only journal and remote preflight; `deletion_authorized:false` always |
| A remote read result is a complete atomic snapshot | V-2 remote inspect is non-atomic and can return `LABEL_PROVENANCE_UNVERIFIED` or another block code | Fail closed on truncation, foreign scope or ambiguous remote result, preserve only safe bounded blocker code |
| New scratch repos are necessary for useful progress | Existing saved runs can be inspected without generating another orphan | Exact runId/repo inspection; never auto-create fixtures or invoke cleanup |

## Build contract

- Shared native protocol helpers exported from `scripts/native-mcp-evidence.mjs`: `invoke`, `resultOf`, `structured`. Every authenticated request pins the known service origin and preflight exact provider-reported SHA, with independent hosting-provider verification remaining the operator's responsibility.
- Operator-only `scripts/native-mcp-run-inventory.mjs` exports `probeNativeScratchRun({origin,providerRevision,token,scratchAccount,runId,repo,fetchImpl})`.
- Fixed sequence: prior `probeNativeMcp` read/identity/foreign-account denial, then exactly two calls to existing `github_dev_list_runs`: one exact scoped journal, one read-only remote cleanup preflight with optional birth-label comparison.
- Reject foreign run/account/repo, truncated arrays and absent/deceptive confirmation fields. Accept only `remote_snapshot_accepted` at exact scratch inventory phase, always report non-atomic and no deletion authority. A refused remote snapshot returns a safe blocker code, not success.
- No remote write routes, no cleanup preapproval, no stored token disclosure, no ACTUAL access expansion, no spending, no production activation, no Hub coupling. CI mocks never equal custom provider acceptance.
- Tests: `tests/unit/native-mcp-run-inventory.test.js` checks exact scoped successful read, label-provenance blocker, foreign/truncated responses, SHA mismatch before sending bearer, invalid inputs and failed native auth.
- Commands: `npx vitest run tests/unit/native-mcp-run-inventory.test.js`, `npm run check`, `npm test`, required full six-job exact-head CI and policy.
- Operator command: `npm run mcp:run-inventory` with protected `GITHUB_MCP_ORIGIN`, `GITHUB_MCP_DEPLOYED_SHA`, `GITHUB_MCP_ACCESS_TOKEN`, `GITHUB_MCP_SCRATCH_ACCOUNT`, `GITHUB_MCP_RUN_ID` and `GITHUB_MCP_RUN_REPO`. Never pass the token in CLI args or chat.

## Done/successor

Source+mock tests+green CI make repeatable native read-only inspection *available* after correct deployment. They do not create an authorized client, prove a connected scratch run or resolve GitHub default-label actor provenance. Continue independent genuine native OAuth, real provider read/write/readback, resource and identity denials, revoke/reissue, then separately authorized destructive cleanup; preserve the whole-repository deletion refusal until the provenance gate is actually resolved. Hub RTC acceptance remains optional and separately gated.
