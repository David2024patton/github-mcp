# CONTRIB-1 — Integrate useful outside PRs under the maintainer's control

**Owner authorization (2026-10-26):** David2024patton may continue proposing changes. The maintainer evaluates them and independently implements necessary amendments; David must not be required to perform maintenance or decide what merges. No automatic trust or automatic bypass of CI.

## Drift and bundling

- #402 corrects misleading preview and read-only marketing language in the homepage and Marketplace copy.
- #403 fixes Windows script-root URL conversion and cross-platform import violation paths and makes text checkout LF-stable.
- #404 correctly proposes root JSON `nosniff` and RFC 9116 `security.txt`, but its proposed two-year HSTS `includeSubDomains` is unverified across subdomains and must NOT ship.
- The upstream main already includes LIC-1 contributor-review and rights notice at `5c73190`. No other PR changes should be overwritten. #409 is an independent fork-CI approval feature with tested code but a current docs merge conflict; keep it independent from this bundle.

## Acceptance (committed BEFORE source edits)

1. Correct homepage *and entire marketplace description* where they imply every write is previewed. State read-only blocks changes, and risk-bearing writes are previewed/confirmed; small non-production writes may act directly. Preserve existing mobile instructions and tests.
2. Adapt #403's OS-independent script-root and path formatting, pin LF text files in .gitattributes, preserve binary PNG bytes, and exercise script/root expectations through CI. Do not weaken check scripts.
3. Include #404's independently useful root-route nosniff and a GET-only RFC 9116 security.txt with bounded future Expires, canonical HTTPS URL and the established security/support contact; route it through vercel.json and add tests for fields, headers and methods. **Do not** add HSTS includeSubDomains or any long-lived HSTS policy without a real hostname inventory. Existing edge HSTS remains unchanged.
4. Track source credit to David's #402, #403 and #404 and use owner-controlled PR with exact-head required `ci` and `release-policy`, all review findings resolved, no manually triggered Vercel deploy, no unrelated project changes or spending.
5. Only AFTER green exact-head merge: close #402/#403 as incorporated; close #404 as partially adopted, explicitly naming omitted HSTS and why. Keep #399/#400/#401/#405 for separate security corrections with real behavior tests; do not ask David to fix them.
6. Record owner outcome/notes under docs/status, retain a traceable decision note, avoid rewriting docs/STATUS.md. Check availability of local test execution before claiming it; when unavailable use GitHub CI as evidence.

**Delivery boundary:** This is an owner-supervised acceptance of *ideas* from external PRs, not a direct automatic merge of unreviewed fork branches. GitHub first-time-contributor pending Actions are not skipped. No changes to the original contributor's branches, production, spending, permissions or repo visibility.
