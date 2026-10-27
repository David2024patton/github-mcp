# 2026-10-27 — SKILLS-1: skills catalog integration (David Patton's skills library)

## What was built

A new "Skills catalog" section for this server, proposed by David Patton: three tools (`github_skills_search`, `github_skills_route`, `github_skills_execute`, area `skills`) fed by a generated, metadata-only catalog of David Patton's MIT-cleared skills. The server can recognise the library, say which skill fits a job, and run the GitHub family of skills step by step through its own guarded tools. Skill texts never enter this repository or its database; records marked `not-cleared` in David's registry are excluded by the generator itself. The design is in `docs/designs/SKILLS-1.md` and the scope and acceptance list are on the SKILLS-1 card in `docs/pr-cards/SKILLS-1.md`.

Branch: `ai/claude/skills-integration-20261027`. Pull request: pending. Baseline: `main` `e2f9d541a634ec77baceca125bbd48ab9c3bf06c`.

## The enable switch

The section ships switched off. The tools are registered and listed, and every call refuses until Chris sets `SKILLS_CATALOG_ENABLED=enabled`. Owner connections are entitled when it is on; tenants are entitled only when named in `SKILLS_CATALOG_TENANTS`; RTC passes get nothing. Merging changes no live behaviour, and production stays exactly as it is.

## What is verified, and what is not

Verified by the repository's own doc checks on this branch: the work index validates (`python3 docs/pr-cards/validate-index.py`) and the tool catalog counts line up at 479 tools (`python3 scripts/count-catalog.py`). The catalog design decisions — metadata only, the 30-minute per-connection route decisions, the payload-hash confirmation on execute, no new credential storage, and the planted-canary overlap test — are written into the design and the card's acceptance list.

Not yet verified: the runtime behaviour of the three tools against the full check suite and exact-head CI (`ci` and `release-policy`), and any live use. Nothing has been deployed, the switch has not been turned on anywhere, and no real account has been touched. The per-profile tool counts in the Totals paragraph of `docs/TOOL-CATALOG.md` were already out of date before this change and were left untouched rather than guessed; they need recomputing from the registry in a separate tidy-up.

## Next steps

1. Chris reviews the SKILLS-1 card and this pull request, and merges if he approves (merging alone changes nothing live).
2. When Chris is ready, he sets `SKILLS_CATALOG_ENABLED=enabled` (and `SKILLS_CATALOG_TENANTS` if tenants should see it).
3. Everything else in the skills library — the non-GitHub skills — is a later step that runs on David's host through the Hub, not in this repository.
