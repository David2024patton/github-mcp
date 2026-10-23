# 2026-10-23 — owner can delete one public person's data

Built: owner setup action that deletes a public person's whole stored footprint (shared rows + their private area) by personal GitHub account name, typed twice; SQL function `gh_forget_public_tenant`; helper `src/tenancy/forget-person.js`.
Verified: real-PostgreSQL test (area gone, shared rows gone, token dead, other person untouched, organization name refused, private tenants refused, reconnect works) and setup-page validation tests.
Next: self-serve delete page, key safety review, load test, terms/privacy drafts.
