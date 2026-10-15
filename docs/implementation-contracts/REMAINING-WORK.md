# Remaining work — edit maps, implementation sequence and regression anchors

Baseline `ed60e19` (2026-10-11), 41 non-merged work-index units. This is a navigation map, **not the queue or
41 prewritten cards**. STATUS/index and actual GitHub state determine eligibility. Each unit retains its own
approved BATCH design and PLAN acceptance; write only the current JIT card and eligible immediate successor.

All **new paths below are proposed**, even when listed without “new”; inspect current code before adopting
them. Test filenames are proposed unless explicitly called an existing anchor. Tool names, credential,
audience, profiles and safety declarations come from TOOL-CATALOG, not module naming. Use TOOL-RECIPES for
shared contracts. Rows name high-value domain regressions **in addition to** shared safety and shape checks.

## E and G — finish the build conveyor

### E-2 — exact-head merge and stacks (in flight at inspection: #46)

- Reuse existing `src/github/ci-state.js`, pulls read/write modules and production/protection guards; inspect
  #46's actual card/exports first. Do not create a competing card or duplicate merge helper.
- Remaining stack work: model ordered head/base relationships, then retarget, wait for fresh checks, merge
  bottom-up into the actual default branch. Record which operation owns each expected SHA and replay key.
- Tests: moved head after preview; optional green vs required missing; retarget invalidates CI; refusal in
  draft/unknown state; partial stack completion resumes without merging into parent branches. Never bypass rules.

### G-3 — sealed secrets (in flight at inspection: #45)

- Preserve #45's card/status. Reconcile after it lands; reuse its exact setup-page/secret-store exports later.
  Existing anchors: variables module, setup-page/one-time-secret flow, fake/real db shared contracts.
- Acceptance proof includes real fixture-key seal/decrypt, atomic one-use entry, names/dates read-back,
  production/access classification, no secret argument/output/log/undo. Do not copy a secret value into a packet.

### G-4 — environments and deployments

- Use [G-4-PACKET](G-4-PACKET.md); environments/deployments modules → registry → summaries and shapes.
- Build normalization/reads, then preserved settings writes, then deployment/status operations. Split by risk
  and actual size, not by arbitrary test count. No new SQL expected.
- Tests: preserved reviewers/wait timer, clear-vs-omit, separate policy endpoints, actual deployment target,
  failed classification read, 202 semantics, mismatch and compound partial failure.

### G-5 — releases

- Proposed `src/tools/releases.js`, `src/github/public-url.js` (shared URL policy only when first needed),
  `tests/unit/releases.test.js` + URL-policy tests. Reuse branch/tag classification and result shaping.
- Sequence: release reads/generate notes; draft create/update/publish/delete; asset metadata/upload/delete.
  Upload uses returned upload_url via the allowed client route, streamed fetch with byte/time cap.
- Tests: draft defaults; publication notifies and is production; immutable release refusal; tag/ref scope;
  private-IP/redirect/oversize source refusal; no bytes in chat; draft vs published asset-delete classification.
  Reconcile any difference between G7's draft rules and existing release-kind guard in the card before coding.

### G-6 — Pages and packages

- Proposed `src/tools/pages.js`, `src/tools/packages.js`, paired unit/shapes files. Separate org/user path
  builders; resolve owner type/credential explicitly. Reuse repo settings and visibility patterns.
- Sequence: reads; Pages save/disable; version/package delete/restore with clean ID/name translation.
- Tests: public exposure from private repo needs access confirmation; whole-package preview counts versions;
  >5,000-download restriction, 30-day restore explanation, permission error not absence, encoded package name.

## V — development runs

### V-1 — runs, scratch repositories and scenarios

- Proposed `src/dev/scenarios.js`, `src/tools/dev-runs.js`; additive dev_runs/dev_run_objects methods in
  db + fake + `test/contract/dev-runs-contract.js`. Reuse wrapped repo/branch/PR tools, not their apply hooks.
- Sequence: ledger scoped to connection/account; declarative scenario object plan; deterministic previews;
  seed execution with per-object recording/tagging. Author card's failure/recovery contract before compound seed.
- Tests: every scenario's exact object plan; scratch-only repo creation; production refusal per tool; duplicate
  request key; created object recorded even on later failure; two workers claiming same intent. IN-06 stays a real-use gate.

