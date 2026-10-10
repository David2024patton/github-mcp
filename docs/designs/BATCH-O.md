# Design — Batch O: Owner and administration (contract §11)

Status: **DRAFT — awaiting Chris's approval (IN-00)**. Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` →
Batch O. Cards O-1 … O-7. Depends on Batches B and H. Tool list: `docs/TOOL-CATALOG.md` sections Owner: … and
Owner and administration: guided settings; `github_admin_overview`. Research: `docs/audits/2026-10-10-research.md` §9.

For Chris as the **owner** of his GitHub organization and personal account, not only as a developer: who is in the
organization and with what access, security, apps and tokens, what GitHub costs him and what could raise it, his personal
settings — every setting either a real tool or a guided setting with structured steps and read-back.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| O1 | The organization's plan is readable (`GET /orgs/{org}` `plan.name`, needs `plan` read) and decides plan-dependent items (audit log, SSO, custom repository roles: Enterprise Cloud) | fixture + `github_admin_overview` on the real account in X-2 |
| O2 | `two_factor_requirement_enabled` is readable but **not** writable (absent from `PATCH /orgs/{org}`) | read the `PATCH /orgs/{org}` request schema |
| O3 | Enhanced billing: `GET /organizations/{org}/settings/billing/usage`, `…/usage/summary`, `…/premium_request/usage`, budgets CRUD; user `GET /users/{username}/settings/billing/usage` (user token) | `node scripts/openapi-find.mjs "billing usage"` / `"budget"` |
| O4 | Prices in `src/github/prices.js` still match GitHub's pages: Copilot Business $19/seat/month prorated; Codespaces compute $0.18/$0.36/$0.72/$1.44/$2.88 per hour for 2/4/8/16/32 cores and $0.07/GB-month storage; **Secret Protection and Code Security per-active-committer prices (not yet verified — read GitHub's pricing page and record)** | https://docs.github.com/en/billing (product pages); record URLs and the date in the PR |
| O5 | Fine-grained token requests/approvals (`/orgs/{org}/personal-access-token-requests`, `…/personal-access-tokens`) work with the App's installation token | availability data (research §4); fixture |
| O6 | Copilot seat endpoints (`/orgs/{org}/copilot/billing[/seats\|/selected_users\|/selected_teams]`) | `node scripts/openapi-find.mjs "copilot seat"` |

## 1. Decisions

**O1. Admin overview** (`github_admin_overview(account)`), one call, each item `ok` / `needs_attention` (why) /
`not_readable` (why, e.g. "needs Chris's user authorization") / `not_available_on_plan` (plan name; dashboard link):
- Organization: profile complete, plan and seats, default repository permission, who may create repositories/Pages/forks,
  web commit sign-off, **2FA required** and members without 2FA, SSO (plan), audit log (plan; Enterprise Cloud only — link
  to the web audit log otherwise), outside collaborators, pending/failed invitations, owners count.
- Security: secret scanning and push protection on every repository (and the org default for new repos), Dependabot
  alerts/updates, open alerts by severity, deploy keys with write access, rulesets on default branches, Actions default
  token permission (write = attention).
- Apps and tokens: installed Apps with permissions, fine-grained token requests waiting, tokens with org access and
  expiry, OAuth app policy (guided).
- Money: this month's usage by product in dollars, budgets and how close each is, Copilot seats and inactive seats,
  Codespaces billing access, Marketplace purchases (user token).
- Personal account (user token): emails verified/primary visibility, SSH/GPG keys count and age, 2FA (read from
  `GET /user` `two_factor_authentication`), blocked users, pending repository invitations.
- This server: credentials present and expiry (user token refresh date), production enabled per account, spend limit,
  protected resources.

