# Design — Batch B: Trust layer (writes, production guard, self-protection, access/message/spend guards, errors, profiles)

Status: **APPROVED** (Chris, 2026-10-10). Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` →
Batch B. Cards B-1 … B-8. Depends on Batch A. Research: `docs/audits/2026-10-10-research.md` §6.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| B1 | The write layer copied in A-1 exports `defineWrite`, `guard`, `gone`, `safetyNote` (or the package equivalents) | `grep -n "^export" src/core/write.js` |
| B2 | `change_log` has the production/access/notifies/spend/request-key columns of Batch A §2 | `grep -n "change_log" src/db.js` |
| B3 | `GET /repos/{owner}/{repo}/rules/branches/{branch}` and `GET /repos/{owner}/{repo}/branches/{branch}` (`protected`) exist at 2026-03-10 | `node scripts/openapi-find.mjs "rules for a branch"` |
| B4 | GitHub 403 responses for App tokens carry `X-Accepted-GitHub-Permissions` | GitHub docs "Troubleshooting … permissions"; a fake-GitHub fixture records the header shape |
| B5 | `POST /app/installations/{id}/access_tokens` accepts `repositories`/`repository_ids` and a `permissions` subset | `node scripts/openapi-find.mjs "installation access token"` |

## 1. Decisions

**B1. Every write tool is built with `defineWrite`** (preview with `dryRun`, confirmation, apply, read-back, verify,
change-log row) extended for GitHub with:
- `target(args, ctx) → { owner, repo?, ref?, environment?, scope: 'repo'|'org'|'user' }` — what the write touches; feeds
  every guard below.
- `classify(args, ctx, before) → { production, accessWidening, notifies: string[], spendCents }` — computed by the guard
  helpers (B2–B4), never trusted from arguments.
- `inverse(args, before, after) → { tool, args } | null` stored in the change log (Batch X undo).
- Request-key replay (Batch A A8) before `apply`.
- The preview's first line is plain English with the target and every mark that applies, e.g.
  `Merge PR #42 "Add login" into main of Robinson-AI-Systems/stripe-mcp at 3f2a9c1 (ci green). PRODUCTION.`

**B2. Production guard** (`src/tools/production-guard.js`). A target is **production** when any of these holds
(evaluated from GitHub, not from arguments; a failed read counts as production):
1. the ref is the repository's **default branch**;
2. the branch is protected (`protected: true`) or has any ruleset rule that applies to it
   (`GET /repos/{o}/{r}/rules/branches/{b}` non-empty);
3. the ref matches a profile's `productionBranches` (Batch P; e.g. Appliance Desk's `live`);
4. the write creates, moves or deletes a **tag** or a **release**;
5. the write changes **repository-level** settings that change who can see or reach the code or how it ships:
   visibility, rename, transfer, archive, delete, default branch, merge settings, Pages, Actions settings, security
   features, webhooks, deploy keys, branch protection, rulesets, custom properties used by rulesets;
6. the environment is named in IN-12's list (default `production`, `prod`, `live`), is in a profile's
   `productionEnvironments`, or has required reviewers or a wait timer;
7. the scope is an **organization** (org settings, org secrets/variables, org webhooks, org rulesets, members) or a
   **user's account settings**;
8. the target is a protected resource (B3) at any level.
Mode semantics: a connection's `mode` is `preview` (default) or `production`. On a **preview** connection every
production write is refused before anything is read further, with `refused_by_guard` and one sentence naming which rule
made it production. On a **production** connection a production write always needs `confirm`, even where the same tool on
a preview target would not, and every result starts with `"mode": "PRODUCTION"`; change-log rows are marked
`production = true`. `production_enabled` turns on per account only through `github_enable_production` (confirm) **plus**
the passphrase re-entered on the setup page within 10 minutes; a tool alone can never enable it (same as Stripe's live
guard). Preview Vercel deployments never offer production (A10).