### V-2 — cleanup

- Proposed `src/dev/cleanup.js`, `src/tools/dev-cleanup.js`, `tests/unit/dev-cleanup.test.js`;
  inherit actual V-1 ledger exports. Build a recorded-object plan first, then cleanup/report/resume.
- Tests: look-alike not recorded remains untouched; non-scratch repo never deleted; dependencies closed/deleted
  in safe order; failure reported per object; repeat cleanup touches only unfinished items; scoped all-runs.

### V-3 — test refs, PRs and CI

- Proposed `src/tools/dev-ci.js`; existing anchors: branches, pulls-write, actions-write, checks-write and
  `src/github/ci-state.js`. Record run ownership before allowing branch/commit/check targets.
- Sequence: run-owned ref validation; draft PR; dispatch ID; bounded wait returning pending/handle; simulated check.
- Tests: other run's SHA refused; production dispatch refused; rtc/run naming; 45-second boundary with injected
  clock; App-only check fixture; resume reads existing run instead of dispatching again.

### V-4 — forwarders

- Proposed `src/dev/forwarders.js`, `src/tools/dev-forwarders.js`, shared URL policy from G-5 if built;
  additive forwarder store + shared fake/real contract; existing crypto and one-time-secret helpers.
- Sequence: encrypted store/create/delete; one-time setup display; delivery fetch; signed forwarding/report.
- Tests: signature verified by @octokit/webhooks; original event + fresh delivery ID; secret never in result;
  cross-account/run refusal; redirects/DNS/private ranges; target timeout; partial report and production refusal.

### V-5 — integration check

- Proposed `src/tools/dev-integration.js`; compose reads from diagnostics, variables/secrets, actions, CI,
  environments. Build spec validator → per-item check → exact fix suggestion; this tool performs no fixes.
- Tests: permission/workflow/check/secret/environment each ok/missing; absent credential explained; no write
  requests in trace; exact named tools in suggestions exist; unresolved plan/permission read is not an ok result.

## F — issues and planning

### F-1 — issues

- Proposed `src/tools/issues-read.js`, `issues-write.js`; reuse reviews' GraphQL and people-guard patterns.
  Sequence: summaries/paging; create/update/comments; labels/assignees; sub-issues/dependencies/transfer/reactions.
- Tests: PR filtering fills requested issue page or reports exhaustion/cap; omitted vs empty body/labels;
  outsider mentions/assignments; issue number vs ID; validated transfer mutation; repeated create/no duplicate.

### F-2 — labels and milestones

- Proposed `src/tools/labels.js`, `milestones.js`; sync plan separated from application and per-repo outcomes.
  Sequence: CRUD; sync dry-run; confirmed compound execution.
- Tests: exact six-hex color; rename/old name read-back; no deletion unless deleteOthers + confirm;
  unchanged labels not rewritten; empty desired set; second repo fails while first succeeds; rerun reconciles.

### F-3 — discussions, Projects v2 and search

- Proposed `src/tools/discussions.js`, `projects.js`, `search.js`; use explicit GraphQL variables and cursor
  paging; org/user owner selection before token acquisition. Separate files/slices by request family.
- Tests: discussion answer node IDs; project typed field value/clear; user-owner credential guidance;
  each search type maps to correct REST route; code fragments capped; empty/null nodes and incomplete paging.

## H — governance and security

### H-1 — protection and rulesets

- Proposed `src/tools/protection.js`, `rulesets.js`; TOOL-RECIPES §5; anchor ci-state required-check reads.
  Build writable normalizers and previews, then full protection PUT, dedicated checks patch, ruleset CRUD/history.
- Tests: one key changed keeps all others; explicit conversation-resolution false; four required PUT keys;
  bypass actor addition widens access; unknown before-state prevents destructive replacement; inverse fidelity.

### H-2 — webhooks

- Proposed `src/tools/webhooks.js`; inherit URL validation from G-5/V-4, crypto, one-time-secret page and
  actual forwarder code. Sequence: metadata/delivery reads; secret-generating save/rotation; ping/redelivery/delete.
- Tests: no secret input schema; generated secret shown only once; request body/redirect URL validation;
  redelivery production classification; delivery payload cap/handle; masked GET secret is never replayed as value.

### H-3 — collaborators and deploy keys

