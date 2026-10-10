# Design — Batch P: Project profiles (any project whose code and automation live on GitHub)

Status: **APPROVED** (Chris, 2026-10-10). Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` →
Batch P. Cards P-1 … P-3. Depends on Batches B, G and H.

The GitHub MCP is a general development tool. Some projects run their own automation on GitHub — a release workflow that
moves a production branch, a sandbox-publish workflow that pushes branches, rules their agents depend on. For such a
project the server must know three things, or it will fight the project: **which refs and settings the project's own
automation manages**, **which branches and environments are production**, and **how to check that GitHub is set up for
it**. A **project profile** holds exactly that. Profiles are **optional**: most work needs none. Appliance Desk and the
Robinson servers are the first two profiles (`docs/APP-NEEDS-APPLIANCE-DESK.md`); they prove the design is complete,
they do not shape it.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| P1 | `docs/APP-NEEDS-APPLIANCE-DESK.md` still matches the app's repository | in `christcr2012/appliance-desk` (read only): `ls .github/workflows`; `grep -n "permissions:\|pull_request_target\|refs/heads\|branches:" .github/workflows/*.yml`; `vercel.json` `git.deploymentEnabled`; OWNER-INPUTS IN-67/IN-68 |
| P2 | The production guard (B-2) and project-ownership guard (B-3) read profiles through one function each | `grep -n "profileFor\|productionBranches\|ownedRefs" src/tools/*.js \| head` |
| P3 | Each Robinson server repository still follows the shared process (`ci` gate, `ai/*` branches, merge commits) | read each repo's `AGENTS.md` "Verify, push, review, merge" (read only) |

## 1. Decisions

**P1. A profile is data, not code.** One row in `known_projects` per project, plus one human-readable file
`docs/APP-NEEDS-<PROJECT>.md`. Adding a project = one data row + one doc + one test fixture; no new tools.

**P2. What a profile holds** (JSON, validated by `src/data/profile-schema.js`): `id`, `name`, `repos[]`
(`owner/name`), `productionBranches[]` (besides the default branch; e.g. `live`), `productionEnvironments[]`,
`ownedRefs[]` (`{ pattern, managedBy: '<workflow file>', note }` — e.g. `live` by `release.yml`, `transfer/**` by
`sandbox-publish.yml`), `branchPatterns` (`work: ai/**`, `preview: preview/**`, …), `requiredChecks[]` (e.g. `ci`),
`mergeMethod` (`merge`), `workflows[]` (`{ file, maxPermissions, forbiddenTriggers: ['pull_request_target'],
secretsAllowed: false }`), `repoSettings` (expected values, e.g. `allow_merge_commit: true`), `security` (secret
scanning, push protection), `actionsSettings` (default token read-only, fork-PR approval for all outside contributors),
`apps[]` (Apps expected to have access, e.g. Vercel), `collaborators` (expected list or "owner only"), `notes`.

**P3. Profiles feed the guards.** `productionBranches`/`productionEnvironments` extend B-2's rules; `ownedRefs` drive
B-3's project-ownership guard (refused without `outsideProject: true`). No profile on a repository → nothing extra.

**P4. `github_workflow_app_readiness(project | spec)`** checks every row of a profile — or of an inline `spec` with the same
fields, for a project that has no profile yet — and returns, per row: done / fixed (with confirm) / needs you (link +
numbered steps) / needs a decision (`IN-xx` of that project). It can fix, each previewed and confirmed: ruleset missing
the required check, secret scanning/push protection off, default token permission write, fork-PR approval too loose,
merge-commit setting. It **never** edits a project's workflow files or moves an owned ref; it reports them.

**P5. `github_workflow_project_setup(project, spec)`** is for a **new** project: given a short plain description (name, owner,
public/private, required check name, production branch, environments), it previews and then creates the repository (or
uses an existing empty one), a ruleset requiring the check (and blocking force pushes and deletion of the default
branch), merge settings, security features, standard labels, environments with protection where the plan allows; run
twice → nothing new. It finishes by writing a draft profile (`status: draft`) and the text of the project's
`APP-NEEDS-<PROJECT>.md` for Chris or the project's agent to commit in that project's repo.

**P6. `github_profile_draft(findings)`** turns what an agent found in a codebase (workflow files and their
`permissions`, branch names used in scripts, environments, required check names, Vercel `git.deploymentEnabled`) into a
draft profile and APP-NEEDS text. It never fetches code itself.

## 2. Schema

```sql
CREATE TABLE IF NOT EXISTS known_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  profile JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
```

Seed (P-1): `appliance-desk` (from `docs/APP-NEEDS-APPLIANCE-DESK.md`) and `robinson-servers` (repos
`Robinson-AI-Systems/{github-mcp, stripe-mcp, google-workspace-mcp, robinsons-toolkit-hub, vercel-mcp, neon-mcp}`:
required check `ci`, merge commits, `ai/**` work branches, CI `permissions: contents: read` with no secrets and no
`pull_request_target`, secret scanning + push protection on, no automated review).

## 4. Work units

### P-1 — `known_projects`, two seeds, guards read profiles (M, medium effort)
Tools: `github_profile_list`, `github_profile_get`. Tests: `live` on Appliance Desk is production; `transfer/x` write
refused naming `sandbox-publish.yml`; `outsideProject` goes ahead with confirm; a repo without a profile unaffected; a
test lists every seeded row with the appliance-desk file it came from (the PR body carries that table).
### P-2 — `github_workflow_app_readiness` (L, medium effort)
Tests with fixtures for every row of the Appliance Desk table (`docs/APP-NEEDS-APPLIANCE-DESK.md`, rows G1–G20) and the
Robinson-server profile: ruleset missing `ci` → one confirmed fix → read-back; push protection off → fix; workflow with
`pull_request_target` → reported, never edited; guided rows return link + steps; inline spec behaves like a profile.
### P-3 — `github_workflow_project_setup` and `github_profile_draft` (M)
Tests: new project created with ruleset, settings, labels; run twice → nothing new; the draft profile and doc text are
returned, never committed elsewhere; findings with an unknown field are reported, not guessed.

## 5. Stop-and-ask points

1. P1 shows the app changed its GitHub use: update the profile and the APP-NEEDS file in the same PR.
2. Readiness would need to change a project's workflow files: never; report and stop.

## 6. Acceptance mapping

| PLAN Batch P line | Evidence |
|---|---|
| Appliance Desk and Robinson-server profiles complete and traceable | P-1 table in PR |
| Readiness covers all rows | `tests/unit/workflow-app-readiness.test.js` |
| New-project setup idempotent | `tests/unit/workflow-project-setup.test.js` |

## Amendments

(Dated entries only.)

**2026-10-10 — Owned refs may allow the project's own agent steps (found while writing APP-NEEDS-APPLIANCE-DESK).**
Appliance Desk's fallback publishing runbook (`docs/runbooks/SANDBOX-PUBLISH.md` there) tells an agent to **create**
`transfer/<id>` from `main` "with your GitHub tool" and **upload files** into its `.transfer/` folder; the workflow
`sandbox-publish.yml` then rebuilds the commits, pushes the `ai/*` target and deletes the transfer branch. A blanket
"refused without `outsideProject`" on `transfer/**` would break that runbook. Change to P2/P3 and B3: an `ownedRefs`
entry may carry `agentMay: ['create-from-default', 'commit-files']` (the only two values); those writes go through the
normal guards without `outsideProject`. Everything else on an owned ref — force moves, ref updates to another SHA,
renames, deletes, merges into it — stays refused without `outsideProject: true` (and then needs `confirm`). The
Appliance Desk seed uses `agentMay` for `transfer/**` only; `live` has none. P-1 tests both.

**2026-10-10 — Profile tools renamed `github_profile_*`** (were `github_project_*_profile`), because `github_project_*` is
GitHub Projects (F-3). Same names pattern as the Vercel MCP (`vercel_profile_*`). DECISIONS 2026-10-10.
