# Design — Batch G: CI and delivery (Actions, checks, secrets and variables, environments, deployments, releases, Pages, packages)

Status: **DRAFT — awaiting Chris's approval (IN-00)**. Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` →
Batch G. Cards G-1 … G-6. Depends on Batch E (the CI-state helper of E-1/E-2). Tool list: `docs/TOOL-CATALOG.md`
sections Actions; Checks, statuses, artifacts and caches; Secrets and variables; Environments and deployments; Releases;
Pages and packages.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| G1 | `POST …/actions/workflows/{id}/dispatches` returns `200` with the run ID and URLs at 2026-03-10 (research §1.1) | `node scripts/openapi-find.mjs "workflow dispatch"`, read `workflow-dispatch-response` |
| G2 | Job logs (`GET …/actions/jobs/{job_id}/logs`) and run logs (`GET …/actions/runs/{run_id}/logs`) answer with a redirect to a short-lived download URL (plain text for jobs, zip for runs); step logs exist (`…/jobs/{job_id}/steps/{step_number}/logs`) | the operations' `302` responses in the description |
| G3 | Secrets are written as `encrypted_value` + `key_id` sealed with the scope's public key (`…/secrets/public-key`) for Actions, Dependabot, Codespaces and agents secrets, at repo, environment and org level | `node scripts/openapi-find.mjs "public key"`; GitHub's "Encrypting secrets for the REST API" (libsodium) |
| G4 | Check runs can be created only with a GitHub App token | `docs/audits/2026-10-10-research.md` §4 (availability data) |
| G5 | Release asset upload goes to `uploads.github.com` with the `upload_url` template | `node scripts/openapi-find.mjs "upload a release asset"` |

## 1. Decisions

**G1. Logs are summarised, never dumped** (audit G5). `actions_get_job_log` follows the redirect server-side, keeps the
last 400 lines by default (`tailLines`), puts failed steps first (from the job's `steps[]` and step logs), extracts error
lines (`##[error]`, `Error:`, `FAIL`, `✗`, stack traces) and annotations. `actions_get_run_logs_summary` downloads the
run's zip server-side (stream, 50 MB cap), and returns per failed job: failing step, error lines (≤40), annotations,
duration. Full text stays behind a handle.

**G2. Dispatch returns the run.** `actions_dispatch` (API 2026-03-10) returns the run ID; production when the ref is
production (B-2) **or** the workflow file declares a job with an `environment:` that is a production environment
(read from the workflow file at that ref), because dispatching a deploy workflow on `main` deploys.

**G3. Reruns are bounded.** `actions_rerun` (mode `all` | `failed` | `job`) records the run attempt in the change log;
`workflow_rerun_failed_ci` (W-4) refuses a second automatic rerun of the same failure (two-strikes rule from Chris's
build process). Rerunning a production deployment job is production.

**G4. Secret values never pass through a tool** (shared decision 5). `secret_set(scope, name, valueFrom)`:
`valueFrom: 'setup-page'` (default) records a `secret_entry_requests` row and returns a link; Chris types the value on the
setup page; the server fetches the scope's public key, seals the value with libsodium (`crypto_box_seal`), PUTs
`encrypted_value` + `key_id`, and reads back (`GET …/secrets/{name}` → `updated_at` newer). `valueFrom: 'generate'`
makes a random value (default 32 bytes, hex) server-side, stores it the same way, and — only if Chris asks on the setup
page — shows it once on the one-time-secret page. `secret_list` never returns values (GitHub never does either). Moving
a value from another service (e.g. a Neon connection string) is a hub workflow (ROADMAP), not built here.

**G5. Variables are not secret** and are returned with values; setting a variable in a production environment or at org
level is production.

**G6. Environments and deployments.** `env_save` is read-merge-write (protection rules, reviewers, wait timer, branch
policies) and production when the environment is (B-2 rule 6). `deploy_create` to a production environment is production;
`actions_review_pending_deployment` (approve/reject) needs Chris's user token (`U`) because GitHub requires a person as
the reviewer.

**G7. Releases are production** (B-2 rule 4). `release_create` defaults to `draft: true` and `generate_release_notes:
true`; publishing (`release_update` with `draft: false`, or `release_create` with `draft: false`) creates the tag and is
production + `M` (watchers are notified). `release_upload_asset` downloads from a public HTTPS URL server-side (private,
loopback and metadata addresses refused; 100 MB cap), never takes bytes in chat (audit G15). Immutable releases (org
setting) are respected: editing a published immutable release is refused with GitHub's reason.

**G8. Check runs are for builders.** `check_create_run`/`check_update_run` act as the App (G4); they never complete a check
run that another app owns. `status_create` writes commit statuses (any credential). `check_get_ci_state` is the E-1 helper
exposed as a tool.

**G9. Artifacts and archives are links.** `artifact_get_link` returns GitHub's short-lived download URL (followed
server-side only to read the `Location` header); bytes never pass through chat.

## 2. Schema

```sql
CREATE TABLE IF NOT EXISTS secret_entry_requests (id TEXT PRIMARY KEY, account TEXT NOT NULL,
  scope JSONB NOT NULL,                    -- { kind: 'actions'|'dependabot'|'codespaces'|'agents', level: 'repo'|'environment'|'org', owner, repo?, environment?, name }
  mode TEXT NOT NULL,                      -- 'setup-page' | 'generate'
  connection TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ, change_log_id BIGINT);
```