- Proposed `src/tools/collaborators.js`, `deploykeys.js`; reuse people/production/protection guards.
  Sequence: current permissions/invitations; add/change/remove; public-key CRUD.
- Tests: permission before→after; outsider notification; write key production/access change; pasted private key
  refused without echo; no installation expansion; current permission read failure is not “no access”.

### H-4 — alerts, security features and Actions settings

- Proposed `src/tools/security.js`, `actions-settings.js`; `src/github/prices.js` for verified price data.
  Sequence: safe summaries/read-only alerts; dismissal with reason; plan-priced feature writes; settings merge.
- Tests: secret field removed before storage/handle; private paid vs public free; $0 refusal; reason required;
  unrelated Actions settings preserved; dependency compare PR resolves base...head; plan-limited 403 explained.
  Price verification remains required before priced changes are enabled; no invented price fallback.

## O — owner administration

### O-1 — overview and guided settings

- Extend existing `src/data/dashboard-map.js` and diagnostics; proposed `src/tools/admin.js`.
  Sequence: dated coverage map; structured steps; per-item overview; read-back setting verifier.
- Tests: Free/Team/personal fixtures yield ok/needs_attention/not_readable/not_available_on_plan;
  every verifyWith names registered read tool + field; one denied section does not fake success or lose others.

### O-2 — organization and members

- Proposed `src/tools/organizations.js`, `members.js`; reuse people/production/spend boundaries.
  Sequence: org/membership reads; settings; invite/remove/role updates with loss/access preview.
- Tests: promotion widens; invite role/team IDs and notification; removal names lost access; default repo
  permission widening; pending invitation read-back; org settings unrelated values retained.

### O-3 — teams and roles

- Proposed `src/tools/teams.js`, `roles.js`; org-scoped target; explicit membership/repo-permission before-state.
  Sequence: reads; team mutations; repo access; role assignment/plan-dependent custom roles.
- Tests: before/after permission; parent/team scope; role widening; custom role unavailable on plan explained;
  deletion does not report a clean inverse when memberships cannot be restored faithfully.

### O-4 — billing, budgets, Copilot and Codespaces

- Proposed `src/tools/billing.js`, `copilot.js`, `codespaces.js`; update prices with official source/date first.
  Sequence: usage/price reads; budgets; seat operations; codespace lifecycle; confirmed spend variants.
- Tests: integer cents/display; increased/removed budget is spend; lower cost not blocked by spend limit;
  overlap per-account accounting; missing price fails closed; user/org scope and token choice per operation.
  All paid requests remain fake in implementation tests; no seats/resources actually purchased.

### O-5 — Apps and tokens

- Proposed `src/tools/apps.js`, `tokens.js`; reuse protected installation guard and credential diagnostics.
  Sequence: metadata/requests; repo access changes; approval/revocation. Never accept or expose token bytes.
- Tests: own locked installation repo removal refused; approval widens access; expired/pending states;
  identifier authorization; metadata result/handles cannot contain token or key material.

### O-6 — personal account

- Proposed `src/tools/user.js`; explicit U client for every operation. Sequence: settings/read metadata;
  profile changes; email/public SSH/GPG key/block/invitation operations per catalog.
- Tests: no U credential → exact setup instruction; adding email notifies; private-key input never echoed;
  explicit clearing; real before/after account scope; state-changing operations production-confirmed.

### O-7 — notifications and gists

- Proposed `src/tools/notifications.js`, `gists.js`; K for notifications, credential per catalog for gists.
  Sequence: reads/cursors; notification state; gist create/update/delete with visibility classification.
- Tests: missing K guidance; private→public access widening; gist content caps; omitted/removed files;
  unread/read read-back; empty and paged collections.

## P and W — profiles and composed workflows

### P-1 — known projects and guard integration

- Proposed `src/data/profile-schema.js`, `src/tools/profiles.js`; additive known_projects store/fake/contract;
  integrate actual production/protection gates. Seeds trace to APP-NEEDS rows; profile is data, never code.
- Tests: live production; owned transfer ref names workflow; outsideProject still confirmed/guarded;
  absent profile no extra restriction; scoped stored profile; overlapping updates and seed idempotency.

### P-2 — app readiness

- Proposed `src/tools/app-readiness.js`; same validator for stored/inline specs, compose reads and guarded fixes.
  Sequence: G1–G20 observation matrix; guided rows; confirmed allowed fixes + independent read-back.
