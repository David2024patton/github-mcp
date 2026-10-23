# Go-live checklist — everything that must be switched on before this server changes production

Written for Chris (not a developer). Rule: everything is built and tested against a **fake GitHub** and, for real-account
tests, a **scratch organization**; anything that can change your real `main` branches, releases, settings, access or
spending is **off** until you complete the step here. "Production" means: a repository's default branch and protected
branches, releases and tags, repository and organization settings, rules, webhooks, production environments, members
and access (`docs/designs/BATCH-B.md` B2). Tick a box only after the "how you know it worked" check is done. Every PR that
adds a switch adds a line here.

Legend: **Owner** = only Chris · **Agent** = Claude can do it once you say go.

## 1. The server itself

| Done | Item | Where / how | Today | How you know it worked |
|---|---|---|---|---|
| [x] | Vercel project `github-mcp` and own Neon database created on existing paid plans (IN-02) | Vercel / Neon | READY; 27 tables created by `initSchema()` (20 were live on 2026-10-12) | Live production deployment; `/` now rewrites to the landing function (re-verify live) |
| [x] | Node 24.x runtime | Vercel project / package engines | Deployed | Vercel deployment metadata |
| [x] | `DATABASE_URL` for isolated Neon database only (IN-02) | Vercel production variables | Encrypted and configured | Application tables in dedicated DB (27 in code; 20 verified live on 2026-10-12) |
| [x] | `PUBLIC_BASE_URL` configured to the canonical HTTPS origin | Vercel production variables | Set | Live OAuth issuer matches domain |
| [x] | `ADMIN_PASSPHRASE` and `TOKEN_ENCRYPTION_KEY` set (IN-03) | Vercel production variables | Both configured; owner private backup unverified | App credentials are encrypted; no casual encryption-key rotation |
| [ ] | Repository settings for this repo: ruleset on `main` requiring `ci`, merge commits, secret scanning and push protection on (IN-01) | github.com (Owner) or, ask Claude (`github_workflow_repo_health`, with your confirm) | Not set | `github_workflow_repo_health` on `Robinson-AI-Systems/github-mcp` shows all ok |

## 2. Signing in to GitHub, per account

Per-account onboarding for `Robinson-AI-Systems` and `christcr2012` is still pending. The isolated scratch Organization has completed its custom App owner setup (IN-06).

| Done | Item | Where / how | Today | How you know it worked |
|---|---|---|---|---|
| [ ] | Credential type chosen (IN-04): two private GitHub Apps (recommended) or one fine-grained token per account | Answer in chat | Not decided | — |
| [ ] | "Create the GitHub App" clicked for the account (manifest flow; GitHub hands the keys straight to the server) | Server setup page → GitHub (Owner) | Not created | `github_list_accounts` shows the App |
| [ ] | App installed on the account with the repositories you chose (IN-05) | Setup page → "Install" (Owner) | Not installed | `github_check_permissions` shows every area ok |
| [ ] | "Authorize as me" done (user authorization, for personal settings and a few user-only actions) | Setup page (Owner) | Not done | `github_whoami` shows your user and the refresh date |
| [ ] | Optional: notifications token (classic, `notifications` scope only) (IN-11) | GitHub → Developer settings → Tokens (classic), then paste on the setup page (Owner) | Not added | `github_notify_list` answers |
| [ ] | Connector added in Claude, **preview** mode | claude.ai → Settings → Connectors (Owner) | Not added | Claude answers "which GitHub accounts am I connected to?" correctly |
| [ ] | Default settings confirmed: protected repositories (IN-08), production names (IN-12), own people (IN-13), user-selected spend cap (unset unless explicitly configured), developer's independent $0 test budget, pass defaults (IN-10) | Answer in chat; edits that widen anything happen only on the setup page | Recommended defaults | `github_list_protected_resources`, `github_whoami` show them |

## 3. Production, per account

