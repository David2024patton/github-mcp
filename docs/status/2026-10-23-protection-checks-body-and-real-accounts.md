# 2026-10-23 — Production on for the real accounts; protection request-shape defect (ninth)

Production switched on by Chris for Robinson-AI-Systems and christcr2012. Live commit 0d268b4.

Real-account results (production mode):
- github-mcp is on the protected-resources list (pull-request routine only): `github_repo_update_settings` is refused there by design, so "delete head branches after merge" stays an owner click (checklist). Branch deletion is allowed: five finished branches were deleted (four fully merged, one redundant and recoverable at eec3aef); branches holding unmerged work were left.
- GitHub Pro on christcr2012: a private scratch repository (christcr2012/rtc-pro-accept-oct23) reads branch protection and rulesets without the plan refusal.
- Defect 9: `github_protection_set` sent both `contexts` and `checks` in required_status_checks. Real GitHub answers HTTP 422 ("More than one subschema in oneOf matched") for any request containing both, even when both lists are empty. The pinned description marks `contexts` as required, which is why the fake GitHub in tests accepted it. The tool now sends only the app-bound `checks`; the test checker has one documented exception and rejects requests that send both. Also: `github_protection_get` on a private repository in a free organization now says plainly that protection is not available on that plan.
- Not yet re-run on the real account: the protection set/readback/remove cycle and the ruleset cycle on the Pro repository, until this fix is released (the owner-authorised early-release window ended 06:00 MST; the daily job ships it).