- Tests: every APP-NEEDS row; missing ci ruleset fix; reported unsafe workflow never edited;
  not_readable ≠ done; inline parity; paid fix still spend-guarded; partial fix report.

### P-3 — project setup and profile draft

- Proposed `src/tools/project-setup.js`; reuse repo/ruleset/labels/environment wrappers and profile schema.
  Sequence: desired-state plan; idempotent confirmed setup; draft profile/doc text.
- Tests: second run creates nothing; nonempty existing repo not treated as new; unknown findings reported;
  no workflow edits/ref moves; no file committed in another repo; interrupted setup resumes safely.

### W-1 — PR status/open

- Proposed `src/tools/workflows-pr.js`; compose pulls, reviews and ci-state. Reads first, then idempotent open.
- Tests: exact head with required/optional/missing checks; open thread/stack position; actionable next sentence;
  existing PR returned; outsider body mention needs confirm; time cap and partial-read caveat.

### W-2 — merge when green/stack

- Extend workflows-pr using actual E-2 wrapped helpers; do not recreate a weaker merge path.
- Tests: each merge refusal; fresh head after retarget pending; bottom-up/main target; timeout returns next
  action; no second mutation after uncertain result; replay completed stack steps and current profiles/guards.

### W-3 — review threads

- Proposed `src/tools/workflows-review.js`; reuse review query/reply/resolve wrappers; dispositions tied to head.
- Tests: stale head invalidates disposition; outsider content untrusted; one preview/confirm; resolve only
  verified dispositions; deleted/outdated/moved threads; partial completion reported without claiming all fixed.

### W-4 — CI failure summary and one rerun

- Proposed `src/tools/workflows-ci.js`; anchors actions-read/write and log-summary; stored attempt evidence.
- Tests: failure signature vs default branch; changed attempt; second automatic rerun refused; multi-job
  errors collected; clock budget; pending run resumed without another rerun; mutation remains guarded.

### W-5 — health/security/access review

- Proposed `src/tools/workflows-health.js`; reuse O overview and H reads; no implicit repairs.
- Tests: safe/attention/plan-unavailable cases; broad pagination/cap reported; no write trace; missing protection
  reported; cannot-read finding distinct from clean; 50-second budget.

### W-6 — release and branch cleanup

- Proposed `src/tools/workflows-release.js`; G-5 release wrapper; actual branch/ref/profile guard helpers.
- Tests: draft then confirmed publish; cleanup by merged/closed PR state (not merely name); protected/default/
  owned ref excluded; stale ref refusal; partial cleanup; release failure never triggers duplicate publication.

### W-7 — new repo/find/digest

- Proposed `src/tools/workflows-find.js`; repo/project-setup wrappers; search, runs, releases, commits reads.
- Tests: idempotent new repo; mixed object summaries and paging; empty result; cents display/Denver dates;
  time-budget partial result; no writes from find/digest; outsider/new-account scope remains guarded.

## U, R and X — universal operations, standalone doors and close-out

### U-1 — REST universal tools

- Design-named files: `src/tools/universal.js`, `src/github/openapi-index.js`, `operation-classes.js`,
  `hand-built-map.js`. Build compact index/validation first, then curated-operation refusal and classification.
- Tests: 25 GET + 10 write shape cases; unknown operation/parameter/body; curated merge cannot be bypassed;
  unclassified write safe-default; token/secret/bypass request refusal; priced operation needs estimate;
  guards and replay through all doors. Do not ship full vendor schemas in tools/list.

### U-2 — GraphQL universal tools

- Design-named `src/tools/universal-graphql.js`, `src/github/mutation-classes.js`; reuse schema validation.
  Sequence: parse/validate/query cost; read; single classified mutation; curated mutation refusal.
- Tests: mutation hidden by operation name/fragment refused in read; multiple mutations refused; aliases;
  500-point/500,000-node limits; enqueue classification; mergePullRequest routes to curated merge;
  unknown mutation guards; nested input secret refusal; schema-valid ≠ policy-safe.

### R-1 — passes

- Proposed `src/core/passes.js`, GitHub tool/setup adapter; extend oauth_tokens store, fake and shared contract.
  Sequence: constraints/store; one-time issue/revoke/expire; auth propagation/downscope/refresh.
