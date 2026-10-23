Second fix from the same real-account finding: branch_get (and therefore branch cleanup) also treated GitHub's free-plan answer
("Upgrade to GitHub Pro or make this repository public to enable this feature.") for rules reads as "rules unreadable", so merged scratch
branches could never be previewed for cleanup. A shared helper (src/github/plan-limit.js) now recognises only that exact 403 message; branch_get
returns `rules: []` plus a `rules_note`, and ci-state uses the same helper. Any other failure stays unknown. Tests: tests/unit/branches.test.js,
tests/unit/ci-state-plan-limit.test.js.
Live evidence before this fix (released 25c80cd): PR status reported green with a plan_limits note; merge_when_green merged a scratch PR at its exact head with
an independent readback; replaying the same merge key refused honestly (PR not open) with no second merge.
