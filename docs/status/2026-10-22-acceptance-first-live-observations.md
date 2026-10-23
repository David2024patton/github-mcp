First real observations through the owner's connected custom GitHub MCP (PREVIEW, full profile, default and only account
robinson-ai-scratch). These are OBSERVATIONS, not closure of any queue row; live `live` is 64 commits behind `main`, so
only already-deployed behavior was exercised.
- whoami (full): mode PREVIEW, profile full, one account, App installation credential I and user credential U present,
  production flag true for the account but connection mode PREVIEW, no MCP spend cap configured, core rate 4955 remaining.
- admin_overview: free plan, 14 ok / 3 needs attention / 1 not readable / 2 not available on plan (SAML SSO, audit log), billed
  usage $0, one owner, no outside collaborators.
- billing_list_budgets: four organization budgets (codespaces, packages, actions, git_lfs), each $0 with usage blocked.
- repo_list: five scratch fixture repositories listed.
- issue_create dryRun: returned a preview, no write, logged as change 82.
- issue_list with owner Robinson-AI-Systems: refused before reaching GitHub (client:outside_scope).
Later the same evening the connector was switched (by the owner) to PRODUCTION mode for the scratch organization only, compact menu:
- github_call(github_issue_create, requestKey) on a disposable scratch fixture: status applied, issue #1 created, result read back
  from GitHub; the same request repeated returned status replayed with the same issue and no duplicate (issue_list showed exactly one).
- github_call(github_issue_update, state closed): applied, cleanup complete (issue closed, nothing else touched).
Ordinary scratch writes do not need production mode (the issue tools are classified production: never); production mode is only
needed for production-classified operations.
Not run: anything depending on code newer than the live deployment; read-only-profile denial (needs a read-only connection).
