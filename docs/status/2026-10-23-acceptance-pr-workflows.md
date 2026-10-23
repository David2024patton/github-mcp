Pull-request workflow acceptance on a disposable scratch repository (private, free plan, with a trivial CI workflow), run through the owner's connected server in PRODUCTION mode
on the deployment containing fixes #292, #293 and #294 (live bab6636). Observations; no queue row is formally closed by this note (the formal evidence file still needs an independently
verified deployed revision, which this agent shell cannot give beyond the Vercel READY check).
Three real defects were found by running these workflows, fixed, tested, released and re-run (see the three 2026-10-23 fix notes):
1. Free-plan private repos cannot hold protection or rules; the tools read GitHub's "Upgrade to GitHub Pro" 403 as "unknown" so a passing PR could never be green (#292, #293, production guard too).
2. The stack merge asked for 300 timeline events; the tool allows 100, so every stack stopped before merging (#294).
Observed, row by row:
- W7-NEW-REPO: guarded creation of the private repository (preview, draft saved, repo created); the next step (apply default rules/security) reports "not readable" on this plan and stops without guessing. Policy configuration is plan-limited, not verified.
- W1-OPEN-PR: PR opened by the workflow; the same request re-run reported "existing" with no duplicate.
- W1-PR-STATUS: head, base, CI (pending then success then failure cases), plan-limit disclosure, next action.
- W2-EXACT-MERGE: merge refused (draft, pending/unknown checks); then merged at the exact head SHA with independent readback; repeating the same request refused with "PR not open", no second merge.
- W2-STACK: three stacked PRs merged bottom-up one per call: merge #3, retarget #4, refused ("fresh CI not observed after retarget") until a new CI run appeared, merge #4, same for #5, final status "complete: every PR independently observed merged".
  Note for users: the repository's CI must run after a base change (this fixture needed an `edited` trigger plus a close/reopen) or the stack correctly waits forever.
- W4-CI-SUMMARY: failed job, failed step name, error lines, annotations, comparison with the default-branch baseline.
- W4-CI-RETRY: first retry applied once; a second request refused while the run was active, then refused permanently as "already claimed".
- W6-RELEASE: version/notes preview, draft created and read back, same request key replayed safely, publish required its own request key and exact release id, published and verified; then the release and its tag were deleted (cleanup).
- W6-CLEANUP: merged and closed-PR branches previewed, deleted and confirmed absent; the default branch was excluded.
- U1-REST-WRITE (earlier note) and U2 read/denial (earlier note).
Cleanup left the repository with only its default branch, the workflow file and the merged stack files; it is disposable.
Still not run, with the exact prerequisite: W3 guarded thread replies on a fresh PR (needs a review comment from a second account), H2 webhook signer/delivery (needs an owner-approved receiver),
G6 package auth (owner token), all spend/access-widening owner-approved writes (O4 budget delete, Codespaces access, Y7 paid, Y9D, U1 metered), H1 protection/ruleset writes on the public fixture
(not yet attempted; public repo supports them), NATIVE-REVOCATION and RTC-DIRECT (owner).
