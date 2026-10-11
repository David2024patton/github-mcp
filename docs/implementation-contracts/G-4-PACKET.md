# G-4 worked packet — environments and deployments

Execution detail for BATCH-G decisions G6 and §4 G-4; **not an implementation card or a completed feature**.
Inspected baseline `ed60e19` (2026-10-11). G-3 part 2 is in flight (#45 at inspection); do not modify its card.
At G-4 start, merge current main, inspect that predecessor, then write the JIT card using this packet.

## Read only these

- `docs/designs/BATCH-G.md`: G6, operation rows for env/deploy, G-4 tests.
- `docs/TOOL-CATALOG.md`: Environment and deployment rows (declarations/credential/audience are authoritative).
- TOOL-RECIPES §1, §3–5; `src/tools/variables.js`: variableSet before/after pattern.
- `src/tools/production-guard.js`: productionReason environment and ref paths.
- `tests/unit/variables.test.js`: before/after sequence and three-door contract pattern.
- `src/github/client.js`: listAll return shape; `src/tools/summaries.js`: `environment`/`deployment` forms.

## Proposed edit map (confirm paths before adopting)

| Path | Responsibility |
|---|---|
| `src/tools/environments.js` (new) | env list/get/save/delete, writable-state normalizer; module tools/handlers |
| `src/tools/deployments.js` (new) | deploy list/create/set_status; derive target from existing deployment for status changes |
| `src/tools/index.js` | Import/register both modules once |
| `src/tools/summaries.js` | Reuse `environment`/`deployment` forms; add only missing observable fields with tests |
| `tests/unit/environments.test.js` (new) | Contract + preservation/clearing/production cases |
| `tests/unit/deployments.test.js` (new) | Contract + pending/ref/status cases |
| `tests/shapes/environments-deployments.test.js` (new) | Exact params/body, nested reviewer/policy validation |

No migration planned. No real credentials or deployment needed; all GitHub calls use validated fakes.
If the complete card exceeds one risk area or the size limit, split environments from deployments and record
the split at G-4 start. Both remain owned by G-4; do not mark the whole unit complete after one half.

## Verified route and field map

Top-level fields below were checked with `openapi-find.mjs --show` at the baseline. Recheck nested schema and
official reference for credential/plan semantics before coding; this is not permission to copy all fields blindly.

| Tool | Route / selector | Translation |
|---|---|---|
| `github_env_list` | `GET /repos/{owner}/{repo}/environments`; `data.environments` | Owner/repo; pagination/cap with explicit completeness |
| `github_env_get` | `GET /repos/{owner}/{repo}/environments/{environment_name}` | Input environment name → environment_name; include policy detail only via its own endpoints |
| `github_env_save` | `PUT /repos/{owner}/{repo}/environments/{environment_name}` | Writable body: wait_timer, prevent_self_review, reviewers, deployment_branch_policy |
| `github_env_delete` | `DELETE /repos/{owner}/{repo}/environments/{environment_name}` | No copied response fields or local options in body |
| `github_deploy_list` | `GET /repos/{owner}/{repo}/deployments`; optional status reads | Translate desired ref/environment/task filters to query fields |
| `github_deploy_create` | `POST /repos/{owner}/{repo}/deployments` | ref required; task, auto_merge, required_contexts, payload, environment, description, transient_environment, production_environment optional |
| `github_deploy_set_status` | `POST /repos/{owner}/{repo}/deployments/{deployment_id}/statuses` | deployment ID → deployment_id; state required; target_url, log_url, description, environment, environment_url, auto_inactive optional |

Branch policies: use `.../environments/{environment_name}/deployment-branch-policies` and `.../{branch_policy_id}`
for separate CRUD, not the environment PUT's body. Custom deployment protection rules are also separate.
Use the finder for every such operation actually included in the card. Names stay unencoded in Octokit params;
test an environment containing a slash/space to catch double encoding.

## Environment state contract

1. Before: environment GET + affected separate-policy reads. 404 means absent, 403/5xx means unreadable.
2. Normalize protection_rules into writable wait_timer/reviewers plus prevent_self_review and branch policy.
   Reviewers become the documented type/ID objects, not the full GET response's nested user/team.
3. Merge only supplied changes. Omission keeps a setting; explicit empty/false/zero clears it only where the
   API permits. Preserve unrelated custom protection controls; never silently disable unsupported controls.
4. Classify the **existing target** with productionReason. Also inspect whether the proposed settings make
   the environment production (reviewers/wait timer); removing protection must not reclassify an existing
   production environment as harmless. The JIT card must record its exact before/after classification rule.
5. Apply only the changed operations; read back the environment and changed separate policies. Compare intent
   and preserved settings. Env delete verifies absence and explains the lost protections in preview.
6. Record a clean inverse only when the prior configuration can be restored faithfully. Otherwise explain why
   it cannot; do not promise recovery of secret values or unrelated deleted resources.

If GitHub's actual GET/PUT shapes cannot preserve a protection the design requires, record the semantic gap
and reviewed amendment before that slice; the implementation must not silently drop it.

## Deployment state contract

Create: target includes resolved owner/repo, supplied ref/environment and production_environment intent.
The card must state how the flag and actual environment/ref combine under B-2. Classify before mutation;
preview mode must not dispatch a production deployment even when confirm is true.

Status: read the deployment by ID to derive its actual ref/environment rather than trusting caller labels.
Write the status, then read deployment statuses and compare the new status's observable state and requested
URLs/description. A wrong/missing ID never falls back to a harmless target.

Deployment create can return 201, 202, 409 or 422. Test 202's actual documented meaning separately: do not
parse it as a deployment object or claim deployment creation without observing it. If auto_merge behavior
can move a ref, reconcile the approved safety rule before exposing it; it cannot bypass E's merge contract.

## Ready-to-use behavior matrix

| Fixture / action | Required observation |
|---|---|
| Rich env before: reviewers, wait, self-review, branch policy; change only policy | All other writable controls preserved in request and read-back |
| Omit reviewers vs reviewers empty (when supported) | Omission retains; explicit clearing previewed and verified |
| Env name with slash/space | Correct single-encoded path; `gh.invalid` empty |
| Nonstandard env with reviewers; preview save/delete | Production reason names protection; zero mutations |
| Unprotected env gaining reviewers/wait | Proposed production classification honored before write |
| Environment read 403/500 | Unknown is not absence; zero unsafe mutations |
| One-write env case | Shared contract through handler/dispatch/github_call, ok and mismatch fixtures |
| Multi-endpoint policy update fails on second request | Exact trace/partial report; never verified success; no blind replay |
| Deployment to production env or default/protected ref on preview | Refused even with confirm; zero deployment writes |
| Status ID points at production deployment | Derived production target enforced |
| Deployment create 202/409/422 | Accurate pending/refused result; no invented ID or second POST |
| Read-back differs from requested env/status | Unconfirmed warning, not success |

## Slice sequence and finish evidence

1. Env normalization and reads → `npx vitest run tests/unit/environments.test.js`; lint changed JS.
2. Env save/delete and focused shapes → same unit file + `npm run test:shapes -- tests/shapes/environments-deployments.test.js`.
3. Deployment reads/create/status → targeted deployments unit file + shapes; split at the PR boundary if needed.
4. Drift checklist B; each catalog tool mapped to a passing test; `npm run check`, `npm test`, shapes and exact-head CI.

Successor G-5 inherits the actual new module exports, environment/ref classification regressions and any
remaining amended semantics. Update this packet's stale path assumptions in the card; do not re-read unrelated batches.
