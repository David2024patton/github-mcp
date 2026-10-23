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
curated tools with write specifications for the 234 GraphQL mutations the inventory marks `blocked-missing-write-spec` (the universal tool does not cover them); enterprise audit/SCIM/IP policy once an enterprise principal exists.

## Approved by Chris 2026-10-23: public-friendly connection (scheduled before PUB-5, after testing is finished)

Order: finish the remaining acceptance testing first, then this, then PUB-5. Build it as one whole outcome, not slivers.

- **Simple connect flow for anyone:** Connect, Sign in with GitHub, pick the account, Approve. Mode, profile and tool listing default to safe
  choices and move to a settings page. No administrator passphrase for ordinary users. Today's owner form stays for the owner.
  Decided by Chris 2026-10-23: the simple flow is the normal way to connect. Today's owner form (account, mode, profile, tool listing, passphrase)
  becomes development-only: kept for building and testing, not shown to ordinary users, and out of the product's normal path.
- **GitHub App install inside the connect flow:** after "Sign in with GitHub", the server checks which accounts the person has already installed
  the App on; for an account without it, it sends them straight to GitHub's install screen (with "request user authorization during
  installation" so sign-in and install are one step) and returns them to finish connecting. Organizations whose owner must approve the install
  show a plain "waiting for your organization owner" state. Needs the App to be publicly installable (a GitHub App setting), which is a
  distribution step that needs Chris's explicit approval before it is switched on. Today's one-by-one "Create the GitHub App" step stays for the owner and self-hosting.
- **Easy place to add the extra tokens and secrets** that the standard GitHub sign-in cannot reach (for example the package token,
  notifications token, fine-grained tokens): a guided "Unlock more tools" page that says, in plain words, which tools each one opens, how to
  create it on GitHub step by step, accepts it on the protected page only (never through chat or a tool argument), shows what it unlocked,
  and lets the user remove it. Builds on the existing encrypted token vault and CAP-3 enrollment; the no-secret-through-a-tool rule stays.
- Acceptance: a first-time user on a phone connects without help, sees which tools are available and which need an extra token,
  adds one token, and sees those tools unlock; verified on real devices.
