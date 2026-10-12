# STATUS — current work, blockers and next action

Updated 2026-10-12. **The foundation is built (A-1, PR #1), its database schema exists (A-2, PR #7), the connector login is built (A-3a, PR #8; A-3b, PR #9) the GitHub client exists (A-4, PR #10) the encrypted credential store exists (A-5a, PR #11) and the private setup page exists (A-5b, PR #12) the App webhook and first two tools exist (A-5c, PR #13) the deployment guide is written (A-6, PR #15) the write safety layer exists (B-1, PR #16) the production guard with the two-step production switch exists (B-2, PR #18) the protected list with project ownership exists (B-3, PR #19) the people and spend guards exist (B-4, PR #20) plain-English errors with result shaping exist (B-5, PR #21) and profiles with downscoped tokens exist (B-6, PR #22):** Node 24
package with a committed lockfile, a fake GitHub for tests, the check scripts, throwaway-Postgres database tests, CI with
required GitHub Actions `ci` and `release-policy` merge gates, `src/db.js` creating the 13 foundation tables plus the owner settings table and storing connector logins, the OAuth endpoints and `/api/mcp` (two read-only tools, `github_whoami` and `github_list_accounts`), and `src/github/client.js` (pinned API version, request keys, write spacing, rate blocks, ETag cache) with GitHub's REST and GraphQL descriptions vendored, and `src/github/credentials.js` (encrypted Apps, installation tokens, user authorization, pasted tokens) with one-time secrets. Two read-only tools were the initial baseline. The actual server is now deployed to Vercel with an isolated Neon database and encrypted environment configuration; the custom scratch App was installed; owner-designated setup is complete, but connected acceptance remains pending. Nothing here authorizes changes to Chris's real repositories.

## Next

- **Current #122 — finite V-1 scenario resources (as-if-merged; exact-head CI pending):** In private-scratch cleanup, enforce one executable scenario and a strict maximum count for each planned object type. Partially seeded runs remain eligible for guarded reconciliation, but unplanned types, duplicates in excess of scenario bounds and plan-only webhook resources cannot become deletion authority merely through journal entries. Shares the seed executor allowlist, includes no-mutation regression. #121 safely merged at 673da81823d950f4f51bac93bd9aaf47032131a6; final main CI verification follows.

- **#121 — V-2 reverse inventory proof (MERGED; exact-head CI verified):** The scratch cleanup preflight checks every recorded branch, PR, issue, tag, release and ruleset against the complete independent remote inventory, in addition to prior listed-to-journal checks. Missing or ambiguous records refuse deletion on both preflights; fake adversarial regressions. #120 final main CI and handoff verified at f05d946f5a7551b32aba2348a9d9eb1739efa299. No custom OAuth or live scratch acceptance.

- **Next session #121–#125:** #120's exact-head and final-main CI and permanent handoff verified. RTC 1 still deliberately advertises rtc:0; genuine Toolkit Hub direct/private-relay/Sandbox and owner-issued read-only pass revocation need actual protected evidence, not the standard GitHub connector. V-1/V-2 live OAuth-connected scenario and scratch create/cleanup remain unverified. GitHub-created initial default labels and all foreign artifacts now block destructive cleanup unless a verified journal baseline exists; do not guess safe names or weaken preflight. Preserve production OFF, $0 spend, hosting policy, explicit owner gates, and scheduled daily checked main→live only.


- **#115 — protect foreign milestones/deployments (MERGED; exact-head and final main CI verified):** The private scratch delete preflight now scans all repository milestones (including closed), deployments and deployment environments twice; any foreign artifact, truncated listing, inconsistent counts or denied GitHub read blocks deletion. Adversarial fake GitHub tests; no live cleanup acceptance. RTC 1/D-4, OAuth and production remain gated. Four-PR numbering cycle #112–#115 ends with this PR when safely merged and main CI verifies; next session is five PRs #116–#120.

- **#120 — V-2 exact Actions workflow ownership (MERGED; exact-head and final-main CI verified):** Independently enumerate enabled/disabled Actions workflow definitions before each scratch repository deletion check. Require exact journaled V-1 workflow path, unique numeric ID, active status and consistent total count; unrecorded/changed/inaccessible definitions fail closed. Offline fake provider regressions. No real cleanup/OAuth or RTC 1 certification.

- **#119 — V-2 Actions run/artifact deletion preflight (MERGED; exact-head and final-main CI verified):** Both destructive scratch checks require independently read zero total_count and empty lists for Actions workflow runs and artifacts. Missing, inaccessible or inconsistent inventories refuse deletion; unit fixtures cover positive and malicious cases. V-1 never dispatches CI in current scenarios. No connected real scratch acceptance.

- **#118 — V-2 complete scratch-label preflight (MERGED; exact-head and final-main CI verified):** Scratch deletion now enumerates all live repository labels twice, refuses any unjournaled, duplicate, missing, capped or unreadable labels, and verifies recorded labels' identities before DELETE. Default GitHub labels not explicitly recorded will block cleanup; no unverified baseline is silently trusted. Adversarial fake provider tests added. No connected destructive test, production or spending authorization.

- **#117 — RTC HTTPS request budget (implementation; exact-head CI pending):** Enforce a 32 KiB UTF-8 size ceiling on the complete JSON POST body before tool/batch dispatch, reject unexpected batch envelope fields, and retain clean 400 invalid_args failures instead of executing oversized payloads. Unit tests cover multibyte bytes, oversized single/batch calls, unknown keys and normal calls. No new write authority, live acceptance or spending.

- **#116 — RTC discovery and batched result integrity (MERGED; exact-head and final-main CI verified):** Reject malformed or unbounded tool discovery fields instead of coercing ambiguous query values. Preserve the existing connection-owned saved-result handle for each oversized read in a successful RTC batch, with regression tests. No new tool authority, certification, connected Hub acceptance, OAuth acceptance, production activation or spending. #115's verified merge status reconciled below.

- **#114 — scratch PR point-of-close integrity (MERGED; exact-head and final main CI verified):** Retain each exact preflight PR identity, and check fresh per-PR GET before optional close plus immediate after-close readback for unchanged run-owned draft, head SHA, base, repository and body. Refuse drift before destructive deletion, with fake-GitHub adversarial tests. No connected real scratch or RTC 1 certification claim.

- **#113 — RTC result retrieval query semantics (MERGED; exact-head and final main CI verified):** HTTPS `GET /api/results/{handle}` now validates and forwards `page`, `pageSize`, comma/repeated `fields` and `offset` to the existing connection-owned guarded result handler. Bad request shapes fail before dispatch; no cross-connection handle disclosure or broader authorization. Unit regressions added. RTC 1 and genuine D-4 routes remain unverified; no spending/production changes.

- **#112 — RTC batch authorization continuity (MERGED; exact-head and final main CI verified):** Each read in an HTTPS batch after the first independently rechecks the current pass, exact scratch organization, nonproduction limits and shared rate budget before dispatch. A revoked/expired or narrowed pass terminates the remaining reads rather than reusing a stale connection. Whole-batch malformed arguments fail before any read. Fake-HTTP adversarial tests cover mid-batch revocation, expiry, scratch removal and exhaustion. This is offline verification only: manifest remains rtc:0, no full RTC 1, D-4 live route, OAuth-connected or real scratch acceptance claim. Exact-head `ci` + `release-policy` and post-merge main CI remain mandatory.

- **2026-10-12 — live-only hosting-cost checkpoint, prepared in substantive PR #110:** Existing GitHub branch protection requires exact-head Actions `ci` plus `release-policy` on PRs into `main`; no force/deletion. PR #111 independently merged the daily checked `main → live` schedule, `live`-only Vercel production tracking, disabled auto-previews and release policy. Saved Basic/queued build and Neon 0.25 CU / 300-second autosuspend settings are recorded in `docs/HOSTING-COST-POLICY.md`; first real scheduled promotion and Basic build performance are NOT yet observed. No manual deployment, added resources, spending, production activation or custom OAuth acceptance authorized. #110 was subsequently merged with exact-head and final main CI verified; this earlier pre-merge checkpoint is retained as context.


- **#110 — atomic RTC pass-area scope and result retrieval (MERGED; CI verified in #110 handoff):** A same-statement transaction binds each owner-issued pass to persisted immutable read-only server/meta areas with allow_writes false, production_access false, money limit 0 and database CHECK constraints. Every HTTPS request independently refuses missing/altered scope. Dispatcher-owned large result handles are normalized to the RTC top-level handle, with result retention remaining connection-scoped. Expanded Postgres and HTTP regressions. Manifest still rtc:0; full RTC1 and real D-4 acceptance not yet proven.

- **#109 — pinned Hub RTC conformance CI (MERGED; CI verified in #110 handoff):** Vendored reviewed Hub RTC runner/fake with locked source SHA. The existing shapes job executes Hub named wire-level probes against reference and this server's local pass-only HTTP adapter. Intentional rtc:0 manifest fails as not certified; tests verify honest skip/failure, expired/revoked/missing bearer refusals, and that CI does not misreport passing RTC 1. Live D-4 remains unverified.

- **#108 — RTC HTTPS read-only gateway (MERGED; CI verified in #110 handoff):** Public adoption manifest and OpenAPI path; pass-only whoami, tool search/describe/call/batch and result routes. Each read checks live scratch designation, revocation, expiry, profile and shared DB rate. Only server/meta read-only tools are permitted. Manifest deliberately returns rtc:0 until RTC 1 conformance and D-4 acceptance are actually proven; no production, spending or provider mutation.

- **#107 — RTC pass foundation + submitted-review safety (MERGED; CI verified in #110 handoff):** Owner passphrase/CSRF-protected setup issues only short-lived preview/read_only passes for independently designated scratch organizations, displayed once via the existing encrypted one-time secret page and revocable by ID. Database stores hashed passes, enforces atomic per-pass rate limits, and the MCP OAuth door still rejects pass kind. HTTPS RTC read-only tools are not yet exposed; hub D-4 real routes remain unverified. Scratch cleanup also refuses non-run submitted PR reviews.

- **#107 — foreign submitted-review safeguard (MERGED; CI verified in #110 handoff):** Scratch deletion now enumerates formal PR reviews per recorded draft and refuses any submitted review or incomplete pagination. Inline run comments are separate and do not authorize destroying approval decisions. Added no-DELETE regression and fixture coverage; no real scratch/OAuth acceptance.

- **#106 — bounded all-runs selection (MERGED; CI verified in #110 handoff):** Read-only cleanup previews now return an explicit at-most-five-run selection with separately reported blocked/excess IDs and incomplete-page warnings. Every selected run still requires a fresh preflight and separately confirmed write; no bulk deletion or remote proof is claimed. Custom OAuth acceptance and real scratch cleanup remain unverified.

- **2026-10-12 — #105 foreign scratch comment isolation (MERGED after exact-head CI):** Before private scratch deletion, boundedly list issue comments and PR review comments. V-1 never creates issue comments, so any presence refuses deletion; review comments require recorded exact IDs, unchanged commit/path/body and a journaled run PR. Reject missing, foreign, changed or truncated results. This is mock-only and not custom OAuth acceptance.

- **2026-10-12 — #104 scratch label & association validation (MERGED after exact-head CI):** Before deleting a private scratch repo, independently verify every journaled run label's exact name, marker and color, plus run PR-label associations against recorded PR/label IDs. Missing or changed identities refuse deletion. Fake regression and all three write doors; no custom OAuth acceptance.

- **2026-10-12 — #103 scratch default-branch integrity (MERGED after CI):** Deletion now requires the original recorded run repository tip SHA (#102), permitting only the exact run-owned committed workflow on default thereafter. Unjournaled default-branch work and old missing-origin ledgers fail closed before DELETE, with fake positive/negative tests. No real scratch operations.

- **#102 CI correction:** Account-scoped seed ref fixture now accepts initial default ref and the later test branch, and tool catalog records immutable origin. No new authority.

- **2026-10-12 — #102 scratch initial commit journal (MERGED after exact-head CI):** Both private scratch repository creation doors now independently read and durably record their initial default-branch commit SHA inside the existing atomic run intent. Invalid GitHub ref/readback remains uncertain, not blindly replayed. Fake request-shape and no-duplicate tests; this is offline only, not connected acceptance.

- **2026-10-12 — #101 standalone cleanup identity (MERGED after CI):** Host cleanup refuses a missing recorded branch SHA and any recorded PR with mismatched numeric ID, merged_at, non-draft state (even closed), foreign base repository or altered head SHA. Fake three-door negative regressions protect host repos. No live credentials or scratch actions.

- **2026-10-12 — #100 finite pagination boundary (MERGED after gated CI):** Shared GitHub pagination now has a maximum of 10000 items, an independent bounded-page cap, and refuses malformed list data and reports non-exhaustive inventory on a repeated empty or tiny linked page. This prevents infinite preflight pagination from stalling or incorrectly completing scratch deletion. No connected OAuth acceptance or real scratch deletion claimed.

- **2026-10-12 — #99 scratch draft-PR identity preflight (MERGED after exact-head CI):** Scratch deletion now requires each listed PR to remain an unmerged draft with exact run footer, recorded numeric identity, unchanged own branch SHA, same private repository head/base, and default or run-owned base. Adversarial fake cases refuse retargeted and ready-for-review PRs. Custom OAuth and real deletions remain unverified.

- **2026-10-12 — #98 repository ruleset/webhook cleanup isolation (MERGED after gated CI):** Before private scratch deletion, enumerate local rulesets and repository webhooks in bounded reads. Refuse any webhook until V-4's verified cleanup exists; only the exact journaled required-ci ruleset with unchanged active branch-policy rules may be destroyed with its parent. Fake positive/negative tests; no live acceptance.

- **2026-10-12 — #97 scratch tag/release isolation (MERGED after gated CI):** Scratch deletion preflight now enumerates bounded Git tags and releases before both destructive checks. It refuses foreign or retargeted tags, published releases, unknown release IDs and release assets, with fake negative regression coverage. No connected OAuth acceptance or real deletion.

- **2026-10-12 — #96 exact per-branch tip evidence (MERGED after exact-head CI):** Scratch repository deletion now binds each run-owned branch to its own recorded creation commit, matching fixture-file commit, or exact recorded review revision. A SHA from another run-owned branch/file cannot authorize deletion. Adversarial fake-GitHub tests block cross-branch and cross-file substitutions before DELETE. Offline only; OAuth acceptance and all-runs deletion remain unverified.

- **Historical plan #106–#110 (completed):** PRs #101–#105 implement stricter V-1/V-2 origin, branch, label and comment ownership checks; verify live main and final post-merge CI, late review threads, and the permanent #105 handoff first. V-1/V-2 remain IN_PROGRESS: custom GitHub MCP OAuth-connected acceptance, actual owner-scoped scratch create/delete, and safe confirmed all-runs cleanup remain UNVERIFIED. Continue approved implementation in dependency order, without treating standard GitHub connector CI as custom-MCP acceptance. Production stays disabled, $0 spend; live credentials/destructive actions require their separate owner approval gates. Merge exactly five new PRs #106–#110, maintain repository docs, stop with next prompt.

- **2026-10-12 — #95 scratch deletion isolation (MERGED, CI green):** Before a whole scratch repository is deleted, inspect bounded live branch, PR and issue inventories and refuse unjournaled or changed resources, including on repeated pre-delete check. Require an exact rather than prefix run marker on scratch creation readback. All checks use fake GitHub, never actual custom connected credentials. No production/spend authority changes.

- **2026-10-12 — #94 stable paginated run inventory (MERGED; exact-head and post-merge CI green):** Adds a strict opaque, account-scoped keyset cursor to the existing read-only run inventory. The all-runs cleanup preview remains journal-only, explicitly non-atomic and never enables deletion; malformed/foreign cursors are refused. Disposable Postgres and fake pagination contracts cover equal timestamp run ordering.

- **2026-10-12 — #93 bounded all-runs inventory (MERGED; exact-head and post-merge CI green):** Adds scoped total-run counts and evidence-only `github_dev_list_runs({cleanupPreview:true})` readiness for up to 20 runs at a time. It identifies unresolved intents and truncated per-run journals without remote provider calls, approval, deletion or false claims of exhaustive scans. All-runs deletion remains unimplemented.

- **2026-10-12 — #92 intent/object reconciliation (MERGED; exact-head and post-merge CI green):** Run intent reads now include the actual run ID; cleanup reports and execution refuse recorded intents with missing, mismatched or duplicate object identities. Fake/Postgres contracts and adversarial planner/report tests establish the linkage. No owner-connected provider acceptance, production change or spending.

- **2026-10-12 — #91 journal collision safety (MERGED; exact-head and post-merge CI green):** Intent completion now records success only when its unique run-object row was actually inserted; a collision leaves the step pending and blocks cleanup instead of falsely completing it. Shared fake/Postgres tests exercise racing steps and already-recorded identities. No live GitHub acceptance, new authority or scratch mutation.

- **2026-10-12 — V-2 #90 exact run-marker isolation:** Corrected a cleanup ownership weakness: prefix matching could mistake a longer run ID's marker for the shorter run. Scratch seeding and cleanup, standalone PR/issue cleanup, draft verification and review fixture checks now require an exact run marker: a bounded description token or complete `<!-- rtc_run=<id> -->` footer. Adversarial tests refuse lookalike repositories, PRs and issues before mutations. No OAuth, production, spend or live scratch authority changed; V-2 all-runs and remaining resource types are still pending.

- **2026-10-12 — V-2 #89 durable per-object report:** Both `github_dev_list_runs(runId)` and confirmed `github_dev_cleanup` now use a shared evidence-only cleanup report: exact owned IDs, per-object journal state, pending/uncertain steps, truncated or conflicting rows, remaining count and explicit safe-resume guidance. Report never claims remote absence or OAuth acceptance from ledger flags; confirmed write separately reports fresh remote verification for that call. No new external permissions or mutating API paths.

- **2026-10-12 — V-2 #88 exact issue cleanup:** For existing host repositories, added a guarded close-only path for run-journaled issues. It verifies exact run footer and issue-not-PR identity, requires the pre-existing `rtc-cleaned` label, closes with GitHub's `not_planned` reason and confirms both state and label before journaling cleanup. No issue deletion or host repository changes outside recorded run items. Partial outcomes remain visible for retry; no connected acceptance.

- **2026-10-12 — V-2 #87 recorded label cleanup:** Existing confirmed cleanup now handles a run-owned label and exact PR-label association in a pre-existing repository. Labels require run marker and collision-free usage scan; any unrecorded issue/PR usage refuses deletion. Associations are removed only by their recorded PR number/label and independently read back. Non-run labels and host repository stay intact. Real connected cleanup remains untested.

- **2026-10-12 — V-2 #86 standalone cleanup:** Extend the existing guarded `github_dev_cleanup` to a recorded test-branch/PR-only run in an existing host repository. Reads GitHub production/protection rules for exact `rtc/<run>/` branches, refuses changed SHA/foreign refs or PRs, closes exact run PRs then removes only owned refs, with readback and per-object scoped ledger updates. Host repository is never deleted in this mode. Unsupported standalone resource types still refuse; no connected scratch or real-host acceptance.

- **2026-10-12 — V-2 #85 guarded scratch cleanup:** Added `github_dev_cleanup` through the normal confirm-always write pipeline, exact private run-marker verification, atomic run freeze, recorded PR closure/readback, repository delete/readback and per-object durable completion. Owner-verified scratch and preview-only connection remain mandatory. CI fake transport and readback tests; **no live OAuth or scratch deletion acceptance**. V-2 non-repository cleanup and all-runs remain for later.

- **2026-10-12 — V-2 #84 cleanup foundation:** Connection-scoped atomic cleanup freeze blocks new writes; exact-object completion and run close require verified per-object cleanup. A pure ID-only planner refuses ambiguous, incomplete, foreign or uncertain inventories. No live deletion or external mutation. Next: guarded V-2 execution and independent GitHub readback.

- **2026-10-12 — #83 root routing repair:** The Vercel deployment previously returned 404 for `/` because `api/index.js` is served at `/api`; the `/` rewrite now explicitly targets `/api/index`. A unit regression checks the rewrite and unauthenticated information response. This is informational HTTP routing, not proof of connected OAuth or scratch writes. All production/spending gates remain intact.

### Verified live checkpoint — 2026-10-12 UTC; carried draft PR #83 (NOT MERGED)

- **Infrastructure:** Custom Vercel project `github-mcp` on existing Pro team; reviewed production main `343b26777af1f57f6e98fdbf625e496ebb1c8800` (merged #82); canonical URL `https://github-mcp-chris-projects-de6cd1bf.vercel.app`. Dedicated Neon project `green-surf-51243848`, database `github_mcp`, fixed 0.25 CU, autosuspend after five minutes, 20 initialized application tables. Project-scoped encrypted environment settings are configured; **never expose secrets or casually rotate `TOKEN_ENCRYPTION_KEY` after credential enrollment.**
- **Owner scratch setup COMPLETE, external connected acceptance OPEN:** In the custom service DB, Organization `robinson-ai-scratch` has its own custom App `robinson-mcp-robinson-ai-scratch`, active All-repositories installation, 41/41 stored permissions matching the App's recorded set, `is_scratch=true`, `production_enabled=false`, spend limit $0, and an owner-confirmed `setup_set_scratch` audit record. This is **NOT** an installation in, or token from, ChatGPT's standard GitHub plugin.
- **Real HTTP smoke (temporary restricted Vercel sandbox):** OAuth authorization-server discovery **200** with correct issuer, protected-resource discovery **200**, `/api/github/setup` GET **200**. Unauthenticated `/api/mcp` GET and JSON-RPC POST each correctly **401** with OAuth Bearer challenge. Informational home page `/` returned **404** (confirmed routing defect to fix and regress-test). Sandbox stopped after testing. **No external GitHub resources were mutated.**
- **Zero connected-test evidence:** `oauth_clients=0`, active OAuth tokens=0, `dev_runs=0`, `dev_run_objects=0`. No authenticated custom MCP `github_list_accounts`/`github_whoami`, run-owned GitHub write or cleanup. Do **not** substitute the standard GitHub connector or bypass OAuth. An owner-authorized custom preview connection choosing only `robinson-ai-scratch` and `profile=read_only` is the initial read check; `profile=everyday` is needed for guarded scratch writes. **V-2 cleanup is not built**; verify a safe run-owned cleanup/recovery path before creating a real disposable repository. No additional owner action requested today; owner stopped testing.
- **Roadmap:** V-1 IN_PROGRESS: six real scratch-only seed scenarios implemented under fake/SQL/request-shape tests; `webhook-target` remains plan-only awaiting V-4 forwarders. V-2 run-owned cleanup remains unimplemented. Production accounts, irreversible changes and spending retain independent gates.
- **Carry-forward accounting:** Draft PR **#83** (`ai/gpt6/setup-visible-feedback`) holds mobile form feedback plus documentation. **Leave #83 unmerged in this session.** Next session must **add to and finish #83 as PR 1 of its five** (verify current main, CI/reviews, reconcile routing issue), then merge four additional substantial PRs. Do not count #81/#82 again or open a duplicate #83.


- **2026-10-12 — setup feedback visibility (#83):** The owner completed mobile forms without seeing confirmation because the reusable form resets on each response and the feedback appears at the top of a long page; database audit found two failed administrator logins, zero successful logins and zero apps/accounts. All internal setup forms now navigate to the accessible `#setup-feedback` heading on their server-rendered POST response (no JavaScript); success and failure display a clearly labeled `Setup response:`. The GitHub manifest POST retains its GitHub URL and all credential, CSRF, same-origin and setup-state protections remain unchanged. The owner must use the `ADMIN_PASSPHRASE` from Vercel (or privately replace it and redeploy).


- **2026-10-12 — mobile setup URL diagnostic (#82):** Owner reported `Origin check failed` during GitHub App setup. Vercel production `PUBLIC_BASE_URL` is correct; the form page also set `Referrer-Policy: no-referrer`, which causes HTML navigation POSTs to emit `Origin: null` under browser standards. Change the form page policy to `same-origin` (external sites still receive no Referer), canonicalize alternate production setup GET requests to the configured HTTPS origin before minting the Strict CSRF cookie, leave POST's exact-Origin requirement intact and provide a helpful 403 browser-link explanation. The secret/CSRF/passphrase guards are unchanged. Test alias redirects and malicious/absent Origin. Owner can also open the canonical link in external Chrome.


- **IN-06 account onboarding next:** Vercel project `github-mcp` on existing Pro team is READY on reviewed main `343b267`; isolated Neon project `green-surf-51243848` uses a 0.25-CU fixed compute with five-minute idle suspension. The owner created `robinson-ai-scratch`; secure scratch designation through the private setup page is introduced in #81. The owner has now installed the custom scratch App and enabled scratch mode. Password-manager backup status is unverified; OAuth connected write/cleanup acceptance remains pending. GitHub account production remains OFF.
- **Batch G implementation COMPLETE:** G-1 through G-6 are built (#39–#64); acceptance evidence and limitations are in `docs/audits/G-BATCH-CLOSEOUT.md` (#66). **Next V-1:** the #67 durable step-intent journal, then remaining V-1 scenario work, preserving per-object recording, safe replay, and IN-06-gated scratch isolation. PRs #69–#70 already built guarded scratch creation and two real scenarios; #71 adds a third. Batch V remains IN_PROGRESS.
- Batches A, B, C, D finished. Real GitHub steps need IN-02…IN-05 (`docs/DEPLOY.md`).
- **Known follow-ups:** port the empty-passphrase fix in `secretsMatch` to stripe-mcp and the hub core (other repos: tell Chris, do not edit); the scratch App's 41 stored installation permissions match its recorded requested set; custom MCP connected execution is untested.
- **Answered 2026-10-10 (Chris):** IN-00 — plan approved ("I approve the plans"); IN-01 — **no automated review** ("I don't want the automated review at this time"); the repository stays public as Chris created it; the implementer self-reviews every diff.
- **Queue:** A → B → C → D → E → G → V → F → H → O → P → W → U → R → X (`MASTER-ROADMAP.md`).

## Environment

- Repo: `Robinson-AI-Systems/github-mcp` (public), default branch `main`. Every change goes through an `ai/*` branch and
  a PR; the `ci` check is the merge gate.
- Runtime: Node 24.x (`package.json` engines, every CI job). GitHub REST API version to pin: `2026-03-10` (still the
  newest on 2026-10-10).
- Dev commands (all finish by themselves): `npm ci`, `npm run check`, `npm test` (unit), `npm run test:db` (throwaway
  Postgres: CI service, or local binaries — works as root), `npm run test:shapes` (Octokit against the fake GitHub).
- Vercel/Neon deployed and custom scratch GitHub App installed (IN-02/IN-03 and scratch portion of IN-04/IN-05); personal and normal org Apps still pending.

## Recent changes (newest first)

**2026-10-12 — Owner-only IN-06 scratch designation (PR #81):** Server-side database refuses scratch flag unless an organization has an active all-repo GitHub App and production OFF. The passphrase+same-origin+CSRF protected setup page performs independent live App installation checks, requires typing the exact org name twice, audits the change, and supports revocation. Fake/throwaway PostgreSQL and HTTP tests cover foreign identities, selected/suspended installations, personal/token accounts, stale or absent credentials and preview mode. This is owner setup infrastructure, NOT connected acceptance or permission to use a real credential without IN-06.


**2026-10-12 — V-1 run evidence and anti-replay diagnostics (PR #80):** `github_dev_list_runs` now reports evidence-only progress and concrete next actions from scoped durable IDs/intents. It never mistakes a truncated page, foreign/mismatched ID, uncertain/pending step, cleanup or unrecognized scenario for completion; even complete journals explicitly disclaim live acceptance. No GitHub writes or production changes. Six real V-1 seeds exist; webhook-target remains plan-only awaiting V-4 secure forwarder dependencies and IN-06. V-1 remains IN_PROGRESS.


**2026-10-12 — V-1 real review-thread seed (PR #79):** Sixth runnable scratch-only scenario creates a private fixture repo, labelled draft PR, three exact original-commit inline comments and mapped GraphQL review threads. A recorded Contents CAS revision changes only the final annotated line; independent readback verifies two current threads and one truly outdated, all 13 exact objects and source content. No live scratch use or CI dispatch. `webhook-target` remains plan-only pending V-4 forwarder/secret dependencies and IN-06.


**2026-10-12 — V-1 exact review fixture revision (PR #78):** Added recorded-scratch-branch Contents compare-and-swap updates for one run-owned review fixture. Original branch HEAD and file blob must match before mutation; new commit is independently journaled and read back, with stale/mismatch/replay tests. Enables a genuinely outdated third review thread in the next scenario. No live GitHub writes; IN-06 pending.


**2026-10-12 — V-1 exact thread ID mapping (PR #77):** Bounded GraphQL review-thread enumeration maps durably recorded numeric inline comment IDs to actual thread node IDs. Refuses incomplete pagination and ambiguous matches; verifies exact identity and `isOutdated` independently. The full scenario remains pending, as does IN-06 owner-gated live acceptance.


**2026-10-12 — V-1 review-comment foundation (PR #76):** Added strictly run-owned inline PR comment creation with exact recorded PR/head SHA, persisted numeric IDs and independent original-line/commit readback. Refuses foreign/stale PR targets and uncertain automatic replay. Does not misidentify a review comment as a GraphQL thread; GraphQL thread mapping follows. IN-06/live acceptance pending.


**2026-10-12 — V-1 real three-level draft PR stack (PR #75):** `github_dev_seed('stack-of-three')` now executes only in verified private scratch Organizations and journals 14 objects: repository, run label, three branches, three committed run files, three linked draft PRs and three label associations. No merges or CI dispatch. Independent readback verifies every PR/base/head, exact SHA, marker, file, branch ref, label and durable object. All three write doors are covered with fake GitHub request validation; live connected acceptance still requires IN-06. `pr-with-threads` and `webhook-target` remain plan-only.


**2026-10-12 — V-1 run-owned draft PR and label primitives (PR #74):** Draft PR creation now requires a recorded run-owned branch and file commit, verifies the remote head's exact SHA and persists the GitHub PR number; reusable helpers also journal one run label and its per-PR association. Fail-closed negative tests protect replay/foreign refs/mismatched responses. No connected account used. Next: compose the three-PR scenario in V-1.


**2026-10-12 — V-1 shared run-owned fixture helpers (PR #73):** Reusable strict `rtc/<runId>` branch and run-specific Contents API mutation helpers claim before a GitHub write, journal exact returned commit IDs, and block uncertain replay. Existing failing-ci seed now uses them and verifies branch SHA. Added durable fixture-file object type, fake request-shape and negative tests for unsafe refs/paths. No real GitHub scratch account touched. Next: executable stacked draft PR scenario.


**2026-10-12 — V-1 protected-main scratch fixture (PR #72):** Fourth real scenario creates a private scratch repository and active default-branch ruleset requiring `ci`; the precise GitHub ruleset ID is journaled and its enforcement/conditions checked on independent readback. Three scenarios remain plan-only. No connected account used; IN-06 remains pending.


**2026-10-12 — V-1 draft release train (PR #71):** Third real scenario builds a run-owned private scratch repo, three Git tags pinned to its initial commit, and a real draft v0.3.0 release. Five exact object IDs, tag SHAs and readback are journaled; nothing is dispatched or published. Four scenarios remain plan-only. IN-06 still blocks live connected acceptance.


**2026-10-12 — V-1 first real scenario seeds (PR #70):** `github_dev_seed` now builds `repo-basic` and `failing-ci` on the real GitHub API, each as three explicitly tracked objects: private run-marked scratch repo; run-specific workflow file committed via Contents API; run label or `rtc/<runId>/failure-ref` branch. Every step uses one-winner claims and exact object recording. Workflows have `workflow_dispatch` only: no Actions run or cost is triggered automatically, so live green/fail acceptance awaits separately approved dispatch (V-3). Reads verify private repo and workflow contents; fake transport exercises real request shapes, nine contract checks across all three doors, retries, scope and partial failure. Five other V-1 blueprints remain plan-only and IN-06 still gates real-account usage. Continue V-1 next session; do not claim end-to-end live CI validation.


**2026-10-12 — V-1 guarded scratch create (PR #69):** `github_dev_create_scratch_repo` sends a private GitHub repository create through the normal write/preview/permission pipeline, only after server-side IN-06 verification of a dedicated scratch Organization, an active all-repos GitHub App, and preview mode. `runDevMutationOnce` reserves a deterministic step and journals the exact returned repository `full_name` before any further mutation; uncertain outcomes cannot be replayed. Tests exercise all three tool doors, fail-closed non-scratch/production cases, and object recording. No live scratch org was created or touched. Next: apply real named scenario seeds using this shared runner.


**2026-10-12 — V-1 inspection tools (PR #68):** `github_dev_list_scenarios` returns truthful seven named **plan-only** blueprints, with an optional deterministic per-run plan and real scratch-account verification. `github_dev_list_runs` shows only the caller's account/connection runs, exact created-object ledger and claimed/uncertain/recorded step status with strict bounds; read dispatch never calls GitHub. Fake and PostgreSQL share a new bounded intent-list contract. No seed or scratch creation is enabled; IN-06 remains pending. Next: guarded scratch create/seed.


**2026-10-12 — V-1 durable execution-intent journal (PR #67):** A scoped, atomic `dev_run_intents` ledger claims each scenario step before outbound GitHub writes; concurrent workers cannot claim the same step. Uncertain outcomes never automatically replay; recording the exact created ID and completing an intent happen in one PostgreSQL statement. Fake and disposable PostgreSQL run the same behavior and concurrency assertions. No GitHub seed/scratch write tool is exposed; IN-06 remains pending. Next: expose safe run/scenario inspection and develop guarded scratch operations.


**2026-10-12 — Batch G phase-gate closeout (PR #66):** Cross-checked every G-1…G-6 tool catalog row, merged implementation PRs and PLAN acceptance. Implementation complete; no live account, deployment, App or production acceptance has been claimed. `docs/audits/G-BATCH-CLOSEOUT.md` records evidence and pending owner-dependent smoke tests. Current priority V-1, IN-06 still pending.


**2026-10-12 — PR #65 (V-1 foundation + efficiency):** Durable account/connection-scoped run/object ledger and contract tests, deterministic plan-only blueprints, bounded task brief, two unit test shards with the same aggregate `ci`, shared fake-sleep injection across write-contract dispatcher doors (without changing production pacing), and permanent coherent-PR/anti-stall guidance. No V-1 GitHub seed or scratch writes exposed; IN-06 remains gated. Schema tests derive migration counts from declared tables; shared-contract dispatcher sleep has a regression test; complete fake organization membership avoids retryable 501 responses while 403-denial tests remain. Post-merge CI wall-time measurement pending.


**2026-10-11 — G-6 package recovery (PR #64):** Owner-scoped restore for an exact deleted version or an entire package, 30-day and reused-namespace warnings, production confirmation and independent 204/readback. G-6 tools completed; Batch G verification/closeout and V-1 follow. No live restoration.


**2026-10-11 — G-6 whole-package deletion (PR #63):** Requires a complete bounded version inventory, names number of versions in destructive preview, refuses known public download threshold and incomplete lists, checks state again before deletion and verifies absence. No live package changed.


**2026-10-11 — G-6 package-version deletion (PR #62):** Scope-specific org/user package reads, stable version identity, destructive confirmation, GitHub's public >5,000-download refusal and independent deletion readback. No real package deleted.


**2026-10-11 — G-6 Pages writes (PR #61):** Guarded Pages creation, source/domain/HTTPS updates and disable; read-before/write/recheck/read-back; publication classified production, private-repo exposure classified access-widening. Updates preserve omitted fields. No live site changed.


**2026-10-11 — G-6 Pages and packages reads (PR #60):** Corrected unsupported user-version `page/per_page` query parameters after exact CI failure, documented truthful incomplete user-version results, and tightened permanent no-shell slow-CI anti-stall guidance in AGENTS/SESSION-START.  Token-budget reconciliation compacts optional field-filter metadata (no behavior change).  Added read-only Pages configuration/build inspection and org/user package discovery with bounded version metadata and permission-preserving errors. Next: G-6 guarded writes. No changes to Pages or packages were made.


**2026-10-11 — G-5 asset upload (PR #59):** Authenticated binary upload to GitHub's exact release upload host with bounded public HTTPS source, duplicate/immutability/published-state protections, nine-contract checks and asset read-back. G-5 complete, G-6 next. No live asset changed.


**2026-10-11 — G-5 public asset download boundary (PR #58):** Public HTTPS URLs only, pinned validated DNS A record, redirect and private-network refusal, streamed size/timeout caps. Unit fixtures prove denied metadata addresses, redirects and oversize responses. Integration into upload follows; no live download occurred.


**2026-10-11 — G-5 generated release notes preview (PR #57):** An optional create-preview asks GitHub to calculate notes without creating a release or tag. Failures and contradictory body inputs fail closed; GitHub remains the source of generated notes on actual create. No live releases changed.


**2026-10-11 — G-5 release asset deletion (PR #56):** Confirmed per-release asset membership, immutable protection, draft/published production classification, race recheck and read-back of deletion. No real assets were removed. Next: secure upload and generated notes.


**2026-10-11 — G-5 part 2, guarded release lifecycle (PR #55):** `github_release_create/update/delete` use guarded request-key writes. Creation defaults to draft with generated notes; publishing requires production approval; published immutable releases refuse changes. Read-back verifies identities and preserved fields; release deletion leaves the Git tag. No live releases changed. G-5 remains IN_PROGRESS for assets and generated notes.


**2026-10-11 — G-5 part 1, release reads (PR #54):** `github_release_list` pages release metadata and `github_release_get` retrieves by exact ID, tag or latest published release. Both include draft/prerelease status, asset counts/metadata and public download links, never asset bytes. No release publication or tag change. G-5 remains IN_PROGRESS for guarded lifecycle and asset tools.


**2026-10-11 — G-4 part 3c, environment deployment branch/tag patterns (PR #53):** `github_env_policy_create/update/delete` are separately guarded from environment PUT. Require custom-policy mode and verified prior policy state, prevent duplicates and incomplete list interpretation, classify existing environment protection, demand confirmation and report only verified read-back. Full-profile owner tools, production and access guards retained. G-4 complete. Next: G-5 release reads, lifecycle and assets.


**2026-10-11 — G-4 part 3b, guarded deployments (PR #52):** `github_deploy_create` prevents GitHub auto-merges, preserves required checks, guards existing/proposed production targets and verifies a created ID; 202 cannot masquerade as a deployment. `github_deploy_set_status` derives environment/ref from GitHub, guards production and verifies the exact new status ID. Three-door write contracts and denial fixtures added. No live deployment or credentials. Next: separate branch/tag policies; G-4 remains IN_PROGRESS.

**2026-10-11 — G-4 part 3a, deployment reads (PR #51):** `github_deploy_list` lists deployment records with bounded paging, ref/environment/task/SHA filters and each deployment's latest status (or explicit null). `includeLatestStatus: false` avoids extra calls. No deployment is created, status changed or production action taken. Next: guarded deployment writes and separate environment branch/tag policy CRUD; G-4 remains IN_PROGRESS.

**2026-10-11 — G-4 part 2, environment settings (PR #50):** `github_env_save` preserves omitted reviewers, wait timers and branch-policy mode, verifies read-back and refuses unsupported custom rules; `github_env_delete` is confirm-always, irreversible, and retains existing production safeguards. No deployment is started. Next: G-4 part 3, deployments and separate branch/tag patterns.

**2026-10-11 — G-4 part 1, environments reads (PR #49):** list environments with truthful paging/protection metadata and optional secrets/variables *counts only*; get environment reviewers, wait timers and distinct branch/tag patterns, preserving unknown protections as visible. No mutations or secret values. Next: environment settings writes (#50) and deployments.

**2026-10-11 — E-2 part 2, pull request stacks (PR #48):** `github_pr_list_stacks` pages or inspects ordered stacks; `github_pr_stack_manage` creates, adds or un-stacks, verifies the exact PR branch chain and read-back, never merges or edits branches. Batch E is complete; G-4 (environment settings, deployments) is next.

**2026-10-11 — Implementation detail for faster Sol 5.6 execution (planning):**
`docs/implementation-contracts/IMPLEMENTATION-DETAIL.md` defines concrete JIT packets; `TOOL-RECIPES.md` maps
inspected helpers and test contracts; `REMAINING-WORK.md` adds edit sequences and regression anchors for the 41
non-merged units at baseline `ed60e19`; `G-4-PACKET.md` supplies a worked request/state/test map. Entry points link
them. No implementation card, queue, index status, owner input, runtime code or CI gate changed. E-2 (#46) and
G-3 part 2 (#45) were in flight at inspection; their implementers reconcile this guidance at the PR boundary.

**2026-10-11 — G-3 part 2, secrets (PR #45):** `github_secret_set` (Chris types the value on the private setup page via a link, or the server generates one), `github_secret_delete`, `github_secret_set_repo_access`; new table `secret_entry_requests`; values are sealed with GitHub's public key on the server and never stored, logged or shown to Claude. G-3 is complete; G-4 (environments and deployments) is next.

**2026-10-11 — G-3 part 1, variables and the secret list (PR #44):** `github_variable_list`, `_set`, `_delete` (repository, environment or organization; the old value is kept for undo) and `github_secret_list` (names and dates only, never values). Sealed secret entry through the setup page (part 2) is next; G-3 stays in progress until then.

**2026-10-11 — G-2 part 2, check, status, artifact and cache changes (PR #43):** `github_check_create_run` / `_update_run` (GitHub App only; a token is told so plainly), `github_status_create` (undo restores the previous state), `github_artifact_delete`, `github_cache_delete` (by id or exact key). Found and fixed a real bug class: a DELETE's extra parameters were sent as a body that GitHub ignores. G-2 is complete.

**2026-10-11 — G-2 part 1, check, artifact and cache reads (PR #42):** `github_check_get_ci_state` (the Batch E helper as a tool: each check and status, required or not, overall green / red / pending / unknown), `github_check_get_run` (with annotations), `github_artifact_list`, `github_artifact_get_link` (link only, never the file), `github_cache_list`. Creating checks and statuses and deleting artifacts/caches follow in part 2.

**2026-10-11 — G-1 part 2, Actions changes (PR #41):** `github_actions_set_workflow_enabled`, `_dispatch` (returns the run; production when the workflow file deploys to a production environment, or cannot be read), `_rerun`, `_cancel_run` (force needs confirm), `_delete_run`, `_review_pending_deployment` (owner's own sign-in). G-1 is complete.

**2026-10-11 — G-1 part 1, Actions reads (PR #39):** `github_actions_list_workflows/list_runs/get_run`, `github_actions_get_job_log` and `_get_run_logs_summary` (short form only: failed steps first, error lines, last lines; long encoded text never returned), `_list_pending_deployments`. Starting, rerunning, cancelling and approving follow in part 2.

**2026-10-11 — E-3 part 2, review changes (PR #38):** `github_review_create/submit/dismiss`, `github_review_reply`, `github_review_resolve_thread` (also reopens; no-op when already in that state), `github_review_request_reviewers`. Messages reaching outsiders ask first; an account approving its own pull request gets a plain explanation. E-3 is complete.

**2026-10-11 — E-3 part 1, review reads (PR #37):** `github_review_list`, `github_review_list_threads` (resolved/outdated, file and lines, latest comment; open threads only on request), `github_review_list_comments`. Review writes (create, submit, dismiss, reply, resolve, request reviewers) follow in part 2.

**2026-10-11 — D-3 branches and tags (PR #33):** `github_branch_list/get`, `github_tag_list` (reads; an empty `protected=` is never sent), `github_branch_create` (starts from the repository's real default branch), `_rename`, `_delete` (the default branch is always refused; the undo recreates it at the recorded commit), `_merge`, `github_tag_create` (lightweight or annotated) and `_delete` (tags are always production). Batch D is complete.

**2026-10-11 — D-2 part 2, file and ref changes (PR #32):** `github_content_put_file` / `_delete_file` (branch always named; refused if the file changed since the preview; undo restores the previous text), `github_content_push_files` (GitHub-signed commit, branch head checked), `github_commit_comment` (notifies mentioned outsiders), `github_git_update_ref` (compare-and-swap; dropping commits needs force and the preview counts them). D-2 is complete.

**2026-10-11 — D-2 part 1, code and commit reads (PR #30):** `github_content_get` (text, directory listing, binary files show size and link only, long text kept behind a handle), `github_content_get_tree` (real default branch, glob filter, GitHub's truncation reported), `github_content_get_archive_link` (the redirect link only), `github_content_check_codeowners` (line, column, kind and a plain fix; 'no CODEOWNERS file' is not 'no errors'), `github_commit_list/get/compare/list_prs` (patches cut at 1,500 characters per file), `github_git_get_ref`, `github_git_get_commit`. D-1 is merged (#27, #29).

**2026-10-11 — D-1 part 2, repository changes (PR #29):** create, create from template, settings (merge options are production), visibility (public names its risk), default branch, rename, archive, transfer, delete, fork, sync fork, custom properties, star. Delete and transfer cannot be undone; the others record how to undo them. All nine write-contract checks pass through every door for every tool. D-1 is complete.

**2026-10-11 — D-1 part 1, repository reads (PR #27):** `github_repo_list` (organization or user, archived filter, capped), `github_repo_get` (merge options, rules on the real default branch, custom properties), `github_repo_find` (searches only this connection's accounts; typed `user:`/`org:` qualifiers are stripped), `github_repo_get_insights` (GitHub's 202 'still computing' asked at most 3 times), `github_repo_get_traffic`, `github_repo_list_activity`, `github_repo_get_custom_properties`. Read tools now receive the credentials (before, only writes did). Tests: 13 new, 650 unit total green.

**2026-10-10 — C-2 listing modes, meta-tools, budgets (PR #26):** a connection now gets either the full catalog or a compact list (4 meta-tools, whoami, the result reader — 816 tokens today); the other listing can be asked for with `?listing=` on the endpoint. `github_search_tools`, `github_describe_tool`, `github_call` (runs any tool you may use, through exactly the same safety checks — every write-contract test now also runs through it) and `github_batch` (reads only). Budgets are enforced in CI with a pinned tokenizer; dangerous tools are listed with PRODUCTION / SPENDS MONEY first; every tool must declare its audience, checked against the catalog. Batch C is complete.

**2026-10-10 — C-1 small results (PR #25):** every read result is shaped, then cut to size: long text is cut at 4,000 characters (logs keep their last 400 lines), a result over 8 KB becomes a preview, and anything cut is kept whole for 24 hours behind a `res_…` handle that only the same connection can read with the new `github_get_result` (pages, fields, more text). 29 summary forms for GitHub objects, `defineRead` for new read tools, a 16th table `result_store`.

**2026-10-10 — B-8b diagnostics (PR #24):** `github_check_permissions` (compares each App installation's permissions with what 21 tool areas need and names the exact permission to add; fine-grained-token accounts are reported, not guessed), `github_rate_status` (what the server last saw, any block, and GitHub's live numbers; works even while a block is in force), `github_where_is_setting` (16 seeded settings GitHub has no API for, with link, numbered steps, what you should see and a read-back check where one exists). Batch B is complete.

**2026-10-10 — B-7 check-writes + first half of B-8 (PR #23):** the write-safety check now compares every registered tool with its row in the tool catalog (production, access, notify, spend, confirm, credential, profile) and fails a tool with no row or a spend tool with no price function; `defineWrite` takes a `price` function that decides what a paid change costs (a failure refuses). New tools: `github_list_connections`, `github_recent_changes` (reads), `github_set_default_account`, `github_revoke_connection` (writes, full profile). `github_set_spend_limit` is now confirm-always and full-profile as the catalog said. Connection "last used" is recorded. Not built yet: B-8b.

**2026-10-10 — A-5a credential store (PR #11):** every GitHub credential is encrypted at rest with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`), each value sealed with a context that ties
it to its account, App, installation and scope, so a copied ciphertext cannot be reused elsewhere; a wrong or missing key gives a plain message and never a secret. `createCredentials`
supplies the client's `token({ account, cred, scope })`: installation tokens minted with a hand-signed App JWT, cached until five minutes before expiry and downscoped per connection (each
scope its own token); the owner's user token refreshed ten minutes before expiry (a lost refresh race uses the other instance's new tokens, a refused refresh asks for sign-in again); a
fine-grained token for accounts that use one (cannot be narrowed — says so); the classic notifications token only for `K`. `storeApp` keeps the manifest flow's key, client secret and
webhook secret as ciphertext. One-time secrets (ten minutes, read-and-delete) and setup states (single use, bound to a purpose) are stored. `listAccounts` never returns ciphertext.
Also fixed A-4's test helper: nested body schemas now validate and JSON bodies are no longer type-coerced. Tests: 174 unit, database and request-shape suites green. No setup page yet (A-5b);
no real credential exists.

**2026-10-10 — A-4 GitHub client (PR #10):** `src/github/client.js` is the only file that imports `@octokit/*`. `githubFor(ctx, { owner, cred, scope })`
refuses an account outside the connection (`outside_scope`) or without a credential (`no_credentials`), sends `X-GitHub-Api-Version: 2026-03-10` on
every call, never retries a write (or a GraphQL mutation) after an error, spaces writes one second apart per installation across instances
(`claimWriteSlot`, one atomic statement), records GitHub's rate headers per account and resource and refuses calls while blocked with the
reset time in Denver time (`rate_limited`), honours `retry-after` only inside a 20-second budget, and can cache a polled read by ETag
(`request: { etag: true }`; a 304 returns the stored body). `requestKey` gives writes their retry-proof key; `listAll` follows `Link` to a cap and
says when it stopped. Vendored: GitHub's REST description for 2026-03-10 (rest-api-description @ 58b1e0c0, 1,232 operations) and GraphQL schema
(github/docs @ be38ec5d), each with `SOURCE.md`; `scripts/openapi-find.mjs` and `scripts/graphql-find.mjs` search them. The fake GitHub now knows every
operation and rejects any request that does not match the description (including unknown body fields) or any GraphQL document that does not match the
schema. The secret scan skips only the two vendored data files (their examples contain token-shaped text). Tests: 138 unit, 38 database, 15 request-shape.
No real GitHub call was made; no credential exists.

**2026-10-10 — A-3b connector login endpoints (PR #9):** `api/oauth/{register,authorize,token}`, `api/well-known/*` (rewritten
from `/.well-known/*` by `vercel.json`), `api/mcp.js`, `api/index.js`. Contract-generic `src/core/{http,oauth-handlers,mcp-auth,
mcp-server}.js` take an injected policy; the GitHub rules are in `src/oauth/policy.js`: the authorize page lists the accounts
(checkboxes + default), mode, profile, listing and the passphrase; **production is refused unless the deployment is the production
one and every selected account has `production_enabled`**; settings are examined only after the passphrase is right; a missing
`ADMIN_PASSPHRASE` fails closed; the code → token grant copies every connection setting from the issuing row, refresh rotates on the
same row. `/api/mcp` authenticates the bearer and lists the registry's tools (none yet); every `tools/call` is refused by the default
dispatcher until Batch B supplies a guarded one. `src/runtime.js` creates the schema once per instance. Tests: handler round trips,
production refusals, lockout, escaping, MCP over a local HTTP server, and one full flow on throwaway Postgres.
Nothing was run against a deployed server (none exists; IN-02).

**2026-10-10 — A-3a connector login store (PR #8):** `src/core/oauth.js` (copied from `stripe-mcp` @ 90a49c0: token hashing,
PKCE S256, redirect validation, client address, 5-failures-in-15-minutes lockout) with one fix — an empty submitted
passphrase used to crash the login check instead of counting as wrong (port back to the source and the hub core).
`src/db.js` gained `checkConnection` (refuses a connection with no accounts, a default outside the list, or an unknown
mode, profile or listing) and the store: clients, single-use codes, access tokens, atomic refresh on the same row for the
same client, revocation, login-attempt counting, `listAccountsForLogin`. Codes, tokens and client secrets are hashed. Fake
database mirrors it; one shared contract (`test/contract/oauth-contract.js`) runs against the fake and real Postgres.
Tests: `tests/unit/oauth-core.test.js`, `tests/unit/oauth-store.test.js`, `tests/db/oauth.test.js`. No endpoints yet (A-3b).

**2026-10-10 — A-2 foundation schema (PR #7):** `src/db.js` — `SCHEMA_TABLES` (13 tables), `CONNECTION_FIELDS` and
`connectionSettings(row)`, `productionSql()` (lazy Neon client, plain error when `DATABASE_URL` is missing, nothing at
import time), `createDb(sql)` → `{ initSchema(), listTables() }`; `initSchema()` runs the §2 `CREATE … IF NOT EXISTS`
statements one per call, in order (idempotent, no drops, no data). Fake database gained `initSchema`/`listTables`.
Tests: `tests/unit/schema.test.js`, `tests/db/schema.test.js` (exact table set, idempotence, defaults, keys, no plaintext
secret column). The two expiry timestamps `user_token_expires_at` / `user_refresh_expires_at` are allow-listed in that
scan. No Neon database exists yet (IN-02); nothing was run against a real one.

**2026-10-10 — CI cadence (docs + CI config PR #5):** never push while a PR's CI run is in progress (SESSION-START §6,
PLAYBOOK Step 5); obsolete PR runs are cancelled, runs on `main` never are. Next action unchanged.

**2026-10-10 — A-1 foundation merged (PR #1):** `package.json` (Node 24.x, pinned dependencies, lockfile), ESLint,
three Vitest suites (unit, db, shapes), `scripts/check-secrets.mjs` (scans tracked files for GitHub tokens, PEM keys,
non-local database URLs, Neon/Vercel identifiers, committed `.env`), `check-docs-updated`, `check-writes` and
`check-budgets` (starting form), `check-core-imports`, `count-catalog.py` and the index validator in `npm run check`;
`scripts/local-postgres-test.sh`; `test/helpers/fake-github.js`; CI jobs check, unit, db, shapes and the aggregate `ci`.
A deliberately failing test turned `unit` and `ci` red once (https://github.com/Robinson-AI-Systems/github-mcp/actions/runs/38077330755), then was removed; the final run is green at the
exact head (linked in PR #1). Actions pinned to `actions/checkout@v7` and `actions/setup-node@v7` (Node 24 runtimes). Cards A-2 and A-3
written.


**2026-10-10 — Gap check against prior toolkits (local commit):** every GitHub tool name Chris built or planned in
`robinsons-toolkit-mcp`, `robinsonai-mcp-servers` and `robinsons-toolkit-api` (528 names) mapped to this plan in
`docs/audits/2026-10-10-prior-tools.md`: 432 covered by hand-built tools, 59 by the universal tools, 34 dropped with
evidence (GitHub retired the endpoint, Enterprise-only, or out of scope), and 4 gaps added — `github_content_check_codeowners`,
`github_release_delete_asset`, `github_package_delete`, `github_security_compare_dependencies`. Catalog now 305 tools
(299 hand-built + 6 universal). Cortiware, oldReplit and Household-Assistant were checked for GitHub needs too.

**2026-10-10 — Plan completed (local commits):** process and acceptance files (PLAN, MASTER-ROADMAP, STATUS,
AI-PR-READ-FIRST, ARCHITECTURE, GO-LIVE-CHECKLIST, DECISIONS, ROADMAP, OWNER-GUIDE), the Appliance Desk profile
(`APP-NEEDS-APPLIANCE-DESK.md`, rows G1–G20), drift protocol and archive index. The catalog counter moved to
`scripts/count-catalog.py`; profile tools renamed `github_profile_*` so they no longer share a prefix with GitHub
Projects tools; a dated amendment lets a profile allow its own agent steps on an owned branch (Appliance Desk's
`transfer/**`).

**2026-10-10 — Plan written (initial commits):** AGENTS, START-HERE, SESSION-START, PLAYBOOK, research audit (GitHub API,
credentials, old toolkit's 311 tools and 20 bugs, official connector comparison), 15 batch designs, TOOL-CATALOG (301 tools:
295 hand-built + 6 universal, every name `github_…`), owner inputs IN-00 … IN-14, work index (64 cards since the old-toolkit decision note was dropped) with validator,
first card A-1.

## Blocked

Nothing in engineering. IN-00 and IN-01 answered; owner inputs IN-02 … IN-13 (`OWNER-INPUTS.md`; IN-14 answered: not needed)
are open and none blocks A-4.

## Unverified (each has an owner card)

- Paid security feature prices per active committer (O-4 §0 row O4) — read GitHub's pricing page before O-4 and H-4 merge.
- Whether Appliance Desk's `main` ruleset also blocks force pushes and deletion (APP-NEEDS row G3) — P-2 reads it.
- That `2026-03-10` is still the newest REST version when A-4 starts (BATCH-A §0 row A2).
