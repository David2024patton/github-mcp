# GitHub App permission review — 2026-10-24 (LAUNCH-1 part C)

**What this is.** The Robinson GitHub App asks every person who installs it for a set of GitHub permissions. This reviews that list
(`src/github/app-manifest.js`, 27 repository permissions and 20 organization permissions), says which kinds of tools need each, and
proposes the smallest set. **Changing the live App's permissions is an owner step** (`docs/OWNER-CHECKLIST.md`): GitHub makes every
installer approve the change again, so it should be done once, deliberately, not casually.

**How the "needed by" column was made.** Tool areas come from the tool catalog (463 tools in 55 areas, `docs/TOOL-CATALOG.md`).
GitHub's vendored API description does not say which permission an operation needs, so each row below pairs a permission with the
tool areas that, by GitHub's own permission documentation, use it. It is a reviewed mapping, not a machine proof. A permission is
only exercised when a person's assistant uses a tool in that area on an account where the App has it.

**Account (user-level) permissions** are not in the manifest and stay out (decision 2026-10-16). Personal items such as emails, SSH keys
and personal Codespaces secrets go through the optional **master token** (GOD-2), which the person types on a protected page. Nothing
here widens that.

## Repository permissions
| Permission | Level | Needed by (tool areas) | Risk | Proposal |
|---|---|---|---|---|
| metadata | read | every repository tool | low | keep (GitHub always grants it) |
| contents | write | content, commit, git, branch, tag, release, wiki | medium | keep |
| pull_requests | write | pr, review | medium | keep |
| issues | write | issue, label, milestone | medium | keep |
| discussions | write | discussion | low | keep |
| checks | write | check | low | keep |
| statuses | write | status, pr merge gating | low | keep |
| actions | write | actions, job, artifact, cache | medium | keep |
| actions_variables | write | variable | low | keep |
| workflows | write | workflow (changing workflow files) | **high** | keep; changes already need confirmation and a production connection |
| deployments | write | deployments, deploy | medium | keep |
| environments | write | env | medium | keep |
| pages | write | pages | medium | keep |
| packages | write | package | medium | keep |
| merge_queues | write | pr merge queue | low | keep |
| artifact_metadata | write | artifact | low | keep |
| attestations | read | security (attestation reads) | low | keep |
| administration | write | repo settings, protection, ruleset, collaborator, deploykey, admin | **high** | keep; repository admin is the product's point; all such changes are production-gated |
| repository_hooks | write | webhook | **high** | keep (webhook changes are gated) |
| repository_custom_properties | write | repo properties | low | keep |
| secrets | write | secret (values never pass through a tool) | **high** | keep; values are typed on the setup page or server-generated |
| dependabot_secrets | write | secret | **high** | keep, same rule |
| codespaces | write | codespace | medium | keep |
| codespaces_secrets | write | secret, codespace | **high** | keep, same rule |
| secret_scanning_alerts | write | security | medium | keep |
| security_events | write | security (code scanning, advisories) | medium | keep |
| vulnerability_alerts | write | security (Dependabot alerts) | low | keep |

## Organization permissions
| Permission | Level | Needed by (tool areas) | Risk | Proposal |
|---|---|---|---|---|
| members | write | org members, team, role | **high** | keep; adding or removing people is gated |
| organization_administration | write | org settings, billing-adjacent reads | **high** | keep, gated |
| organization_custom_org_roles | read | role | low | keep |
| organization_custom_properties | write | org properties | low | keep |
| organization_hooks | write | webhook (org level) | **high** | keep, gated |
| organization_secrets | write | secret (org level) | **high** | keep, same rule as repository secrets |
| organization_dependabot_secrets | write | secret | **high** | keep |
| organization_actions_variables | write | variable | low | keep |
| organization_codespaces | write | codespace | medium | keep |
| organization_codespaces_secrets | write | secret | **high** | keep |
| organization_codespaces_settings | write | codespace | medium | keep |
| organization_copilot_seat_management | write | copilot (paid seats) | **high** | keep; seat changes are spend-gated and always show the price first |
| organization_copilot_agent_settings | write | copilot | medium | keep |
| organization_personal_access_token_requests | write | tokenpolicy | **high** | keep, gated |
| organization_personal_access_tokens | write | tokenpolicy | **high** | keep, gated |
| organization_plan | read | billing, org overview | low | keep |
| organization_projects | write | project | low | keep |
| organization_user_blocking | write | org | medium | keep |
| organization_self_hosted_runners | write | actions (runners) | medium | keep |
| organization_events | read | org activity feed | low | keep |

## Findings
1. **No permission is unused by the tool catalog.** Every row maps to at least one tool area, so there is nothing to remove without
   removing a capability. The product's rule (owner decision 2026-10-16, `docs/END-USER-AUTHORITY.md`) is to enable every feasible
   action within the person's delegated authority, so the full set is the intended request.
2. **The risk is in the high-risk rows, and the protection is in the server, not the permission.** Each high row is reached only through
   tools that preview first, need confirmation, and (for production changes) need a production connection; secret values never pass
   through a tool. Read-only connections never use a write permission at all.
3. **A narrower option for cautious people already exists:** the "read-only" choice at sign-in and in My connection. It does not change
   the App's permissions but means this server never makes a change for that person.
4. **Possible future trim (not recommended now):** if the product is ever offered only for personal accounts, every organization
   permission could be dropped from the public App, which would also remove the organization approval step for most people. That is a
   product decision (it removes organization support), so it is left to the owner. See the owner row.

## What the owner decides (one row in `docs/OWNER-CHECKLIST.md`)
Keep the full set (recommended), or ask for a smaller App. If a smaller set is chosen, the change is made in the App's settings on
GitHub, and every installer is asked to approve it again.