**O2. Guided settings for everything with no API** (contract §11). `github_where_is_setting(query)` returns
`{ setting, url, steps: [{ n, action, target, value? }], expected, verifyWith?: { tool, args, field, equals } }`.
The dashboard map (`src/data/dashboard-map.js`) covers **every settings page** of a repository (General, Collaborators and
teams, Moderation, Branches, Tags, Rules, Actions — General/Runners, Models, Webhooks, Copilot, Environments, Codespaces,
Pages, Advanced Security, Deploy keys, Secrets and variables — Actions/Codespaces/Dependabot, GitHub Apps, Email
notifications, Autolink references, Custom properties), an organization (General, Policies, Billing and licensing — and
budgets, Organization roles, Repository roles, Member privileges, Import/Export, Moderation, Repository defaults, topics,
custom properties, rulesets, Codespaces, Planning, Copilot, Actions, Models, Webhooks, Discussions, Packages, Pages,
Hosted compute networking, Authentication security, Advanced Security, Deploy keys, Verified domains, Secrets and
variables, GitHub Apps, OAuth app policy, Personal access tokens — settings/active/pending, Scheduled reminders,
Developer settings) and the personal account (Public profile, Account, Appearance, Accessibility, Notifications, Billing
and licensing, Emails, Password and authentication, Sessions, SSH and GPG keys, Organizations, Moderation, Repositories,
Codespaces, Packages, Copilot, Pages, Saved replies, Code security, Applications, Scheduled reminders, Security log,
Sponsorship log, Developer settings). O-1 walks GitHub's settings pages once in a browser (or from GitHub's docs when no
browser is available) and records the date. Account-closing and org deletion are steps only.
`github_admin_check_setting` reads a setting back after Chris changed it; a guided setting is never reported done unless read
back or Chris says so.

**O3. Members and access are owner actions** (contract §11): every membership, role, team, outside-collaborator and token
approval change needs `confirm` and is access-widening where it widens (B-4). `github_org_invite_member` notifies (M).
`github_org_remove_member` explains what the person loses (private repositories, team access, Copilot seat).

**O4. Spend is explicit** (B-4): `github_copilot_add_seats`, `github_codespace_create`, starting a codespace, `github_codespace_set_org_access`
(org pays), raising or removing a budget, paid security features — dollar estimate, confirm, monthly spend limit
(default $0). Lowering spend (removing seats, stopping codespaces, adding a budget) never needs the spend limit.
Plan changes and Marketplace purchases have no API: guided only, and buying is an implementer hard limit.

**O5. Personal account tools need the user token** (`U`); without it they answer "authorize the App as you on the setup
page" with the link. Emails: adding one sends a verification email to that address (M, confirm). Keys: public keys only;
a private key pasted by mistake is refused without echo (as H4).

**O6. Notifications need the optional classic token** (`K`, IN-11); without it `github_notify_*` explain why GitHub offers no
other way and point at the setup page.

**O7. Plan-dependent items are reported, not faked:** audit log, SSO, custom repository roles, IP allow lists, private
Pages, environment protection on private repos — `github_role_list` and the overview say "not available on <plan>".

## 2. Schema

None new (uses `gh_accounts`, `change_log`). The dashboard map is a data file.

## 3. Operations per tool (main ones)