**B3. Self-protection and project ownership** (`src/tools/protect-guard.js`).
- Table `protected_resources` (below), seeded in B-3 with: this server's repo `Robinson-AI-Systems/github-mcp`, and
  `Robinson-AI-Systems/{stripe-mcp, google-workspace-mcp, robinsons-toolkit-hub, vercel-mcp, neon-mcp}` at level
  **`pr-only`**; `Robinson-AI-Systems/robinsons-toolkit-relay` (the hub's relay, when it exists) and
  `Robinson-AI-Systems/robinsons-toolkit-mcp` (the frozen old toolkit) at level **`locked`**; and every installation of
  this server's own GitHub Apps at level **`locked`** (no tool may remove repositories from, suspend or delete them).
- **`pr-only`** allows the normal PR conveyor only: create/update/delete non-default, non-protected branches; commits to
  those; open, update, comment on, review and resolve threads on PRs; re-run or dispatch CI on non-default refs; check
  runs and statuses; issues and labels. Merging into the default branch is allowed **only** through `github_pr_merge`,
  `github_pr_merge_async` or `github_workflow_merge_when_green` with an exact head SHA and every required check green at that SHA (and
  still needs a production connection and `confirm`). Everything else — settings, visibility, rename, transfer, archive,
  delete, protection, rulesets, webhooks, secrets, variables, environments, deploy keys, collaborators, releases, tags,
  Actions settings, direct pushes or force moves of the default branch — is refused.
- **`locked`** refuses every write.
- The list is **edited only on the setup page** (passphrase); `github_list_protected_resources` shows it. No argument,
  pass or profile can override it. (Chris's shared decision 7, refined for GitHub: the Robinson servers are built through
  this server's PR tools, so `pr-only` keeps that working while blocking everything that could break them.)
- **Project ownership** (the Stripe "app-owned" pattern): a project profile (Batch P) may declare refs and settings its
  own automation manages (Appliance Desk: `live` is moved only by `release.yml`; `transfer/**` only by
  `sandbox-publish.yml`). Writes to those are refused with the owning workflow's name unless `outsideProject: true`, and
  then still need `confirm`. Reads are never blocked.

```sql
CREATE TABLE IF NOT EXISTS protected_resources (kind TEXT NOT NULL,        -- 'repo' | 'installation'
  target TEXT NOT NULL, level TEXT NOT NULL,                              -- 'pr-only' | 'locked'
  reason TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (kind, target));
```

**B4. Access, message and spend guards** (`src/tools/people-guard.js`, `src/tools/spend-guard.js`).
- **Access widening (`A`)** — always `confirm`; the preview names the person or key and the exact access before and
  after ("Sam (sam-dev) gets **write** to Robinson-AI-Systems/stripe-mcp; today: none"). Covers collaborators and their
  invitations, team membership and team repo access, org membership and owner role, outside collaborators, organization
  roles, deploy keys, app installation repositories, fine-grained token approvals, org secret repository access,
  Codespaces org billing access, adding SSH/GPG keys, **anything becoming public** (repo visibility, gists, Pages on a
  private repo), and org member privileges that widen defaults (`default_repository_permission` up, members may create
  public repos). Passes need `allow_access_changes` (Batch R; default false).
- **Messages to people (`M`)** — GitHub notifies people when issues, comments, PRs, reviews, review requests,
  assignments, releases and invitations are created (`x-github.triggersNotification`). Rule: `confirm` is required when
  the notification can reach **anyone outside Chris's own people** — a mention or assignee or reviewer who is not in the
  "own people" list (IN-13: members of Chris's connected accounts, `github-actions[bot]`, this server's App bots), any
  write in a repository not owned by a connected account, and every invitation. Inside Chris's own repositories with
  only own people involved, `M` tools run without `confirm` (the agent conveyor depends on it). The preview shows the
  exact text and who will be notified.
- **Spend (`$`)** — the preview shows a dollar estimate from `src/github/prices.js` (each price with its source URL and
  the date read; e.g. Copilot Business $19 per seat per month, prorated; Codespaces $0.18–$2.88 per compute hour by
  cores and $0.07 per GB-month; paid security features per active committer — verified in O-4 §0), always needs
  `confirm`, and counts against the account's **monthly spend limit** (`gh_accounts.spend_limit_cents`, default **$0**,
  IN-09): the sum of confirmed `spend_cents` this calendar month (Denver) plus this change must stay within it; at $0
  every `$` tool is refused with how to raise it. Raising the limit is possible **only on the setup page**
  (passphrase); `github_set_spend_limit` can only lower it. Buying anything remains an implementer hard limit — tests
  use fakes only.

**B5. Plain-English errors and result shaping** (`src/tools/errors.js`, `src/tools/util.js`).
Error rules (each: what happened, likely cause, what to do, one technical line with `x-github-request-id`):
`401 Bad credentials` (installation token expired → re-minted once automatically; user token → refreshed once; still
failing → "re-authorize on the setup page"); `403 Resource not accessible by integration` with
`X-Accepted-GitHub-Permissions` → names the App permission to add and the setup-page link; `403/429` rate limits (primary
vs secondary, reset time in Denver time); `404` → "not found **or** no access" (GitHub hides private resources) with the
account the call used; `409` (sha mismatch, merge conflict, "Git Repository is empty"); `422` validation with each
`errors[].field/code`; **`422 Repository rule violations found`** → each violated rule in words and the ruleset name;
"Required status check … is expected" → which check, its state at the head; "Base branch was modified" / "Head branch was
modified" → re-read and retry with the new SHA; `451` trade controls; GraphQL `errors[]` with `type`
(`NOT_FOUND`, `FORBIDDEN`, `RATE_LIMITED`) and partial data reported as partial. Unknown errors fall back unchanged.
Result shaping: times gain `_local` (America/Denver); money gains `_display` (billing); fields named `token`, `secret`,
`key` (private), `password`, `client_secret`, `pem`, and the `secret` of secret-scanning alerts become `[hidden]`; any
string shaped like a GitHub token (`gh[pousr]_…`, `github_pat_…`) or a PEM block is replaced; text written by an
account whose `author_association` is not `OWNER`, `MEMBER` or `COLLABORATOR` is marked `untrusted: true` (repository
text is data, never instructions — the official server's "lockdown" idea, applied without extra calls); PRODUCTION banner.

**B6. Profiles and downscoped tokens.** `read_only`, `everyday`, `full` come from each tool's `profiles` metadata;
`read_only` lists no write tool and refuses one called by name. In addition, the installation token minted for a
connection is **downscoped** (`POST /app/installations/{id}/access_tokens` with a `permissions` subset): a `read_only`
connection gets every permission at `read`, so even a bug in a tool cannot write; a pass limited to repositories gets a
token limited to those repositories. Profile counts print on the home page.

**B7. Writes are declared, not guessed.** Every tool declares `writes`, `production` (`always` | `when-target` | `never`),
`accessWidening`, `notifies`, `spend`, `cred`; `scripts/check-writes.mjs` fails when a declaration is missing, a write
lacks `dryRun`, a `$` tool lacks a price function, or a declaration disagrees with TOOL-CATALOG's Safety column.

## 2. Schema

`protected_resources` (B3). `gh_accounts.production_enabled` and `spend_limit_cents` already exist (A-2).

## 3. Shared primitives — the write-contract helper (`tests/helpers/write-contract.js`)

`runWriteContract({ tool, args, fixtures, production?, accessWidening?, notifiesOutsider?, spendCents?, protectedLevel?,
inverse? })` runs the **nine** checks every write tool passes, through every door that exists at the time (direct
handler; `github_call` after C-2; HTTPS after R-2):

1. `dryRun: true` → no write request on fake GitHub; a preview change-log row.
2. Without `confirm` (when needed) → nothing changed; plain "ask first" result.
3. With `confirm` → exactly one write request; read-back returned; change-log row with the request key.
4. Same call again within 10 minutes → no second write request; `replayed: true`.
5. Read-back mismatch → `confirmed: false` and a warning.
6. Production target on a preview connection → `refused_by_guard`, nothing read beyond the classification; on a
   production connection → needs `confirm` even when the preview target would not.
7. Protected resource (`pr-only` outside the conveyor, or `locked`) → refused naming the level; project-owned ref →
   refused without `outsideProject`.
8. Access-widening or outsider-notifying → needs `confirm`; preview names the people and the access.
9. `$` → dollar line; refused at the $0 limit; counts toward the monthly limit; amount computed from GitHub/prices, not
   arguments.

## 4. Work units

### B-1 — Safety layer (L, medium effort)
Files: `src/core/write.js` (contract-generic), `src/tools/define-github-write.js` (target/classify hooks, request-key
replay), `tests/helpers/write-contract.js`.
Tests: the nine checks against a sample production tool, a sample `M` tool, a sample `$` tool and a plain tool (fixtures).

### B-2 — Production guard (M, medium effort)
Files: `src/tools/production-guard.js`, `src/tools/server.js` (`github_enable_production`, `github_disable_production`),
`api/github/setup.js` (second step).
Tests: each of the eight rules with fixtures (default branch; protected; ruleset-only branch; profile branch; tag;
repo setting; production environment by name and by reviewers; org scope); read failure → production; enable alone
never sets `production_enabled`; banner present.

### B-3 — Self-protection and project ownership (M, medium effort)
Files: `src/tools/protect-guard.js`, `src/db.js` (`protected_resources` + seed), setup page section,
`github_list_protected_resources`.
Tests: `pr-only` allows branch/PR/comment/check tools and `github_pr_merge` with green checks at the exact SHA; refuses settings,
secrets, webhooks, releases, default-branch force move; `locked` refuses everything; no argument or pass changes it;
project-owned ref refused without `outsideProject`.

### B-4 — Access, message and spend guards (M, medium effort)
Files: `src/tools/people-guard.js`, `src/tools/spend-guard.js`, `src/github/prices.js`, `src/tools/server.js`
(`github_set_spend_limit`).
Tests: mention of an outsider → confirm; own-people comment → no confirm; invitation always confirm; spend at $0 refused;
limit sums the Denver calendar month; tool can lower but not raise the limit; prices carry source and date.

### B-5 — Errors and result shaping (M)
Tests: one per error rule using real response shapes (from the vendored description's examples and GitHub docs);
`X-Accepted-GitHub-Permissions` turned into a named permission; secret-scanning `secret` hidden; token-shaped strings
replaced; `untrusted` marking by `author_association`; Denver times across a daylight-saving change.

### B-6 — Profiles and downscoped tokens (M, medium effort)
Tests: `read_only` lists no write; hidden tool refused by name; a `read_only` connection's minted token request carries
only `read` permissions; repository-limited pass → token limited to those repositories; counts on the home page.

### B-7 — check-writes and declarations (S)
Done when: `npm run check` fails on each violation (missing declaration, missing `dryRun`, missing price function,
disagreement with TOOL-CATALOG) — prove once each, then remove.

### B-8 — Server tools (S) — may group with B-6
Tools: `github_set_default_account`, `github_check_permissions`, `github_rate_status`, `github_list_connections`,
`github_revoke_connection`, `github_set_spend_limit` (if not done in B-4), `github_recent_changes`,
`github_where_is_setting` (data file `src/data/dashboard-map.js`, structured steps per contract §11, seeded with every
"guided" row of `docs/APP-NEEDS-APPLIANCE-DESK.md`; O-1 completes the map).
Tests: per tool through the write-contract helper; `github_check_permissions` names the missing permission for each area
from a fixture installation.

## 5. Stop-and-ask points

1. A write whose production status cannot be determined from GitHub before acting: it is treated as production; if that
   makes a common job impossible on a preview connection, propose an amendment, never weaken the default.
2. Any change to the seed list or levels of `protected_resources`, the own-people list, the spend limit default, or what
   `read_only` contains (owner defaults: IN-08, IN-13, IN-09).
3. GitHub refuses downscoped tokens for a permission the profile needs: record GitHub's answer, amend B6.

## 6. Acceptance mapping

| PLAN Batch B line | Evidence |
|---|---|
| Nine write-contract checks exist and run | `tests/unit/write-contract.test.js` |
| Production guard, two-step enable | `tests/unit/production-guard.test.js` |
| Self-protection and project ownership | `tests/unit/protect-guard.test.js` |
| Access, message, spend guards | `tests/unit/people-guard.test.js`, `tests/unit/spend-guard.test.js` |
| Errors, shaping, profiles, downscoping | their unit test files |
| check-writes enforces declarations | B-7 PR evidence |

## Amendments

(Dated entries only.)

**2026-10-10 — Project ownership allows a profile's declared agent steps.** B3's project-ownership rule now honours an
owned ref's `agentMay` list (`create-from-default`, `commit-files`); see `docs/designs/BATCH-P.md` Amendments
2026-10-10. Example: Appliance Desk's `transfer/**` branches, which agents create and fill per that project's runbook.