## 3. Operations per tool

| Tool | Operation(s) (paths under `/repos/{owner}/{repo}` unless stated) |
|---|---|
| `actions_list_workflows`, `actions_set_workflow_enabled` | `GET /actions/workflows`, `PUT …/workflows/{id}/enable` / `disable` |
| `actions_dispatch` | `POST /actions/workflows/{workflow_id}/dispatches` |
| `actions_list_runs`, `actions_get_run` | `GET /actions/runs` (or `…/workflows/{id}/runs`), `GET /actions/runs/{run_id}`, `…/jobs`, `…/timing` |
| `actions_get_job_log`, `actions_get_run_logs_summary` | `GET /actions/jobs/{job_id}/logs`, `…/steps/{n}/logs`, `GET /actions/runs/{run_id}/logs` |
| `actions_rerun` | `POST /actions/runs/{id}/rerun`, `…/rerun-failed-jobs`, `POST /actions/jobs/{job_id}/rerun` |
| `actions_cancel_run`, `actions_delete_run` | `POST …/cancel`, `…/force-cancel`; `DELETE /actions/runs/{id}`, `DELETE …/logs` |
| `actions_list_pending_deployments`, `actions_review_pending_deployment` | `GET`/`POST /actions/runs/{run_id}/pending_deployments` |
| `check_get_ci_state` | `GET /commits/{ref}/check-runs`, `GET /commits/{ref}/status`, rules + protection (E-1 helper) |
| `check_get_run`, `check_create_run`, `check_update_run` | `GET`/`PATCH /check-runs/{id}`, `…/annotations`, `POST /check-runs` |
| `status_create` | `POST /statuses/{sha}` |
| `artifact_list`, `artifact_get_link`, `artifact_delete` | `GET /actions/artifacts` (or per run), `GET …/{artifact_id}/zip` (redirect), `DELETE …/{artifact_id}` |
| `cache_list`, `cache_delete` | `GET /actions/caches`, `GET /actions/cache/usage`, `DELETE /actions/caches` / `…/{cache_id}` |
| `secret_list`, `secret_set`, `secret_delete` | `GET/PUT/DELETE …/{actions\|dependabot\|codespaces\|agents}/secrets[/…]`, environment and `/orgs/{org}/…` equivalents, `…/public-key` |
| `secret_set_repo_access` | `PUT /orgs/{org}/{kind}/secrets/{name}/repositories` |
| `variable_list`, `variable_set`, `variable_delete` | `GET/POST/PATCH/DELETE …/actions/variables[/{name}]`, environment and org equivalents |
| `env_list`, `env_get`, `env_save`, `env_delete` | `GET/PUT/DELETE /environments[/{name}]`, `…/deployment-branch-policies`, `…/deployment_protection_rules` |
| `deploy_list`, `deploy_create`, `deploy_set_status` | `GET/POST /deployments`, `GET/POST …/{id}/statuses` |
| `release_*` | `GET/POST /releases`, `GET /releases/latest`, `…/tags/{tag}`, `PATCH/DELETE /releases/{id}`, `POST /releases/generate-notes`, upload to `upload_url` |
| `pages_get`, `pages_save`, `pages_disable` | `GET/POST/PUT/DELETE /pages`, `GET /pages/builds/latest`, `GET /pages/health` |
| `package_list`, `package_delete_version`, `package_restore_version` | `GET /orgs/{org}/packages`, `GET /users/{username}/packages`, `…/versions`, `DELETE …/versions/{id}`, `POST …/versions/{id}/restore` |

## 4. Work units

### G-1 — Actions: workflows, runs, jobs, logs (L, medium effort)
Tests: dispatch returns run ID (fixture from the description's example); deploy workflow on `main` is production;
log summary from a fixture zip (failing step first, error lines, cap); never base64 in any result (grep over results);
force-cancel needs confirm; review pending deployment needs `U`.
### G-2 — Checks, statuses, artifacts, caches (M)
Tests: CI state merges check runs and statuses, required vs optional, `missing`; check run creation refused on a
fine-grained credential with a plain reason; artifact link only (no bytes).
### G-3 — Secrets and variables (M, medium effort)
Tests: no tool schema has a value argument for secrets (schema test); setup-page flow seals with the fixture public key
and the fake verifies `key_id`; generate mode never puts the value in any result or log (key-scan); org secret repo
access is access-widening; environment `production` variable is production.
### G-4 — Environments and deployments (M)
Tests: env save read-merge-write keeps reviewers when only branch policy changes; production by reviewers/wait timer;
deploy to production environment on a preview connection refused.
### G-5 — Releases (M)
Tests: draft by default; publish is production + M; asset upload from private URL refused; size cap; immutable release
edit refused in words.
### G-6 — Pages and packages (S)
Tests: Pages on a private repo making it public is access-widening; package delete is destructive with the 30-day note.

## 5. Stop-and-ask points

1. Any G0 row false: amend before that card.
2. Any need to accept a secret value in a tool argument: never; amend the design instead.

## 6. Acceptance mapping

| PLAN Batch G line | Evidence |
|---|---|
| Logs summarised; no base64 | `tests/unit/actions-logs.test.js` + result grep |
| Secret values never through tools | `tests/unit/secrets.test.js`, key-scan |
| Releases and production deploys guarded | `tests/unit/releases.test.js`, `tests/unit/deployments.test.js` |

## Amendments

(Dated entries only.)
