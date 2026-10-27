# 2026-10-27 — SKILLS-1: skills catalog integration (David Patton's skills library)

## What was built

A new "Skills catalog" section for this server, proposed by David Patton: three tools (`github_skills_search`, `github_skills_route`, `github_skills_execute`, area `skills`) fed by a generated, metadata-only catalog of David Patton's MIT-cleared skills. The server can recognise the library, say which skill fits a job, and run the GitHub family of skills step by step through its own guarded tools. Skill texts never enter this repository or its database; records marked `not-cleared` in David's registry are excluded by the generator itself. The design is in `docs/designs/SKILLS-1.md` and the scope and acceptance list are on the SKILLS-1 card in `docs/pr-cards/SKILLS-1.md`.

Branch: `ai/claude/skills-integration-20261027`. Pull request: pending. Baseline: `main` `e2f9d541a634ec77baceca125bbd48ab9c3bf06c`.

## The enable switch

The section ships switched off. The tools are registered and listed, and every call refuses until Chris sets `SKILLS_CATALOG_ENABLED=enabled`. Owner connections are entitled when it is on; tenants are entitled only when named in `SKILLS_CATALOG_TENANTS`; RTC passes get nothing. Merging changes no live behaviour, and production stays exactly as it is.

## What is verified, and what is not

Verified locally on this branch, at baseline `e2f9d541a634ec77baceca125bbd48ab9c3bf06c`: the full composite gate passes (`BASE_SHA=<baseline> npm run check`, exit 0 — secrets scan, docs-updated, work index at 107 cards, catalog at 479 tools in 44 sections, write safety across 479 tools, token budgets, eslint, session checks). The new unit suites pass: 29 skills tests (catalog integrity, the enable gate, tenant entitlement, route decisions, the hash-bound execute lifecycle, the planted-canary overlap test) plus the registry snapshot test, which now lists the three new tools last. The shapes suite passes (21 tests). The per-profile tool counts in the Totals paragraph of `docs/TOOL-CATALOG.md` were recomputed from the registry while updating them: `read_only` lists 199 tools, `everyday` 286, `full` 479 (the old paragraph's figures were already stale before this change).

Not yet verified: exact-head CI (`ci` and `release-policy`), which runs on the pull request itself and is the merge gate; the database-backed suite (`npm run test:db`), which needs a local Postgres the contributor's sandbox does not provide — the one new table is additive, follows the existing store patterns, and is covered by unit tests against a fake store; and any live use. Nothing has been deployed, the switch has not been turned on anywhere, and no real account has been touched.

## Next steps

1. Chris reviews the SKILLS-1 card and this pull request, and merges if he approves (merging alone changes nothing live).
2. When Chris is ready, he sets `SKILLS_CATALOG_ENABLED=enabled` (and `SKILLS_CATALOG_TENANTS` if tenants should see it).
3. Everything else in the skills library — the non-GitHub skills — is a later step that runs on David's host through the Hub, not in this repository.