| Done | Item | Where / how | Today | How you know it worked |
|---|---|---|---|---|
| [ ] | Production enabled for the account (IN-07): ask the agent, then re-enter your passphrase on the setup page within 10 minutes | Owner | **`robinson-ai-scratch` ON as of Oct 18; normal owner accounts not enrolled.** Existing custom ChatGPT login still PREVIEW pending reviewed mode-correction release and owner confirmation. | Account switch ON and **genuine session** reports PRODUCTION/full for selected account; these are separate checks |
| [ ] | First production action done with you watching: merge one small green PR at its exact head | Owner + Agent | Not done | The PR shows merged with a merge commit; `github_recent_changes` lists it as PRODUCTION |
| [ ] | Choose an **optional end-user monthly spend cap**, if desired; even $0 is an explicit user selection (IN-09 clarified by END-USER-AUTHORITY.md). Paid provider tools are available to authorized end-user agents without inheriting our developer's $0 budget | Setup page (Owner) | Legacy account default zero is treated as **not configured** until you set a user cap | `github_whoami` displays `spend_limit: not configured` or your explicit cap |
| [ ] | Approve the new GitHub App permissions (IN-15): `packages`, `merge_queues`, `artifact_metadata`, `organization_self_hosted_runners`, `organization_events`; for Y-9d also upgrade **Organization Administration (write)**, **Copilot agent settings (write)**, **Copilot content exclusion (write)**, and **Agent tasks (read/write)** for the required App user authorization where GitHub offers it | github.com → Settings → Developer settings → GitHub Apps → the App → Permissions & events, then accept on each installation (`github_where_is_setting` "app permissions" lists the steps) | Scratch installation accepted the available grants on 2026-10-17; real-account installations remain separate. Existing Apps never gain permissions by themselves | `github_check_permissions` reports zero missing App grants after deployment, with Packages separately capability-unverified; actual operations still require supported credentials and provider/package access |

## 4. Developer tools

| Done | Item | Where / how | Today | How you know it worked |
|---|---|---|---|---|
| [x] | Owner completed scratch Organization, custom GitHub App and scratch designation (IN-06 setup stage) | Protected setup page | Active/all repositories; `is_scratch=true`; **production ON Oct 18 by separate owner passphrase**; product spend cap not configured, autonomous developer spend $0. Real custom connection remains PREVIEW until owner-authorized mode upgrade following next reviewed release. | Real server account status + separate connection `github_whoami` check; scratch writes/cleanup still require distinct approvals |
| [ ] | Custom OAuth connection and connected scratch read/write/cleanup acceptance | Custom `/api/mcp` preview-only connection | OAuth connected and scratch reads verified (Oct 15); V-2 cleanup built; live write/cleanup acceptance pending | `github_list_accounts` says scratch true; after cleanup is safe, verify isolated run-owned seed and exact-object cleanup |

## 4b. Private public-scale and dual-platform release gate (owner decision 2026-10-18)

**Do not publish or enroll the public yet.** The standalone current service still has global owner passphrase/account configuration and is not a publicly usable multi-tenant service. Requirements, implementation order and test contract: `docs/designs/PUBLIC-SCALE.md`.

| Done | Item | Who / where | How to verify |
|---|---|---|---|
| [ ] | Complete the **55 required** original provider real-world acceptance rows, independently reviewing any legitimate provider exception; preserve two historical optional Hub-owned route checks | Implementing agent and owner | The ledger retains 57 historical rows (14 passed, 28 pending, 15 blocked), but only `GITHUB-RTC-RELAY` and `GITHUB-RTC-SANDBOX` are `completionGate:false`. Direct provider RTC conformance remains required; no optional test is called passed without real evidence. |
| [ ] | Complete secure PUB-1/PUB-2 tenant identity + OAuth/credentials isolation and private allowlisted pilot | Developer, zero spend | Reviewed private PUB-1 source in PR #263 passes real PostgreSQL A/B isolation suite at corrected head (final exact-head merge/release still mandatory); **no new public route**. PUB-2 provider-issued identities and scoped login/read/write proof remain separately unimplemented. Do NOT open enrollment or migrate real owner tokens. |
| [ ] | Complete PUB-3 rate/abuse/reliability/monitoring controls without unapproved spending | Developer | PUB-3 source branch adds PostgreSQL atomic quotas and bounded retention; **tests, incident cleanup, CI/review/merge and real private pilot/load evidence still pending**. No paid capacity or public signup permitted. |
| [ ] | Prove genuine Android/iOS AND desktop/web ChatGPT connections separately using private plugins and service-owned OAuth and full safeguards | Owner + agent | Two real `github_whoami` scope/mode readbacks and independently approved disposable provider read/write/revoke |
| [ ] | Complete privacy, support, credentials revocation, retention, incident handling and public developer/business verification | Owner decision with evidence | Legal/operations readiness checklist and policy acceptance |
| [ ] | **Confirm third-party distribution eligibility before any public Directory work (IN-18)** | Owner + OpenAI/GitHub policy/authorization, BEFORE public implementation | Current directory policy says unofficial third-party connectors are not approvable; stop Directory submission unless written authorization and applicable eligibility are established. PRIVATE/workspace distribution remains the fallback. |
| [ ] | **Owner separately approves any eligible public discoverability, public GitHub App installation and outside-user enrollment** | Owner only, LAST | Explicit eligibility proof plus fresh owner publication decision after all other gates; current PRIVATE state remains until then |

