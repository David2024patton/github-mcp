# RTC-META-SCOPE — prevent nested registry meta-tool area bypass
Status: implementation PR #139, RTC 1 and hosted connected acceptance IN_PROGRESS.
Baseline inspected: 729e26c2015a6955c428eb3d17f1196702a06f71 (#138 merged). No schema, provider write or shared core.

## Read only these
AGENTS, SESSION-START and hosting policy; src/rtc/scope.js and http.js;
src/tools/meta.js, dispatch.js; tests/unit/rtc-http.test.js;
docs/audits/RTC-HUB-ADOPTION.md and #133 recovery direction.

## Drift check A
| Assumption | Actual source | Correction |
| --- | --- | --- |
| Restricting outer tool area stops all nested calls | `github_batch` is read-only/meta yet uses registry to call other areas | Exclude registry-consuming wrappers from pass-only HTTP |
| Existing HTTPS needs meta-tool wrappers | HTTPS already implements guarded search/describe/batch directly | Preserve explicit routes and independent per-read reauth and rate |
| Standalone MCP should be replaced by Hub | Independent OAuth MCP and original dispatch remain | No change to original registry or handler |

## Implementation and acceptance
The single shared RTC HTTPS tool selector rejects `usesRegistry` wrappers
even when marked readOnly. This covers search, describe and batch wrappers;
the original OAuth MCP retains them. Test with the real standalone dispatcher:
a cross-area nested read is possible in the original full registry, then prove
the restricted HTTP discovery, direct call and batch refuse every wrapper and
out-of-area read, with no subsequent handler side effects. Allowed server/meta
read tools and the explicit HTTPS batch remain functional. Tests, exact-head
check/unit/db/shapes/ci, release-policy, self-review and final-main CI required.
No protected pass, TEST relabel, actual Hub route or scratch cleanup claim.
