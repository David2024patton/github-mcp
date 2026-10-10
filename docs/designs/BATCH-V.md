# Design — Batch V: Developer tools (build and test with GitHub)

Status: **DRAFT — awaiting Chris's approval (IN-00)**. Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` →
Batch V. Cards V-1 … V-5. Depends on Batches E and G (PR and Actions tools exist). Tool list: `docs/TOOL-CATALOG.md`
section Developer tools. Follows hub contract §10 (`devTools: true` in the manifest).

These are the jobs an agent does while *building* something that uses GitHub — a bot, a GitHub App, a CI pipeline, a
release process, another toolset — not the jobs of running Chris's repositories. **Preview only:** every `github_dev_*` tool
refuses a production target (B-2) before reading anything else, on any connection mode.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| V1 | The scratch account exists, has this server's App installed with "All repositories", and is marked `is_scratch` (IN-06) | `github_list_accounts` shows `scratch: true` |
| V2 | Topics accept `rtc-run-<id>` (lowercase, ≤50 chars, letters/digits/hyphens) | `node scripts/openapi-find.mjs "replace all repository topics"` + GitHub topic rules |
| V3 | Webhook delivery details include the request headers and payload (`GET …/hooks/{id}/deliveries/{delivery_id}`) | read the `hook-delivery` schema |
| V4 | There is no API that emits an arbitrary webhook event; `pings` and push `tests` exist; redelivery exists | `node scripts/openapi-find.mjs "ping"` / `"redeliver"` |

## 1. Decisions

**V1. Runs record everything they create.** Every `github_dev_*` write belongs to a run (`dev_runs`; a caller may pass its own
`runId`, e.g. the hub's development environment) and every created object is recorded (`dev_run_objects`: type, owner,
repo, id/name, created SHA). Objects are tagged where GitHub allows: repository topic `rtc-run-<id>` and description
suffix `rtc_run=<id>`; branch name `rtc/<runId>/<name>`; PR/issue label `rtc-run` plus body footer
`<!-- rtc_run=<id> -->`; webhook config URL query `rtc_run=<id>` on forwarders only. Cleanup uses the recorded IDs,
never a search.

**V2. Where developer tools may write.** Scratch repositories are created only in the **scratch account** (IN-06). On any
other repository a run may create only: test branches `rtc/<runId>/…` from any ref, commits on those branches, draft PRs
from them (never into a production base unless the PR stays draft and is closed by cleanup), labels it needs, check runs
and statuses on its own commits, and webhooks only in scratch repositories. Never on a `locked` protected repository;
on a `pr-only` one exactly the conveyor set (B-3).

**V3. Scenarios, not random noise** (`src/dev/scenarios.js`): `repo-basic` (repo with README, `ci.yml` that passes,
labels), `failing-ci` (a branch whose workflow fails with a known error line — for testing log summaries and rerun
logic), `pr-with-threads` (a PR with three review threads, one outdated), `stack-of-three` (three stacked PRs),
`release-train` (tags v0.1.0..v0.3.0 and a draft release, scratch only), `protected-main` (ruleset requiring `ci`,
scratch only), `webhook-target` (a scratch repo with a webhook to a forwarder). `github_dev_seed(scenario | description)`
matches a plain description to scenarios; the preview lists every object that will be created.

**V4. Cleanup is precise** (`github_dev_cleanup(runId | 'all-runs')`, preview then `confirm`): close the run's PRs, delete its
branches, delete its webhooks and forwarders, close (reason "not planned") and label `rtc-cleaned` its issues outside
scratch (GitHub cannot delete issues through the REST API with an installation token), delete its scratch repositories
(scratch account only; destructive but confined). Reports per object; partial failures listed; a non-run object with
the same tag is left alone.

**V5. CI for testing.** `github_dev_dispatch_and_wait` dispatches a workflow on a test ref (the 2026-03-10 response gives the
run ID), waits up to 45 s inside the Vercel budget, and returns the run state or a handle to check later — never a loop.
`github_dev_set_check_run` creates or completes a check run on a run-created commit (`success`/`failure`/`neutral`, with
optional annotations) so an agent can test merge gates, bots or the E-1 CI-state helper without real CI.

