# ROADMAP — ideas not being built now

## Owner-approved completion expansion (2026-10-18): PUBLIC-SCALE, NOT PUBLISHED

The owner explicitly requires GitHub MCP to support **both mobile and desktop** and to be **architected and verified for potential permitted multi-user scale**, while **all plugins and public enrollment stay PRIVATE** until production readiness and a separate owner publication decision. This is a binding completion requirement, not permission to expose the existing global-admin single-owner setup to outside users. The indexed APPROVED (PUB-1..PUB-4) and publication-BLOCKED (PUB-5) security-first architecture and ordered PUB-1 through PUB-5 workstreams are in [PUBLIC-SCALE](designs/PUBLIC-SCALE.md). Before any implementation, write full PUB cards/acceptance into the work index and commit the prescribed plan, preserve all existing 57 original acceptance rows and developer $0/release policies. This cross-product expansion does not make original source-only tests or the new design a real-world acceptance pass. Neither the desktop direct plugin nor the Sites mobile candidate has passed dual-device acceptance.



Not approved scope. An item moves into a design only with Chris's approval (a dated DECISIONS entry). The usual signal
for hand-building something is repeated `github_api_*` / `github_graphql_*` calls for it in the change log.

- **Self-hosted and larger runners** (`github_runner_*`): hosted runners are spend; reached by the universal tools
  meanwhile (classified as spend).
- **Merge queue** tools: Chris merges with merge commits at the exact head and does not use a merge queue.
- **Copilot coding agent, Copilot review requests, Copilot Spaces, premium-request reports** as hand-built tools, if Chris
  returns to Copilot (cancelled 2026-10-09). Seat billing tools exist already (O-4).
- **Organization issue types, issue fields, autolinks, interaction limits, SBOM and attestations, migrations, Classroom**
  as hand-built tools.
- **GitHub Models:** retired July 30, 2026 according to [GitHub](https://docs.github.com/en/github-models); no new catalog/inference tools planned. This supersedes the historical D1 “belongs with Hub model servers” exclusion.
- **Enterprise features and maximum authority:** moved into approved [CAP-1..CAP-5](designs/MAXIMUM-AUTHORITY.md). A developer account lacking Enterprise does not exclude Enterprise users from the product. Provider plan/role/credential constraints are operation-specific.
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

- Show a server-generated secret value once on the one-time-secret page when Chris asks (G-3 follow-up; today a generated value is never visible).


**2026-10-16:** the items in this file that Batch Y now plans (self-hosted/larger runners, merge queue, Copilot agent and Spaces, org issue types and fields, autolinks, interaction limits, SBOM/attestations, migrations) are scheduled in `docs/designs/BATCH-Y.md`; money-related ones wait for IN-16.

## Backlog carried from CAP-4 closeout (2026-10-22)

Not scheduled; each is built as a whole outcome only when an owner workflow asks: packages/registry streaming; credential
administration beyond SAML revocation; remaining GitHub App lifecycle routes (suspend/unsuspend, installation listing);
curated tools for individual GraphQL mutations; enterprise audit/SCIM/IP policy once an enterprise principal exists.
