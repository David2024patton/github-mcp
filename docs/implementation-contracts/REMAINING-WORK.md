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