- Tests: narrower account/repo/area/flags honored through github_call; production+write passphrase step;
  lifetime limits; expired/revoked errors; stored settings survive refresh; no raw pass in chat. IN-10 retained.

### R-2 — HTTPS doors, manifest and shared limiter

- Proposed `src/core/tool-http.js`, `src/core/pass-rate.js`, `api/tools/`/results/whoami/contract adapters.
  Reuse createDispatch/result store; add HTTP door to shared contract, not another execution engine.
- Tests: pass-only auth (connector token refused); ≤30-operation OpenAPI/registry counts; same write guards;
  two handler instances with 150 simultaneous requests: 120 allowed, rest 429; limit 5 sixth refused;
  window cleanup; refresh cannot widen pass. One atomic SQL counter, no read-then-increment.

### R-3 — RTC conformance

- Inspect hub conformance package availability read-only; pin actual source/version if it exists. CI local
  server uses fake transport. No dependency on hub availability at server startup or standalone execution.
- Evidence: actual conformance output, all-door safety tests and exact-head ci. If unavailable, record what
  own tests cover and the remaining dependency honestly; do not manufacture a passing external package run.

### X-1 — undo

- Proposed `src/tools/undo.js`; scoped change lookup and inverse dispatched through existing wrapped tools.
  Sequence: inverse inventory; preview/confirm dispatch; negative explanations; undo-of-undo.
- Tests: every promised clean opposite; stale resource refuses; unauthorized change ID; no inverse merge
  suggests revert PR; production still guarded; secret absent; inverse replay cannot double-apply.

### X-2 — real-account read-only smoke

- Design-named `scripts/smoke-readonly.mjs`; generated dated audit. Inspect actual registered read tools,
  supply operation-specific minimal arguments; deny mutation at transport boundary as defense in depth.
- Test runner with fake first: wrong mode/profile, write registration and request refused; permission and
  plan gaps reported. Actual run waits for IN-04/IN-05 and owner scope; no real credential copied into repo/logs.
  Report pass/fail per tool, request IDs and gaps with owner cards; never repair a real repository in smoke.


## Concrete implementation contracts — owner-requested review, October 14, 2026

The owner requested the same implementation detail across all six active MCP
repositories, specifically for Sol 5.6. This section fills routine design details
inside the approved roadmap. It is a design supplement, not another roadmap,
process, new countable subsection or claim that code/acceptance is complete.
Existing cards/public schemas and later owner decisions win over historical
recipes; reconcile mechanical drift with current main before coding. Do not
replace working code simply because a proposed filename below differs.

### Shared input, state and result contract

- Freeze the existing subsection IDs and complete scope first. In the current
  card, list each public tool from TOOL-CATALOG, its exact schema, the existing
  wrapped handler/client export and the corresponding provider operation. A
  future path below is proposed until it exists. Build the complete coherent
  outcome; do not publish one helper as a completed subsection.
- Keep public ABI compatibility. For new compound implementations use an internal
  plan `{operation, account, mode, target, steps}`. Each ordered step has a stable
  `id`, exact wrapped `tool`, validated `args`, before-state requirements,
  intended after predicate and inverse-or-reason. Account/mode come from trusted
  context, never caller-supplied credentials. Translate these internal records
  into the existing public tool schema; do not invent a second external envelope.
- Explicit IDs beat free-text guesses. Resolve friendly names with authorized
  reads; zero matches is missing, multiple matches requires disambiguation.
  Reject unknown fields/enums and conflicting targets before dispatch. Omitted
  means retain; explicit empty/false/null clears only where the provider supports
  that operation. Whitelist path/query/body fields; never forward local safety,
  pagination/presentation or request-key arguments into provider payloads.
- A new workflow's observable details use ordered per-step rows with stable IDs,
  target, outcome, safe reason and provider/audit references when actually known.
  Outcomes distinguish `planned`, `refused`, `confirmed`, `unverified`, `failed`,
  `unknown` and `not_attempted`. Aggregate success requires every required step
  to be confirmed; optional unavailable items remain explicitly unavailable.
  An HTTP 200/202/204 or an outer `done:true` alone is never provider confirmation.
- Preview validates the entire plan and uses child `dryRun:true`; provider writes
  are zero. Existing preview audit logging is allowed. Execution requires the
  original operation-specific confirmation/owner authority; a single workflow
  confirm never creates financial, access or production authority. Recheck
  mutable target/protection/account state before each dependent write.
