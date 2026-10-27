# FORK-CI-1 — Owner-authorized first-time contributor CI approval

**Recovery 2026-10-26:** original PR #409 became dirty after 71 subsequent main commits. The original plan (pre-source 6a949dec) is retained here as a clean main-based recovery branch. Acceptance is identical; source and tests must be carried forward to a fresh checked PR, then supersede the conflicted original without bypassing checks. A genuine public fork PR run may have a synthetic merge SHA distinct from the PR branch head; verify GitHub semantics and do not accidentally add an MCP-only restriction. No external fork is approved as part of this source PR.


**Owner clarification (2026-10-26):** Protected-resource and hosting safeguards prevent accidents, surprise production changes and unwanted spending. They must not permanently deny an intentionally authorized owner/coding-agent operation. Approving an external contributor's GitHub Actions run lets ordinary required checks **run**; it does not bypass checks, merge, or deploy. The owner requested autonomous review of #402/#403 without visiting GitHub.

## Scope and acceptance (commit this before source edits)

1. Add a guarded, deliberate `github_actions_approve_fork_run` write using the pinned `POST /repos/{owner}/{repo}/actions/runs/{run_id}/approve` GitHub API. Target a named repository, exact open fork PR number, exact head SHA and exact run ID. Verify GitHub's live run is a still-unapproved `pull_request` run and matches that PR/head. Refuse stale, closed, same-repo, non-PR, already approved or mismatched run before any POST. Return no secrets.
2. Within `pr-only` repositories, allow **only that dedicated guarded tool** as a normal PR-conveyor step. Leave `locked` unchanged; do not touch the owner's protected-resources rows or allow generic universal API writes. Continue to refuse production/deployment workflows; check the workflow definition at the selected immutable run SHA (not mutable base), fail closed if unknown or production, preserve owner confirmation, full profile, existing credentials, journaling, replay and independent readback.
3. Add write-contract tests (all nine contract behavior lines) and concrete negative-path tests: fork/head/PR/run mismatch, stale recheck, production workflow and no bypass through universal API. Demonstrate no workflow approval POST for a refusal, preview or read-only connection.
4. Keep current `ci` and `release-policy` required **green at exact PR head for merging**, and the scheduled `live` release as-is. Approval never runs production deployment and never waives GitHub's own permission/approval checks.
5. Update the tool catalog, owner-facing guidance, status and decision note. Verify the existing catalog/PR-only inventory and no migration/credential handling is required. Run the full repo checks once on the finished branch and merge only after exact-head CI/review permits.

## Completion — 2026-10-26

- [x] Source recovered and merged as **PR #420** (merge commit `bdfc8dc3663e28f4e662dcbddb8cbc1153968ad3`; final PR head `c75596c836725a883440d11348e6096cf25f2e68`). Original conflicted **PR #409** received a courtesy explanation and was closed *unmerged*, superseded.
- [x] Dedicated `github_actions_approve_fork_run` uses guarded user-token approval with exact PR/run/head, required full profile, explicit confirmation, durable one-use journal, fresh pre-POST GitHub checks and independent readback. No actual external fork approval was executed in this source PR.
- [x] Compatibility: `pull_request` run SHA may be a synthetic merge commit; require its two parents to include the exact reviewed contributor head. Exhaustively check every changed-file page (up to 3,000 items) and refuse unknown/inconsistent identities.
- [x] Review corrections: inspect the immutable selected run SHA for workflow production intent, deny production or unreadable workflow revisions on *all* connection modes; corrected two-pass pagination test. All three review findings addressed without weakening checks.
- [x] Exact source-head GitHub Actions `ci` and `release-policy` completed successfully including unit shards, PostgreSQL duplicate-claim, request-shape, browser, RTC, shapes and static checks. Source version is **not yet released to live**; next normal scheduled promoter remains the only release path.

## Drift check — 2026-10-26

- The existing `pr-only` allow-list already permits rerun/dispatch/cancel but not a fork run approval; add just the new reviewed tool, not a generic allow-all.
- The GitHub-pinned `actions/approve-workflow-run` endpoint accepts a GitHub App user token with Actions write, with 201 on provider acceptance. Its approval does **not** satisfy CI checks or skip reviews.
- The write dispatcher currently performs provider `read` before journal replay, so a successful run can have advanced to `queued` when the same request arrives. Keep exact PR/run/head validation on read; require `action_required` again immediately before the POST, so a prior journal replay works but an unrelated already-approved run cannot be approved again.
- `docs/TOOL-CATALOG.md` section and total counts, registry test, work index and index-validator acceptance list need a synchronized update.

## Delivery boundary

This is a tool capability change, not approval of any particular untrusted fork run. The owner explicitly authorized approvals for #402 and #403; after the normal scheduled release, separately confirm the exact runs and act only where GitHub still presents them as approval-pending. No GitHub branch protection, repository access, Vercel release or spending setting may be weakened. No direct writes to main.
