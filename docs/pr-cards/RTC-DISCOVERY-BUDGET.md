# RTC-DISCOVERY-BUDGET — preserve large tool metadata without oversized responses

Status: IMPLEMENTING (target #149). Baseline: main b34f5a68ebb551ca081fefd8e3b791d624122d3a (#148).
Risk: metadata completeness and bounded RTC wire; no migration, new capability, authority or production change.

## Read only these
AGENTS.md; docs/SESSION-START.md; docs/AI-PR-READ-FIRST.md;
docs/HOSTING-COST-POLICY.md; src/rtc/http.js, contract.js, discovery.js;
src/core/result-rules.js; src/tools/server.js retained paging;
tests/unit/rtc-http.test.js and rtc-batch-integrity.test.js.

## Drift check A
| Assumption | Actual source at baseline | Correction and proof |
| --- | --- | --- |
| Listing limit caps response bytes | 100 metadata entries can include full input schemas | Check complete UTF-8 reply against 8192 |
| Oversized discovery can be shortened | Silently dropping tools loses tool capability and schema | Persist full requested page under original connection, show truthful prefix and handle |
| One describe always fits | Input schema may individually exceed 8 KiB | Reuse existing guarded shaped retention for individual large metadata |
| Invalid query or bearer may be retried as data | Existing auth/query checks are before listing | Preserve refusals, no storage on denial |

## Implementation contract
- Keep existing search pagination and allowed server/meta-only read-only selector.
  If a full requested page exceeds 8192 bytes, retain complete selected page
  under client_id using existing 24-hour result store; return an inline prefix,
  shown/requested/total count, unchanged next-page value and connection handle.
- A single too-large GET describe uses the existing bounded RTC read envelope.
- Scan catalog data for credential shapes before retention; never truncate
  schemas, skip full entries silently, or return success on storage failure.
- Reuse github_get_result for paging without additional provider calls.
- Real fake-DB/HTTP tests: multi-item UTF-8 budget, retained 25th item, foreign
  owner exclusion, small no-store compatibility, huge describe, failed storage
  sanitized 503, missing bearer 401 and malformed paging 400.
- Mandatory exact-head seven jobs, self-review, threads, final-main CI, deployed
  exact revision and genuine custom pass/OAuth/Hub acceptance independently gated.

## Non-goals
Do not broaden provider profiles, credential scope, dispatch, production modes,
spending, releases, or RTC1 certification. Retained metadata is per authorized
service-issued preview/read_only scratch pass; standalone MCP remains independent.