- Execute dependent steps in order. Persist existing run/replay checkpoints
  before/after ambiguous effects where the approved design requires durability.
  A failed dependent step stops its descendants; untouched rows are
  `not_attempted`. Independent read sections can continue and return partial
  coverage. No blind retry after an uncertain POST, no automatic rollback and
  no new background scheduler merely to finish a synchronous workflow.
- If a request times out after dispatch, mark its outcome unknown and reconcile
  the original target/request key before resuming. Reuse the service's replay
  mechanism; a second generic UUID is not recovery. Explicit undo only follows
  recorded, still-valid inverses through wrapped tools and fresh guards.
- Bound existing time/page/byte budgets, return an explicit continuation where
  supported and use connection-owned result handles. A cursor/handle is bound
  to account, connection/grant and query; expired/revoked/foreign ones refuse.
  Do not silently truncate and label the result complete.

### Build and prove one complete outcome

1. Read the exact provider operation in the pinned SDK/OpenAPI/GraphQL fixture;
   capture argument → path/query/body → response selector and credential type in
   the current card. Research genuinely changed provider behavior in official
   primary documentation. The owner is not the source for API facts or pricing.
2. Implement normalization/planning, then wrapped apply/readback/intent comparison,
   then all callers, registry, profile/area metadata, summary/output schema and
   documentation. Reuse existing shared guards, clients, secrets and run stores.
   Add SQL only when the existing design actually needs durable new state.
3. Arrange stateful realistic fakes and capture the actual outbound request.
   Required cases: normal/empty/two pages; denied scope/profile/account; omitted
   versus explicit clearing; preview and missing confirmation with zero writes;
   mismatch/unreadable readback; ambiguous timeout and same-key retry; partial
   failure plus untouched descendants; foreign run/handle; budget exhaustion.
   Add the domain-specific cases below. Do not weaken fakes to fit a guessed API.
4. Validate the assembled outcome through every existing direct/broker/HTTP door
   with shared write-contract and provider-shape tests; use disposable Postgres
   for persistence, atomic claims, refresh/revocation and concurrent reservations.
   Run focused checks at meaningful seams, then the full mandatory gates once
   the coherent tree is ready. Record real command results, never assumed green.
5. Keep implementation, automated verification, deployed exact revision and real
   custom-service/provider acceptance separate. Update the existing card/status/
   queue with precise remaining proof. These design documents close no feature
   status and authorize no real account writes, spending or release.

Answered decisions do not require another approval. Missing credentials, actual
tenant/resource identity, independent financial consent and production activation
are still real gates. Build configurable/synthetic paths where permitted; keep
only their dependent execution closed and continue eligible roadmap work.


### GitHub: current contracts by remaining approved subsection

