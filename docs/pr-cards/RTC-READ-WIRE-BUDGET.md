# RTC-READ-WIRE-BUDGET — full RTC read envelope preservation

Status: IMPLEMENTING (target #147). Confirm CI/merge/main and deployed acceptance independently.
Baseline inspected: main 2bf6829b3834492cdc0d8ad59f4a1d887c0f331f (#146).
Risk: bounded output integrity, owner-scoped 24-hour result retention. No schema migration,
provider API call, additional credential, broadened tool scope, or production change.

## Read only these

AGENTS.md; docs/SESSION-START.md; docs/AI-PR-READ-FIRST.md;
docs/HOSTING-COST-POLICY.md; src/rtc/http.js and batch.js;
src/tools/dispatch.js readReply; src/tools/server.js getResult;
src/core/result-rules.js; tests/unit/rtc-result-errors.test.js.

## Drift check A

| Prior assumption | Verified main behavior | Remedy and independent regression |
| --- | --- | --- |
| Canonical C-1 8 KiB guarantee also caps HTTP replies | HTTP wrapper adds ok/result/mode/handle/summary after canonical budgeting | Budget entire serialized RTC success envelope |
| A near-limit read can be truncated safely | Canonical shaped result may contain all data without a handle | Retain complete already-shaped result for same client; return handle or sanitized 503 on failure |
| Canonical retained responses always fit after wrapping | Kept-result preview adds HTTP metadata | Reuse existing handle when aggregate wrapper exceeds cap, without another DB write |
| Oversize retained pages can be copied to another handle | Re-request may reproduce the same wrapper indefinitely | Return original handle and narrower paging guidance |
| Own property guarantees usable structured result | structuredContent: undefined is an own property | Refuse 503, preserving legitimate null success |

## Implementation contract

- Add one bounded HTTP success-envelope helper to src/rtc/http.js, preserving existing
  canonical dispatch, metadata, scoped pass and per-batch rate authentication.
- For a new large shaped read, scan the proposed response for credentials and store
  complete shaped result only against connection.client_id with existing putResult (24h).
  Never save raw unshaped provider output or grant foreign access.
- If a valid existing retained handle exists, reuse without a second retained copy.
  A too-large result-page response points to the same original handle with a truthful
  request for smaller pageSize/fields, not another layer of handles.
- Storage outage returns sanitized 503, not a truncated success.
- Tests: wire byte cap with UTF-8, same-owner canonical paging, foreign-owner refusal,
  small/explicit-null compatibility, undefined failure, existing handle reuse, no
  recursive paging, storage-failure sanitization, preserved ordered batch child handles.
- Run targeted vitest, npm run check and npm test (CI is test runner if no shell),
  exact-head required ci/release-policy plus constituent jobs, self-review and final
  exact-main seven checks before merge. Never merge red/pending checks.

## Acceptance boundaries

This closes demonstrated source RTC read-envelope integrity gap only once
CI passes and source is merged. Public HTTPS production source, authorized pass,
direct OAuth MCP, Hub direct/relay/Sandbox, revocation and run-owned cleanup
remain separately evidenced; rtc:0 stays advertised until real conformance.
