# 2026-10-23 — New-repo workflow on private repositories

- Found live after release 7262d8f: `github_workflow_new_repo` stopped with "Actions/fork policy is unreadable" on a private repository, because GitHub has no fork-approval setting there (the settings reader already reports this as not applicable, #306).
- Fix: the workflow treats "not applicable" as nothing to set and carries on. Test in tests/unit/workflows-discovery.test.js (fails without the fix).
- Next: release, rerun the new-repo acceptance on robinson-ai-scratch/rtc-newrepo-accept-oct23.
