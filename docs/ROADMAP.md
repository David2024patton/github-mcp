# ROADMAP — ideas not being built now

Not approved scope. An item moves into a design only with Chris's approval (a dated DECISIONS entry). The usual signal
for hand-building something is repeated `github_api_*` / `github_graphql_*` calls for it in the change log.

- **Self-hosted and larger runners** (`github_runner_*`): hosted runners are spend; reached by the universal tools
  meanwhile (classified as spend).
- **Merge queue** tools: Chris merges with merge commits at the exact head and does not use a merge queue.
- **Copilot coding agent, Copilot review requests, Copilot Spaces, premium-request reports** as hand-built tools, if Chris
  returns to Copilot (cancelled 2026-10-09). Seat billing tools exist already (O-4).
- **Organization issue types, issue fields, autolinks, interaction limits, SBOM and attestations, migrations, Classroom**
  as hand-built tools.
- **Enterprise features** (audit log API, SAML SSO, IP allow lists, custom repository roles) if an account moves to
  Enterprise Cloud; today they are reported as "not available on your plan".
- **Move a secret from another service into GitHub** (e.g. a Neon connection string or a Vercel token into an Actions
  secret) without it passing through chat: a hub workflow across servers, not built here.
- **Browser-assisted dashboard steps:** for settings GitHub has no API for, an agent with a browser follows
  `github_where_is_setting`'s structured steps while Chris watches; the server then reads back where possible.
- **Move to a newer REST API version** when GitHub publishes one after `2026-03-10` (its own card with a review of
  GitHub's breaking-changes page).
- **Reacting to repository events** (the App subscribing to push, pull request or check events, e.g. to tell Chris when
  CI fails on `main`): the server only handles installation events today.
- **A scheduled GitHub digest** (failing CI on default branches, new alerts, pending invitations, spend) once scheduled
  tasks are in regular use; `github_workflow_weekly_digest` is the on-demand version.
- **Port fixes back** to the Stripe and Workspace servers when a copied contract file is improved here (until the hub's
  `robinson-mcp-core` package exists).
- **More project profiles** (YardSync, Cortiware) when their repositories exist; `github_profile_draft` drafts them.
