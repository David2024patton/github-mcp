# PLAN — remaining scope and acceptance

Written 2026-10-10 for an empty repository. Order is in [MASTER-ROADMAP](MASTER-ROADMAP.md); current head and blockers in
[STATUS](STATUS.md). AGENTS owns workflow rules. This file owns acceptance; designs own semantic decisions; cards own the
next bounded implementation. Every line below maps to evidence named in its design's "6. Acceptance mapping".

## Rules that apply to every batch

- Every write tool passes the nine write-contract checks (`docs/designs/BATCH-B.md` §3) through every door that exists
  (handler; `github_call` after C-2; HTTPS after R-2).
- Every GitHub request shape passes against the fake GitHub, which validates it against the vendored OpenAPI description
  (REST) or GraphQL schema at the pinned version `2026-03-10` (`npm run test:shapes`).
- Database code passes on throwaway Postgres; schema changes are additive and idempotent; at most one migration per PR.
- `npm run check` green: secret scan, docs check, index validation, catalog count (`scripts/count-catalog.py`), lint,
  write-safety, token budgets, core imports.
- No secret in code, docs, tests, logs, PR text or tool results (key-scan test). No tool takes or returns a credential or
  a secret value.
- Preview by default. No production write on Chris's real repositories outside the card flow, no access widening on a real
  account, no purchase, no real credential in tests (AGENTS hard limits). Real-account writes only in the scratch
  organization (IN-06).
- Every tool name starts with `github_`; every tool is in `docs/TOOL-CATALOG.md` with the marks its code declares.
- Owner inputs are inputs, not things to invent: build the mechanism, keep the dependent behavior off, list the `IN-xx`.
- Money shown in dollars and cents, stored in cents; times shown America/Denver, stored UTC.
- The PR description carries the card's acceptance checklist with evidence and a "Self-review" (AI-PR-READ-FIRST).

## Batch A — Foundation (`designs/BATCH-A.md`)
- [x] Node 24.x in `package.json` and every CI job; CI runs check, unit, database and request-shape jobs on every PR with a
  single `ci` gate; a deliberately failing test turned it red once. — A-1, PR #1 (red-proof and green run linked there).
- [ ] Connector login with default account, allowed accounts, mode (preview unless the account has production enabled),
  profile and listing; lockout after 5 tries in 15 minutes; tokens stored hashed; a refresh keeps every setting.
- [ ] GitHub Apps created from manifests on the setup page; credentials stored only encrypted; nothing copied by hand;
  credential steps and production refused on non-production deployments; key-scan test passes.
- [ ] One GitHub client: pinned `2026-03-10`, Octokit encodes every path (audit G8), request keys and replay, write slots
  shared across instances, rate state honoured inside the time budget (audit G19, G20).
- [ ] OpenAPI description and GraphQL schema vendored with `SOURCE.md`; `scripts/openapi-find.mjs` and
  `scripts/graphql-find.mjs` answer in ≤20 lines.
- [ ] One-time-secret page works (shown once, then gone); App webhooks verified and narrow.
- [ ] `docs/DEPLOY.md` followable by Chris without a question.

## Batch B — Trust layer (`designs/BATCH-B.md`)
- [ ] `defineWrite` with target/classify hooks, preview first line in plain English, confirm, read-back, change log,
  request-key replay, inverse; the nine write-contract checks exist and run.
- [ ] Production guard (eight rules, failed read = production) and two-step production enable (tool + passphrase).
- [ ] Self-protection (`pr-only`, `locked`) seeded per IN-08 and edited only on the setup page; project ownership with
  `outsideProject` and a profile's `agentMay` steps.
- [ ] Access, message (own people per IN-13) and spend guards (monthly limit per account, default $0, IN-09).
- [ ] Plain-English GitHub errors (permissions header, rule violations, 404 "or no access", stale head); result shaping
  hides secrets and marks untrusted text; profiles and downscoped installation tokens.
- [ ] `check-writes` fails on undeclared writes, missing `dryRun`, missing price function, or a mismatch with TOOL-CATALOG.
- [ ] Server tools (B-8 rows of TOOL-CATALOG) built and marked.

## Batch C — Cheap on context (`designs/BATCH-C.md`)
- [ ] Summaries, `fields`, `detail`, text caps, handles (24 h, same connection only), annotations, structured output.
- [ ] Catalog and compact listing; meta-tools dispatch into the wrapped handlers, so every guard applies (write-contract
  through `github_call`).
- [ ] Budgets enforced in CI: compact <5,000 tokens, everyday catalog <22,000, descriptions ≤160 characters, schemas
  <1,500 tokens, default results ≤8 KB or a handle.

## Batch D — Repositories, code, branches and tags (`designs/BATCH-D.md`)
- [ ] Every D-1 … D-3 tool in TOOL-CATALOG built and marked `built #n`.
- [ ] No literal default branch (audit G4); file writes and ref moves are compare-and-swap; force moves previewed with
  the commits dropped.
- [ ] `docs/TOOLKIT-NAME-MAP.md` maps every prior name in `docs/audits/2026-10-10-prior-tools.md` §3 — 528: the old
  toolkit's 311 plus the other prior toolkits' names (a test counts them).

