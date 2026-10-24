# End-user authority audit — 2026-10-24 (AUTH-1)

**Question.** Can a properly delegated end user's assistant do every action GitHub allows — paid, production, destructive and
security-sensitive — with honest warnings and the user's own optional limits, while the *building* agents' "no spending, no live
changes" rules stay in the repository process and are never turned into product refusals? (Owner decision 2026-10-16,
`docs/END-USER-AUTHORITY.md`.)

**Answer: yes.** All six open items in that document are already true on `main`; nothing in the product refuses a user because of a
developer-only rule. Two small wording/proof gaps were closed in this PR (below). Numbers come from `node scripts/authority-audit.mjs`
(read-only; run it again to check this report).

## The six items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | A database default of $0 treated as a product-wide refusal | **Done.** The old default is not a user choice: only an explicitly saved limit (`spend_limit_explicit`) or a positive one counts. | `src/tools/spend-guard.js` (`spendStatus`); `tests/unit/spend-guard.test.js` "does not mistake the old developer default $0 for an end-user selected restriction" |
| 2 | Every paid change with a non-computable price rejected | **Done.** Unknown price is its own state (`spendUnknown`): the preview says "COST UNKNOWN - metered charges can continue without a guaranteed maximum", real execution needs `confirm`, and it is journalled. | `src/core/write.js` (`spendUnknown`, mark text); `tests/unit/spend-guard.test.js` "user delegation versus service-pass limits" |
| 3 | Universal routes blocked paid operations | **Done.** Only 54 reviewed cost-free routes are classed free; every other write is *unknown cost → warn + confirm*, never a ban. The specialised tools reach the paid operations directly. | `src/github/spend-classes.js`; `tests/unit/spend-classes.test.js` |
| 4 | Y-9d: Sponsors, hosted runners, Copilot policies/seats, agent tasks guided-only | **Done.** `github_sponsor_set`, `github_hosted_runner_create`, `github_hosted_runner_scale_up`, `github_copilot_add_seats`, `github_copilot_team_seats`, `github_copilot_agent_task_start` are real writes. | the table below; `tests/unit/y9-sponsors-write-contract.test.js`, `y9-write-contract.test.js`, `runners-limits.test.js` |
| 5 | Older areas (billing, Codespaces, security, owner admin, readback-only guides) | **Done, with 13 honest exceptions.** Billing budgets, Codespaces and security features are real writes. 13 dashboard settings are provider-UI-only; for 12 GitHub offers no API at all (checked against the pinned REST and GraphQL descriptions). One entry was stale and is corrected here (project workflows). Buying Marketplace apps is browser-only on GitHub's side. | `src/data/dashboard-map.js`; `node scripts/openapi-find.mjs`, `node scripts/graphql-find.mjs` |
| 6 | Tests that prove both sides | **Done.** New `tests/unit/end-user-authority.test.js` runs the same four checks over *every* money-capable tool in the registry (see below). (d) double charge: write-contract check 4, the same call within 10 minutes sends no second request. (e) provider state verified after dispatch: check 5, read-back and `confirmed: false` on mismatch. | `test/helpers/write-contract.js`; `docs/designs/BATCH-B.md` §3 |

For (6a), "developers cannot spend or change live state without separate authorization": production is off by default and needs the
owner's second step (`productionEnabledGate`), the fake-GitHub test suite never uses real credentials (`scripts/check-secrets.mjs`,
AGENTS.md hard limits), and no agent sets `confirm: true` on a paid write against a real account. That rule is process, and it stays
in `AGENTS.md` and `docs/OWNER-CHECKLIST.md`, not in the tools.

## Tools that can cost money (21 of 463)
Each is a real write, always asks for confirmation, shows the price line (or "cost unknown"), respects the user's own limit if they
set one (an explicit limit refuses unknown future charges, because they cannot be proven to fit), and respects a delegation pass
that has no money allowance.

