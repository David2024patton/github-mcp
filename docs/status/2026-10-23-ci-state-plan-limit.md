Fix found by real-account acceptance: on a private repository whose GitHub plan has neither branch protection nor rulesets, GitHub answers
403 "Upgrade to GitHub Pro or make this repository public to enable this feature." for the protection and rules reads. The PR-status, CI and
merge-when-green logic treated that as "required checks unknown", so a PR whose only check passed could never be reported green or merged
through the workflow tools. Now that one exact plan-limit answer means "no rules can exist on this plan": all checks that exist must still pass
(pending, failing or none-yet is still not green), and the result carries a `plan_limits` note saying so. Any other 403 or failure stays
"unknown, never green". Tests: tests/unit/ci-state-plan-limit.test.js.