## Batch E — Pull requests, merges, stacks, reviews (`designs/BATCH-E.md`)
- [ ] Every E-1 … E-3 tool built and marked.
- [ ] Merges only at the exact head and only when every required check is green there (`src/github/ci-state.js`);
  merge commits by default; `bypass_rules` never sent (grep test over the fake-GitHub request log).
- [ ] Review threads listed, replied to and resolved (GraphQL validated); PR creation idempotent.

## Batch G — CI and delivery (`designs/BATCH-G.md`)
- [ ] Every G-1 … G-6 tool built and marked.
- [ ] Logs summarised server-side, never base64 (audit G5); dispatch returns the run; reruns bounded.
- [ ] Secret values never pass through a tool: setup page or server-generated, sealed, read back (audit G14's pattern).
- [ ] Releases, production environments and production deployments guarded; release assets fetched server-side from
  public HTTPS URLs only (audit G15).

## Batch V — Developer tools (`designs/BATCH-V.md`)
- [ ] Every `github_dev_*` tool refuses production (a test per tool); scratch repositories only in the scratch account.
- [ ] Runs record every created object; cleanup touches only recorded objects and reports per object.
- [ ] Dispatch-and-wait stays inside the time budget; simulated check runs; forwarded deliveries verify like real GitHub
  deliveries; private and metadata addresses refused.
- [ ] Integration check reports ok / missing with the exact tool call or guided steps.

## Batch F — Issues, labels, discussions, projects, search (`designs/BATCH-F.md`)
- [ ] Every F-1 … F-3 tool built and marked.
- [ ] Audit G7 (rows dropped after paging) and G18 (cannot clear a field) cannot recur (regression tests).
- [ ] Message guard on outsider mentions and assignees; user-owned projects explain the credential they need.

## Batch H — Governance and security (`designs/BATCH-H.md`)
- [ ] Every H-1 … H-4 tool built and marked.
- [ ] Protection and ruleset changes never drop other settings (audit G2, G3); bypass actors are access-widening.
- [ ] Webhook secrets server-generated and shown once (audit G14); deploy keys public only.
- [ ] Secret-scanning secrets never returned; paid security features on private repositories priced and spend-guarded.

## Batch O — Owner and administration (`designs/BATCH-O.md`)
- [ ] Admin overview well-formed (contract §9/§11): each item ok / needs_attention / not_readable / not_available_on_plan.
- [ ] Every settings page of a repository, an organization and the personal account in the dashboard map with structured
  steps; read-back wherever GitHub exposes the value; never reported done without it.
- [ ] Members, teams, roles, apps, tokens, billing, Copilot, Codespaces, personal account and notifications tools built;
  owner changes confirmed and logged; spend guarded; prices recorded with source and date.

## Batch P — Project profiles (`designs/BATCH-P.md`)
- [ ] `known_projects` with the Appliance Desk and Robinson-server profiles, each item traceable to the project's files.
- [ ] Production guard and project ownership read profiles and name the owning workflow; `agentMay` steps honoured.
- [ ] `github_workflow_app_readiness` covers every row G1–G20 of `docs/APP-NEEDS-APPLIANCE-DESK.md` and works with an
  inline spec; fixes previewed and confirmed; never edits a project's workflow files or moves an owned ref.
- [ ] `github_workflow_project_setup` for new projects, idempotent; `github_profile_draft` from codebase findings.

## Batch W — Workflows (`designs/BATCH-W.md`)
- [ ] All W-1 … W-7 workflows built; merge on green exactly as W3; stacks as W4.
- [ ] Review threads verified at the current head before resolving.
- [ ] No waiting loops; the 50-second budget is respected (a test per workflow); second automatic rerun refused.
- [ ] All writes confirmed and logged (write-contract via `github_call` for each write workflow); branch cleanup by PR
  state (audit G16).

## Batch U — Universal tools (`designs/BATCH-U.md`)
- [ ] Six tools; every request validated against the vendored description or schema; unknown → refused in words.
- [ ] Classification tables with the safe default for unclassified operations and mutations; hand-built tools win;
  `bypass_rules` and secret writes refused.
- [ ] Same guards as hand-built tools (write-contract through `github_api_write` and `github_graphql_write`).

## Batch R — Hub-ready doors, RTC 1 (`designs/BATCH-R.md`)
- [ ] Passes per RTC §2 with narrow defaults; production + writes needs the passphrase.
- [ ] HTTPS tool API, manifest and OpenAPI per RTC §1/§7; same nine checks through MCP, `github_call` and HTTPS.
- [ ] Per-pass rate limit stored per pass and counted in Postgres (overlapping-request test across two instances).
- [ ] RTC 1 conformance green in CI once the hub's package exists (never a blocker before).

## Batch X — Undo, smoke test, toolkit decision (`designs/BATCH-X.md`)
- [ ] Undo for every clean opposite (audit G17 fixed); every other change says what the right opposite is.
- [ ] Read-only smoke report on the real accounts (`docs/audits/smoke-<date>.md`), preview read-only connection, no write.
- [ ] Toolkit decision note delivered to Chris (IN-14).