| Tool | Operation(s) |
|---|---|
| `github_org_get`, `github_org_update_settings` | `GET/PATCH /orgs/{org}` |
| `github_org_list_members`, `github_org_set_member_role`, `github_org_remove_member` | `GET /orgs/{org}/members` (`filter=2fa_disabled`, `role`), `GET/PUT/DELETE /orgs/{org}/memberships/{username}`, `DELETE /orgs/{org}/members/{username}` |
| `github_org_invite_member`, `github_org_list_invitations`, `github_org_cancel_invitation` | `POST/GET /orgs/{org}/invitations`, `GET …/failed_invitations`, `DELETE …/invitations/{id}` |
| `github_org_set_outside_collaborator` | `GET /orgs/{org}/outside_collaborators`, `PUT/DELETE …/{username}` |
| `github_org_set_blocked` | `GET/PUT/DELETE /orgs/{org}/blocks[/{username}]` |
| `github_org_custom_properties` | `GET/PATCH /orgs/{org}/properties/schema`, `PUT/DELETE …/{name}` |
| `github_org_set_immutable_releases` | `GET/PUT /orgs/{org}/settings/immutable-releases[/repositories…]` |
| `github_team_*` | `GET/POST /orgs/{org}/teams`, `GET/PATCH/DELETE …/teams/{slug}`, `…/memberships/{username}`, `…/repos/{owner}/{repo}` |
| `github_role_*` | `GET /orgs/{org}/organization-roles[/{id}/users\|/teams]`, `PUT/DELETE …/organization-roles/users/{username}/{role_id}`, `…/teams/{slug}/{role_id}` |
| `github_billing_*` | `GET /organizations/{org}/settings/billing/usage[/summary]`, `…/premium_request/usage`, `GET/POST/PATCH/DELETE …/budgets[/{id}]`, `GET /users/{username}/settings/billing/usage` (U), `GET /user/marketplace_purchases` (U) |
| `github_copilot_*` | `GET /orgs/{org}/copilot/billing`, `…/seats`, `POST/DELETE …/selected_users`, `…/selected_teams` |
| `github_codespace_*` | `GET /user/codespaces`, `GET /orgs/{org}/codespaces`, `POST /repos/{o}/{r}/codespaces` (U), `POST /user/codespaces/{name}/start\|stop`, `DELETE /user/codespaces/{name}`, `PUT /orgs/{org}/codespaces/access[/selected_users]` |
| `github_app_*` | `GET /orgs/{org}/installations`, `GET /user/installations` (U), `GET /user/installations/{id}/repositories` (U), `PUT/DELETE /user/installations/{id}/repositories/{repository_id}` (U) |
| `github_pat_*` | `GET/POST /orgs/{org}/personal-access-token-requests[/{id}]`, `GET/POST /orgs/{org}/personal-access-tokens[/{id}]` |
| `github_account_*` | `GET/PATCH /user`, `GET/POST/DELETE /user/emails`, `PATCH /user/email/visibility`, `GET/POST/DELETE /user/keys`, `/user/ssh_signing_keys`, `/user/gpg_keys`, `GET/PUT/DELETE /user/blocks/{username}`, `GET/PATCH/DELETE /user/repository_invitations[/{id}]` |
| `github_notify_*` | `GET/PUT /notifications`, `PATCH/DELETE /notifications/threads/{id}`, `PUT/DELETE …/subscription`, `GET/PUT /repos/{o}/{r}/subscription` (K) |
| `github_gist_*` | `GET/POST /gists`, `GET/PATCH/DELETE /gists/{id}` (U) |

## 4. Work units

### O-1 — Admin overview, guided settings, full dashboard map (M, medium effort)
Tools: `github_admin_overview`, `github_admin_list_guided_settings`, `github_admin_check_setting`, `github_admin_review_security`;
`github_where_is_setting` upgraded to the structured format. Tests: each overview item ok / needs_attention /
not_readable / not_available_on_plan on fixtures (Free org, Team org, personal); every map entry has steps and an
expected result; every `verifyWith` points at a real read tool and field; 2FA requirement is guided with a read-back.
### O-2 — Organization and members (M, medium effort)
Tests: invitation needs confirm and shows the role and teams; owner promotion is access-widening; removing a member
lists what they lose; widening default repository permission is access-widening.
### O-3 — Teams and roles (S)
Tests: team repo access before/after; role assignment access-widening; custom repository roles reported per plan.
### O-4 — Billing, budgets, Copilot, Codespaces (M, medium effort)
First step: O4 verification, prices recorded. Tests: usage in dollars with `_display`; seat add at $0 limit refused,
with a limit shows "about $19/month per seat, prorated"; removing a budget is `$`; lowering spend never blocked.
### O-5 — Apps and fine-grained tokens (S)
Tests: removing a repository from this server's own installation refused (`locked`, B-3); token approval access-widening.
### O-6 — Personal account (M)
Tests: every tool says "authorize on the setup page" without a user token; private key pasted refused without echo;
email add notifies (M).
### O-7 — Notifications and gists (S)
Tests: without the classic token → plain explanation; public gist access-widening.

## 5. Stop-and-ask points

1. O4 prices cannot be verified: build the tools with the dollar line "price not verified — check GitHub billing" and
   keep the $0 limit; tell Chris.
2. Any change to who counts as an owner or to the default spend limit (IN-09, IN-13).

## 6. Acceptance mapping

| PLAN Batch O line | Evidence |
|---|---|
| Admin overview well-formed (contract §9/§11) | `tests/unit/admin-overview.test.js` |
| Every dashboard page mapped; structured steps; read-back | `tests/unit/dashboard-map.test.js` |
| Owner changes confirmed and logged; spend guarded | write-contract per tool; `tests/unit/billing.test.js` |

## Amendments

(Dated entries only.)
