# 2026-10-23: Acceptance sweep, defects found on the live release (66741a4)

Found while running the acceptance rows against the live server:
1. Reading a private repository's Actions settings failed whole: GitHub answers HTTP 422 for the fork-approval setting on private repos. It now reads as "not applicable" and the other four sections still return. This also unblocks repo-health's Actions section and the final step of `github_workflow_new_repo` (it stopped with "Actions/fork policy is unreadable").
2. Ruleset create/update read back as "unconfirmed" although GitHub had applied it, because GitHub adds `do_not_enforce_on_create:false` to required-status-check rules. Read-back now accepts provider-added defaults inside what we sent and still refuses any sent value that differs.

Both have tests that fail without the fix. Needs a release to be seen live; then the new-repo run on robinson-ai-scratch/rtc-newrepo-accept-oct23 continues from where it stopped (same request key).

Added later the same day (all found live, all with a test that fails without the fix):
3. Deploy keys: GitHub stores `<type> <base64>` and drops the trailing comment, so the add read back as "unconfirmed". The fingerprint now ignores the comment (read and write).
4. Organization settings: a profile text field GitHub reports as null (not set) was treated as "unreadable", so an empty description could never be set. Null is now a known value for profile text fields only; policy fields (permission, booleans) still refuse null.
5. Team membership: GitHub makes organization owners team maintainers, so asking for "member" read back as a mismatch. Accepted only for an organization owner.
6. Team delete: GitHub kept returning the deleted team for a moment, so the delete read back as "unconfirmed". The absence check now looks again up to three times (about five seconds).
7. Universal REST write, create: the read-back looked for the sent fields at the top of a list response and could never find them (runner-group create showed "unconfirmed" though created). A create is now confirmed when the created item (same id GitHub answered with) is in the re-read collection with every field sent.
8. Universal REST write, delete: a delete had no confirmation at all ("could not be read back"). It is now confirmed by the same object no longer being readable (404); still readable is not confirmed.
