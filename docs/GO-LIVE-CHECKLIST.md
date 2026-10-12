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
| [x] | Vercel project `github-mcp` and own Neon database created on existing paid plans (IN-02) | Vercel / Neon | READY and 20 tables verified | Live production deployment; home-page `/` still 404 |
| [x] | Node 24.x runtime | Vercel project / package engines | Deployed | Vercel deployment metadata |
| [x] | `DATABASE_URL` for isolated Neon database only (IN-02) | Vercel production variables | Encrypted and configured | 20 live application tables in dedicated DB |
| [x] | `PUBLIC_BASE_URL` configured to the canonical HTTPS origin | Vercel production variables | Set | Live OAuth issuer matches domain |
| [x] | `ADMIN_PASSPHRASE` and `TOKEN_ENCRYPTION_KEY` set (IN-03) | Vercel production variables | Both configured; owner private backup unverified | App credentials are encrypted; no casual encryption-key rotation |
| [ ] | Repository settings for this repo: ruleset on `main` requiring `ci`, merge commits, secret scanning and push protection on (IN-01) | github.com (Owner) or, once Batch H exists, ask Claude (Agent with your confirm) | Not set | `github_workflow_repo_health` on `Robinson-AI-Systems/github-mcp` shows all ok |

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
| [ ] | Default settings confirmed: protected repositories (IN-08), production names (IN-12), own people (IN-13), spend limit $0 (IN-09), pass defaults (IN-10) | Answer in chat; edits that widen anything happen only on the setup page | Recommended defaults | `github_list_protected_resources`, `github_whoami` show them |

## 3. Production, per account

| Done | Item | Where / how | Today | How you know it worked |
|---|---|---|---|---|
| [ ] | Production enabled for the account (IN-07): ask Claude, then re-enter your passphrase on the setup page within 10 minutes | Owner | Off | A new connection offers "production" for that account |
| [ ] | First production action done with you watching: merge one small green PR at its exact head | Owner + Agent | Not done | The PR shows merged with a merge commit; `github_recent_changes` lists it as PRODUCTION |
| [ ] | Spend limit raised above $0 — **only if you want Claude to add seats or paid features** (IN-09) | Setup page (Owner) | $0 | `github_whoami` shows the new limit |

## 4. Developer tools

| Done | Item | Where / how | Today | How you know it worked |
|---|---|---|---|---|
| [x] | Owner completed scratch Organization, custom GitHub App and scratch designation (IN-06 setup stage) | Protected setup page | Verified active All repositories, 41/41 permissions, scratch ON, production OFF, $0 spend | Neon account + owner audit |
| [ ] | Custom OAuth connection and connected scratch read/write/cleanup acceptance | Custom `/api/mcp` preview-only connection | No OAuth client/token; zero runs/objects; V-2 cleanup not built | `github_list_accounts` says scratch true; after cleanup is safe, verify isolated run-owned seed and exact-object cleanup |

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
| [ ] | All of them are `pr-only` protected resources in this server (IN-08) | Not built (B-3) |