## 5. Projects (one section per profiled project)

### Appliance Desk

Run `github_workflow_app_readiness` for `appliance-desk` and work through what it lists. The full list with
explanations is `docs/APP-NEEDS-APPLIANCE-DESK.md`; the app's own checklist stays the authority for its launch.

| Done | Item | Today |
|---|---|---|
| [ ] | `main` ruleset requires `ci` only (no Preview deployment, no Copilot review) — Appliance Desk IN-67 | Done 2026-10-09 (Chris) |
| [ ] | `main` blocks force pushes and deletion | Not verified |
| [ ] | Secret scanning and push protection on | Not verified (an owner step in the app's ARCHITECTURE) |
| [ ] | Fork pull request workflows need approval for all outside contributors | Not verified |
| [ ] | `live` branch exists and only `release.yml` moves it; Vercel tracks `live` (Appliance Desk IN-68, a Vercel setting) | `live` not created yet |
| [ ] | No repository secrets; CI keeps `contents: read` and no `pull_request_target` | Matches (2026-10-10) |

### The Robinson servers' repositories

| Done | Item | Today |
|---|---|---|
| [ ] | Each repo (`github-mcp`, `stripe-mcp`, `google-workspace-mcp`, `robinsons-toolkit-hub`, `vercel-mcp`, `neon-mcp`) has a `main` ruleset requiring `ci`, merge commits, secret scanning and push protection | Not verified |
| [ ] | All of them are `pr-only` protected resources in this server (IN-08) | Built (B-3, #19); seeded default per IN-08, owner confirms the list on the setup page |

## Daily deployment cost controls (2026-10-12)

- [ ] Before linking or activating this server, verify that GitHub has both main and live; initialize live from main only if absent and verify both SHA references.
- [ ] In each linked Vercel project's Production environment, set Branch Tracking to live and read it back. Disable automatic Preview deployments and verify that setting. No Vercel project setting is implied by vercel.json.
- [ ] Confirm exact-head existing application CI and release-policy pass; development PRs never require a paid Vercel preview. Apply live-only Git rules to any nested Vercel root configuration.
- [ ] Verify the first scheduled daily promotion and its live-promotion date tag; validate the resulting production deployment from live. Keep all existing access, spending and activation gates.

## Simple public connect switches (PUB-6, all default off)
- [ ] `GITHUB_PUBLIC_CONNECT=enabled` turns the flow on (needs `GITHUB_PRIVATE_TENANT_PILOT=enabled`, `GITHUB_PILOT_APP_ID`, production deployment). Unset it to stop new sign-ins at once; existing connections keep working until revoked.
- [ ] Caps (stored as environment settings, sensible defaults): `GITHUB_PUBLIC_MAX_CLIENTS` (500), `GITHUB_PUBLIC_MAX_OPEN_FLOWS` (200), `GITHUB_PUBLIC_MAX_TENANTS` (25). Raise gradually.
- [ ] GitHub App settings: "Request user authorization (OAuth) during installation" must be OFF and the Setup URL must be `/api/github/setup`; the App must be installable by the people being invited.
