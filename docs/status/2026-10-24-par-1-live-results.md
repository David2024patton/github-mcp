# 2026-10-24 — PAR-1 live results (live dec8be0, custom service-issued MCP, PRODUCTION)

- github_docs_search: PASS after fix #388 (returned docs.github.com pages for "branch protection rules").
- github_code_quality_get (setup:true) on Robinson-AI-Systems/github-mcp: PASS (state not-configured, languages, runner read back). github_code_quality_list: PASS (plain "not turned on" message). Turning it on (github_code_quality_setup) NOT tested: it may use Actions minutes (spend) and needs Chris.
- github_repo_list_stargazers: total is correct; GitHub refuses the people list for large public repos for both the sign-in and App credential; tool says so plainly (#389). Small repos not yet checked. Recorded as a known limit.
- github_content_edit_files, github_project_set_items, github_review_request_copilot: NOT tested live. Developer writes are unavailable in production mode by design (scratch repo creation refused); Copilot review also needs a Copilot plan (untested, not a blocker). Re-entry trigger: a preview deployment or the scratch organization (IN-06).
- Approve/My connection install buttons: Chris installed the App on his organization through the new flow and confirmed sign-in works after #391.
- work-index: PAR-1 set to MERGED.