**V6. Webhook deliveries replayed into apps under development** (the GitHub version of Stripe's event forwarding).
`github_dev_create_forwarder(url, events?)` registers a target (HTTPS, public address only — private, loopback, link-local and
metadata addresses refused after DNS resolution) and a new signing secret shown **once** on the setup page, which the
developer sets in their app. `github_dev_forward_deliveries(forwarder, hook, deliveryIds | since | events)` reads real past
deliveries (`GET …/hooks/{id}/deliveries/{delivery_id}` — payload and headers), re-sends each payload to the target with
the original `X-GitHub-Event`, a fresh `X-GitHub-Delivery`, and `X-Hub-Signature-256` computed with the forwarder's
secret, and reports each target status code. `github_dev_create_test_webhook` makes a webhook in a scratch repo pointing at a
forwarder or app URL; `github_webhook_ping`/`github_webhook_redeliver` (H-2) then generate real deliveries.

**V7. Integration check** (`github_dev_check_integration(spec)`), read-only: given a spec for an app being built (needed App
permissions, webhook events, secrets/variables by name, workflows present, required checks, environments), reports per
item ok / missing (with the exact tool call or `github_where_is_setting` steps).

## 2. Schema

```sql
CREATE TABLE IF NOT EXISTS dev_runs (id TEXT PRIMARY KEY, account TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  connection TEXT, description TEXT, scenarios TEXT[], status TEXT NOT NULL DEFAULT 'active', cleaned_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS dev_run_objects (run_id TEXT NOT NULL, object_type TEXT NOT NULL,   -- repo|branch|pr|issue|label|webhook|check_run|tag|release
  owner TEXT NOT NULL, repo TEXT, object_id TEXT NOT NULL, created_sha TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), cleaned BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY (run_id, object_type, owner, object_id));
CREATE TABLE IF NOT EXISTS dev_forwarders (id TEXT PRIMARY KEY, account TEXT NOT NULL, url TEXT NOT NULL,
  events TEXT[], secret_enc TEXT NOT NULL, run_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_used_at TIMESTAMPTZ);
```

## 4. Work units (each: production-refusal test; write-contract for every write)

### V-1 — Scenarios, seed, runs, scratch repositories (L, medium effort)
Tools: `github_dev_list_scenarios`, `github_dev_seed`, `github_dev_list_runs`, `github_dev_create_scratch_repo`. Tests: each scenario's preview lists
exact objects; every created object recorded and tagged; same `requestKey` twice creates nothing new; scratch repos only
in the scratch account; request shapes valid.
### V-2 — Cleanup (M, medium effort)
Tools: `github_dev_cleanup`. Tests: only recorded objects touched; an untagged look-alike left alone; repos deleted only in
scratch; per-object report with a partial failure.
### V-3 — Test branches, PRs, dispatch, check runs (M)
Tools: `github_dev_create_test_branch`, `github_dev_open_test_pr`, `github_dev_dispatch_and_wait`, `github_dev_set_check_run`. Tests: branch names
always `rtc/<run>/…`; dispatch on a production ref refused; wait bounded at 45 s with a handle; check run only on
run-created commits.
### V-4 — Webhooks and delivery forwarding (M, medium effort)
Tools: `github_dev_create_test_webhook`, `github_dev_create_forwarder`, `github_dev_list_forwarders`, `github_dev_delete_forwarder`,
`github_dev_forward_deliveries`. Tests: signature verifies with `@octokit/webhooks` `verify` and the forwarder secret; private,
loopback, link-local and metadata URLs refused (also after DNS); secret never in a result.
### V-5 — Integration check (S)
Tools: `github_dev_check_integration`. Tests: each spec item ok / missing with the exact fix; no write requests at all.

## 5. Stop-and-ask points

1. Any V0 row false: amend before that card (V1 false → build everything except scratch-repo creation; say so).

## 6. Acceptance mapping

| PLAN Batch V line | Evidence |
|---|---|
| Production refused everywhere | production-refusal test per tool |
| Cleanup touches only recorded objects | `tests/unit/dev-cleanup.test.js` |
| Forwarded deliveries verify like real GitHub deliveries | `tests/unit/dev-forward.test.js` |

## Amendments

(Dated entries only.)
