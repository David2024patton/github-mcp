# Batch G implementation closeout — 2026-10-12

Baseline main: `4b33195d49373019bc46e26995e8777a2537f380` (merged PR #65). This is an **implementation** acceptance record under `DRIFT-PROTOCOL.md` checklist C; it does not authorize live account or production operations.

## Delivery evidence

| Card | Merged PRs | Tested behavior and primary risk |
| --- | --- | --- |
| G-1 | #39, #41 | Workflow and run inspection, bounded job-log summaries, guarded dispatch/rerun/cancel and pending-deployment review |
| G-2 | #42, #43 | Exact CI state, check runs/statuses, artifact and cache reads/guarded writes |
| G-3 | #44, #45 | Scoped variables and secret metadata; sealed setup-page entry and access controls; no secret values in tool inputs/results |
| G-4 | #49–#53 | Read-merge-write environment protections, guarded deployment/status operations, independent branch/tag policy CRUD |
| G-5 | #54–#59 | Release metadata, guarded lifecycle, notes, URL policy and asset upload/deletion with private-address and immutable-release refusals |
| G-6 | #60–#64 | Pages reads/writes and package version/whole-package delete and restore, with incomplete-inventory and download-limit safeguards |

The current `docs/TOOL-CATALOG.md` has 53 tool rows tagged G-1…G-6, and every row is marked `built #<PR>` (count includes multi-card entries). The work index records G-1…G-6 as MERGED/COMPLETE. `docs/PLAN.md` Batch G acceptance is marked complete for implementation evidence only. Required check, unit, Postgres and GitHub-shape jobs are joined by the aggregate `ci` gate, including both Vitest shards. Post-merge main run [38189322554](https://github.com/Robinson-AI-Systems/github-mcp/actions/runs/38189322554) finished with all six jobs successful.

## Security and remaining external acceptance

- No live GitHub App, real server credential, Vercel production project, Neon production database or connected account smoke has been provided (IN-02…IN-05). Tests exercise the fake transport and disposable PostgreSQL, **not** a real owner account.
- IN-06 is unresolved: do not create or modify any real scratch repository, enable a V-1 seed or claim connected execution without the owner's scratch-account setup and verification.
- Production switches, irreversible operations, access widening, protected resources, outside-owner notifications and spending retain their independent approvals. No live resource was changed by this closeout.
- Batch G's approved design remains a reference, not a retired instruction; no authoritative document was eligible for archival. The small drift log has only cross-cutting A-3/A-4 entries still useful to later cards, so nothing was retired.

## Next-batch drift check (V-1)

The approved `BATCH-V.md` V1 scratch assumption is **not met** (IN-06). `src/dev/ledger.js`, `src/dev/scenarios.js`, fake and SQL ledger contracts and plan-only previews exist from #65. Real seed application, object-by-object recording, safe retry, scratch repository creation and public scenario/run tools do not exist. Next unit must validate pinned GitHub request shapes, exact run ownership and target/scratch classification **before** exposing a write. Keep preview-only/fake execution until owner gate is satisfied.