Inspected baseline: `f87eb4b` (#200). Reuse `src/github/client.js`,
`src/github/credentials.js`, `src/github/ci-state.js`, `src/github/public-url.js`,
`src/tools/github-write.js`, `src/tools/protect-guard.js`, `src/tools/index.js`
and existing secret/setup/replay primitives. Existing domain modules supersede
old proposed filenames in the historical map above. Add new area/workflow files
under `src/tools/` only when the matching area is genuinely missing.

| Subsection | Concrete state contract and implementation sequence | Domain fixture / forbidden effect |
| --- | --- | --- |
| V-1 | Explicit scenario/account/runId/requestKey → scratch classification → durable claim → exact object plan → guarded child creation → record every provider ID. Existing scenario blueprints/claims are authoritative; no name-based ownership. | Duplicate worker claims, timeout after create, labels auto-created by GitHub; quarantined uncertainty remains unresolved rather than deleted. |
| V-2 | Owned runId → full original object ledger plus fresh scratch/foreign-object reads → ordered child-before-parent cleanup → per-object done/already-gone/refused/unknown. | Unknown provider labels block whole-repo deletion as designed; look-alikes untouched; no second owner cleanup confirmation inferred from plan approval. |
| V-3 | Owned run and exact ref/SHA → fixture branch/commit, draft PR, explicit workflow dispatch/check run using existing actions/check helpers. Return dispatch correlation and bounded pending state. | App-only checks refuse wrong credential; foreign SHA and production dispatch denied; resumed wait never dispatches again. |
| V-4 | Owned endpoint/run and private pending secret entry → public HTTPS pinned forwarder, exact original delivery/body signature, bounded send and receipt. Never construct invented GitHub delivery proof. | Private/DNS-rebinding target, redirect, cross-run delivery, malformed signature, lost POST and secret sentinel in handle/audit. |
| V-5 | Typed spec of repo/workflow/permissions/checks/secrets-name/environment requirements → independent guarded reads → per-item observed/missing/unreadable plus exact remediation tool or manual step. | Missing credential or plan-limited response is not missing resource; zero writes in full trace. |
| H-2 | Exact repo/hook ID + whitelisted config/events → fresh before-read and diff; masked existing secret omitted unless an explicit secure rotation consumes new input. Ping/redelivery are separate effects. | Secret rotation one-time delivery, events retained, URL policy before dispatch; delivery payload bounded; no masked secret replay. |
| H-3 | Repo/user/key ID and explicit permission → read current permission/invitation/key → access-change preview → guarded add/update/remove → exact readback. | Own protected installation, outsider invite, write deploy key and pasted private key; denied permission read never becomes none. |
| H-4 | Exact repo/security feature/alert/Actions setting and disposition reason → plan/permission-aware reads → preserved full payload for only requested settings. | Private-plan 403 recorded as limitation; never auto-upgrade. Zero spending authority, price unknown, unsafe token default and unrelated setting preservation. |
| O-1 | Overview/readback query → independent org/repo/account sections and dated dashboard map. VerifyWith is a registered exact read and field predicate, not an arbitrary tool call. | Partial plan/access failures survive as unreadable/unavailable; full-page walk cannot be inferred from a topic count. |
| O-3 | Org/team slug/role ID, subject and explicit rights → trusted team/role/member reads → before/after permission set and loss preview → correct I/U credential → readback. | Parent mismatch, custom role unavailable on plan, last-owner/self-lockout refusal, uncertain invite/delete. Finish the whole remaining team/role catalog, not one endpoint. |
| O-4 | Org/user and billing window/seat/budget/codespace action → credential and verified price/cost classification → per-action preview and current spend rules. Read totals remain independent of paid mutation availability. | Unknown price/refused scope, seat increase versus decrease, removed budget, concurrent spend reservation; no actual purchase during implementation. |
| O-5 | App installation/request/token metadata ID → independent owner authorization and protected-installation check → exact requested repository/permission delta. Secret/token bytes are never inputs or outputs. | Revoking the server's own required installation refused; pending/expired/foreign request; unknown repo set not treated empty. |
| O-6 | Explicit authenticated user and whitelisted profile/email/public-key/block/invitation action → U credential only → before-state/notification/access preview → readback. | No U credential gives setup steps; private-key bytes refused without echo; clear versus omit; self-lockout and outsider notification. |
| O-7 | Notifications use optional K credential only; gist owner/file IDs use applicable existing credentials. Return safe metadata, capped untrusted content and exact read/unread or visibility intent. | Missing notifications token disables only that path; no App-token fallback. Gist public visibility needs access confirmation; binary/private content and pagination bounded. |
| P-1 | Validated project profile from APP-NEEDS with explicit repo/ref/check/owned-path settings → stored draft/active data; existing app/protection guard consumes every active applicable profile. | Default and protected branch plus profile live refs; conflicting two profiles; private IDs entered securely; no draft silently grants write. |
| P-2 | Profile or inline requirements → read-only readiness across repo/rules/checks/Actions/env/secrets-name and owner choices → exact per-item evidence/remediation. | Required check absent at current SHA, denied secret-name read, old run, incomplete pages; zero fixes during inspection. |
| P-3 | Structured setup findings → draft profile and plan for guarded repo settings/rules/labels/variables; no codebase fetch or unsolicited changes to other repos. | Idempotent second run; missing required primitive implemented first; ambiguous owner stays unresolved; actual profile activation remains explicit. |
| W-1 | Exact repo/PR or head/base → current head, checks/reviews/mergeability/stack status. Open returns existing matching PR or creates one through guarded tool. | Head moved, duplicate open, outsider mentions, draft/unknown state and required versus optional checks. |
| W-2 | PR plus expectedHeadSha or ordered stack → trusted checks at exact head, unresolved-review disposition verification, retarget to real default branch, fresh CI, expected-head merge commit. | No loop; retarget returns pending until fresh CI; moved head, missing check, required review and parent-branch merge all refuse. |
| W-3 | PR and optional thread dispositions → fetch current head/thread context, verify reason, preview reply/resolve, apply once with fresh head check. | Outsider comment text is untrusted data; changed unrelated line does not prove fix; stale/already-resolved thread not duplicated. |
| W-4 | PR/run/ref → failed steps/annotations and baseline comparison; rerun uses durable head+job claim and only existing failed-job rerun path. | Same head/job cannot automatically rerun twice; unknown log is unreadable, not guessed root cause; request-shape fixture. |
| W-5 | Explicit repo/org selection → independent health/security/access reads with provider plan limits and coverage. | More than one page, inaccessible section, unsafe defaults; no automatic policy repair. |
| W-6 | Release: exact repo/tag/version request → draft notes and release first; publish requires actual production authority. Cleanup: recorded PR head equality and closed/merged state before exact branch deletion. | Protected/default/owned branch, newer commit, open PR, immutable release, publication not authorized by draft preview. |
| W-7 | New repo spec → private/main/merge-commit/guarded rules plan and idempotent reconcile; find/digest explicit kinds/date window with bounded reads. | Private plan lacks protection: report limitation, no paid upgrade or false complete; digest never schedules itself. |
| U-1 | Exact REST operationId + validated path/query/body → native mapping when one exists; otherwise complete credential/safety/production/access/spend policy → request → readback. | Universal cannot bypass protected repo/own App/money/secret rules; unclassified write fails closed; exact pinned fake validates request. |
| U-2 | Parsed GraphQL operation and typed variables → read/mutation classification and explicit resource/permission mapping, never substring-only mutation detection. | Aliases/fragments/multiple operations, unknown mutation/node IDs and secret response; schema+credential proof before exposure. |
| R-1 | Reconcile current OAuth/pass implementation; trusted account/mode/profile/areas/expiry settings survive refresh; narrow pass and revoke metadata only in public results. | Database atomic one-use/expiry/revocation; no broadening from missing refresh field; default-rate owner choice remains independently recorded. |
| R-2 | Existing direct RTC doors dispatch through the same wrapped registry; exact aliases/envelopes and shared SQL limits/owned results; no raw provider bypass. | Overlapping two-instance calls admit exactly configured quota; foreign handles and revoked pass denied; connector token cannot pretend to be RTC pass. |
| R-3 | Pinned full service HTTP conformance with fake GitHub plus request-shape tests; actual direct/Hub/relay/Sandbox proof remains separately queued. | Broken refresh/denial/pagination fixture fails; standard GitHub connector is never this service's acceptance. |
| X-1 | Owned immutable log ID and recorded reversible inverse → current-state check → wrapped undo; metadata restore preserves exact omitted/clear semantics. | Changed-after-write, irreversible invite/send/delete or incomplete inverse refuse; undo-of-undo and foreign ID. |
| X-2 | Explicit consented read-only identity and original exact test IDs → native custom-service reads at independently verified deployment; output pass/gap/limitation for every selected tool. | Real plan403 is provider limitation, not code failure or PASS; no mutation, invented resources or upgrade. |

### Exact merge-workflow example (synthetic identifiers)

```json
{"pr":17,"expectedHeadSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
```

Bind the repository from the existing public schema/connection, not a guessed
default. Read required checks at that SHA, thread state and mergeability; when a
required check is pending, return a safe pending result with that exact head and
check/run reference and send **zero** merge requests. Later calls re-read all
guards. A green check at a different head cannot satisfy it. Shared E-2 helpers
already implement substantial parts: W-2 composes them, not a second merge policy.

### GitHub remaining decisions

IN-00 already approves implementation. IN-08 protected-repository selections,
IN-09 spending ceiling, IN-10 pass-rate defaults, IN-12 production-name list and
IN-13 own-people policy must be reconciled against recorded later decisions and
actual saved settings; historical Awaiting text is not proof no answer exists.
If genuinely missing, keep its dependent action closed with a specific IN ID;
do not invent owner approval. Optional notifications credential IN-11 and
production activation IN-07 are execution gates, not another plan review.
The owner-requested design work changes none of these decisions.
