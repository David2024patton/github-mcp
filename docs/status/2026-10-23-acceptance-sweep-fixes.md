# 2026-10-23: Acceptance sweep, defects found on the live release (66741a4)

Found while running the acceptance rows against the live server:
1. Reading a private repository's Actions settings failed whole: GitHub answers HTTP 422 for the fork-approval setting on private repos. It now reads as "not applicable" and the other four sections still return. This also unblocks repo-health's Actions section and the final step of `github_workflow_new_repo` (it stopped with "Actions/fork policy is unreadable").
2. Ruleset create/update read back as "unconfirmed" although GitHub had applied it, because GitHub adds `do_not_enforce_on_create:false` to required-status-check rules. Read-back now accepts provider-added defaults inside what we sent and still refuses any sent value that differs.

Both have tests that fail without the fix. Needs a release to be seen live; then the new-repo run on robinson-ai-scratch/rtc-newrepo-accept-oct23 continues from where it stopped (same request key).
