# 2026-10-26 — CONTRIB-2: secure downloaded archive URLs

Owner directed maintainer to integrate security findings from David2024patton's #401 and #405 without asking the contributor for fixes. The main branch previously returned signed temporary redirects verbatim from archive, artifact and account-export reads. This branch adds a shared conservative allowlist and omits any unsafe redirect *entirely* from AI output, including detail:full. A safe GitHub web-navigation URL is supplied when direct download cannot be exposed. Existing clean public codeload archives remain usable. Fake-provider tests exercise query, fragment, credentials, malformed URL, host/path restrictions and all three affected tools.

No DB, permission, OAuth, deployment, protected-branch, spending or live settings change. Exact-head ci and release-policy pending; author PRs #401/#405 will be closed as superseded only once the owner branch is safely merged. No local full suite was run; actual CI evidence required.
