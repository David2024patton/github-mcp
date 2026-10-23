# 2026-10-23 — Rulesets and security settings verified on the real scratch repository

Real-account run on `robinson-ai-scratch/rtc-ghaccept-h1-public-oct14` (scratch organization, public fixture), against the deployed revision 610394f. No cost, no access widened; everything restored.

Rulesets:
- `github_ruleset_list` empty -> `github_ruleset_save` create (dry run, confirm): applied, enforcement "evaluate" on a pattern matching no real branch.
- Second `github_ruleset_save` with only `enforcement: disabled`: merged just that field, rules and conditions kept (summary and `github_ruleset_get` readback agree).
- Re-sending the create after it applied is refused ("an existing ruleset already has this name"): no duplicate, though it is a refusal rather than a replay of the first result.
- `github_ruleset_delete` applied; `github_ruleset_list` independently shows none left.

Security settings and alerts:
- `github_security_get_settings` reads the real feature states. `github_security_list_alerts` needs `kind` (here `dependabot`): returns an empty, complete list.
- `github_security_set_feature` private_vulnerability_reporting on (dry run, confirm), readback "enabled" with other features untouched, then off again; the final state equals the starting state.

Not run: paid features (code scanning default setup on private repos, advanced security) and secret-scanning material alerts, which need a plan or a seeded alert.
