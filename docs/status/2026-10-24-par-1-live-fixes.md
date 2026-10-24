# 2026-10-24 — PAR-1 live fixes

- Released main a8ebd1c to live (plain fast-forward from ec4f883); Vercel READY.
- First live test of the new tools found two defects (docs search returned no results; stargazers said "not found" for a public repo). Fixed in this PR with tests.
- Next: after this merges and releases, re-test both live, then test the Approve-page "Add" step and Code Quality list on a scratch repo. Copilot review stays unverified (no Copilot plan).
- Docs check: PR body carries the Docs-update exception (no catalog-visible change).
- Chris reported the connection page showed nothing for installing the App on his organization (even after removing and re-adding). Cause: the "Add <place>" buttons depend on our own lookup of his organizations, which can quietly come back empty. Fix: a permanent "Install on another organization or account" button on both the Approve page and My connection that opens GitHub's own install picker (lists every place he owns). Tests: tests/db/pub-6-approve-add.test.js (new case), pub-6-public-connect (50) and test:browser (30) pass.
- Still to look at: why the organization lookup returns nothing for his account (likely the sign-in token cannot list organization memberships); the picker works regardless.
