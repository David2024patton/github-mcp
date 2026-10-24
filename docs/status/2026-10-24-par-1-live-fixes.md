# 2026-10-24 — PAR-1 live fixes

- Released main a8ebd1c to live (plain fast-forward from ec4f883); Vercel READY.
- First live test of the new tools found two defects (docs search returned no results; stargazers said "not found" for a public repo). Fixed in this PR with tests.
- Next: after this merges and releases, re-test both live, then test the Approve-page "Add" step and Code Quality list on a scratch repo. Copilot review stays unverified (no Copilot plan).