| tool | area | credential | production | widens access | changes GitHub | what it does | today | fix needed |
|---|---|---|---|---|---|---|---|---|
| `github_actions_set_limits` | actions | I | never | no | yes | Actions storage/retention and OIDC limits; lowering is free, raising can add storage cost | performs after preview + confirm | no |
| `github_security_code_scanning_default_setup` | security | I | always | no | yes | turns on code scanning (paid on private repositories) | performs after preview + confirm | no |
| `github_security_config_save` | security | I | when-target | no | yes | organization security configuration (paid features for private repositories) | performs after preview + confirm | no |
| `github_security_config_attach` | security | I | always | no | yes | applies a security configuration to repositories | performs after preview + confirm | no |
| `github_security_config_default` | security | I | always | no | yes | makes a configuration the default for new repositories | performs after preview + confirm | no |
| `github_security_set_feature` | security | I | always | no | yes | turns repository security features on or off (some paid) | performs after preview + confirm | no |
| `github_billing_delete_budget` | billing | I | always | no | yes | removes a spending budget | performs after preview + confirm | no |
| `github_codespace_set_org_access` | codespace | I | always | yes | yes | lets members use organization-paid Codespaces | performs after preview + confirm | no |
| `github_billing_save_budget` | billing | I | always | no | yes | creates or changes a spending budget | performs after preview + confirm | no |
| `github_copilot_add_seats` | copilot | I | always | yes | yes | assigns paid Copilot seats | performs after preview + confirm | no |
| `github_codespace_create` | codespace | U | always | no | yes | creates a Codespace (billed by use) | performs after preview + confirm | no |
| `github_codespace_set_state` | codespace | U | when-target | no | yes | starts or stops a Codespace | performs after preview + confirm | no |
| `github_copilot_team_seats` | copilot | I | always | yes | yes | assigns Copilot seats to a whole team | performs after preview + confirm | no |
| `github_sponsor_set` | billing | U | always | yes | yes | starts or changes a GitHub Sponsors sponsorship | performs after preview + confirm | no |
| `github_hosted_runner_create` | actions | I | always | no | yes | creates a GitHub-hosted (larger) runner, billed by use | performs after preview + confirm | no |
| `github_hosted_runner_scale_up` | actions | I | always | no | yes | raises a hosted runner's size or count | performs after preview + confirm | no |
| `github_copilot_agent_task_start` | copilot | U | always | no | yes | starts a Copilot cloud-agent task (metered) | performs after preview + confirm | no |
| `github_api_write` | universal | I,U,P | when-target | yes | yes | any other GitHub REST write; unreviewed routes count as unknown cost | performs after preview + confirm | no |
| `github_enterprise_security_config_save` | enterprise | M | always | no | yes | enterprise-wide security configuration (needs the master token) | performs after preview + confirm | no |
| `github_enterprise_security_config_apply` | enterprise | M | always | no | yes | applies an enterprise configuration | performs after preview + confirm | no |
| `github_enterprise_policy_set` | enterprise | M | always | yes | yes | enterprise policies (needs the master token) | performs after preview + confirm | no |

New proof: `tests/unit/end-user-authority.test.js`. For each of these tools it checks (a) no user limit + unknown price → plain warning
"No maximum future charge" and confirmation, never a refusal; (b) the user's own limit set → unknown or over-limit charges refused;
(c) a pass with no money allowance → refused.

## Production and destructive tools (summary)
- 110 tools are production-class "always"; 164 carry the destructive hint. All are real actions: they preview, then need
  `confirm`, then read back. Production targets also need a production connection (owner step), protected resources need the
  right level, and access-widening or people-notifying actions name the people first. These are the *user's* safety controls and
  stay.

## Provider-UI-only settings (the 13 exceptions)
Wiki first page, profile and organization pictures, repository social preview, profile pins, profile README toggle, contribution
visibility, recovery codes, project workflows/charts, discussion categories and polls, organization announcement banner, revoking a
leaked credential by value, and the retired tag-protection rules. GitHub offers no API for these (checked with
`scripts/openapi-find.mjs` and the GraphQL mutation list). Each has exact click-by-click steps and, where GitHub can be read, a
read-back check.
One correction: "project workflows" was described as having no API at all. GitHub does have `deleteProjectV2Workflow` (reachable
through `github_graphql_write`) and project views (`github_project_view_save`); only creating or editing workflows and charts is
browser-only. The guide text now says so.

## What stays the same
Credential separation, provider refusals, user-chosen caps and passes, revocation, the confirmation and journal rules, and the
developers' no-spend / no-live-test rules in `AGENTS.md`.
