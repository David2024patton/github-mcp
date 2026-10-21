# MASTER ROADMAP — the one handoff

## Gateway dependency correction — 2026-10-12

RTC interface work and authorized nonproduction Hub route acceptance are independent of K-3 package adoption.
Follow current STATUS/index and service isolation/owner gates. Optional reuse must not block provider capability
or require replacing service-owned dispatch/state. Hub's H-1–H-3 work belongs in its repository.

Written 2026-10-10 for an empty repository. [STATUS](STATUS.md) holds current state; [PLAN](PLAN.md) holds acceptance.

## What is next

**Owner-approved maximum authority expansion (2026-10-21):** [MAXIMUM-AUTHORITY](designs/MAXIMUM-AUTHORITY.md) registers CAP-1..CAP-5 as approved; CAP-1 source delivery is reconciled for PR #272 (final exact-head CI/merge still required; no live capability credit): operation inventory, Standard Full access, additional credential enrollment, advanced capability gaps and independent acceptance. Full is available without God Mode; extra credentials only unlock genuinely credential-dependent authority. Existing acceptance/PUB-4 retain priority; publication-only PUB-5 does not block CAP. 98.3% is not a functional coverage measure. GitHub Models is retired, not planned.

**Private-first public-scale expansion (owner 2026-10-18):** PUB-1 and PUB-2 are MERGED, PUB-3 is source-complete in PR #267 pending final exact-head CI/review/merge, and PUB-4 is APPROVED, NOT IMPLEMENTED in `docs/pr-cards/work-index.json`, while PUB-5 is **BLOCKED** pending third-party publication eligibility and explicit owner publication approval. The existing 57-row real-world acceptance queue still takes priority under SESSION-START. Follow `docs/designs/PUBLIC-SCALE.md` and write one JIT card before implementing each PUB unit, bundling related completed cards. OpenAI's current Plugin Directory guidelines do not approve primarily unofficial third-party connectors, so **do not assume this GitHub MCP can be publicly listed under any name**. Private/workspace distribution and standalone MCP use remain the safe engineering target while authorized alternatives are evaluated.



**Next after Y-9 (#233) is merged:** Batch Y approved engineering is complete (Y-1–Y-9), while provider/RTC and owner-run real-account acceptance remains open. Required work includes the real-account read-only smoke report (`scripts/smoke-readonly.mjs`), installing/upgrading GitHub App permissions (IN-15 and Y-9d additions), user U authorization, OAuth-connected scratch writes and authorized cleanup, per-account production activation, and independently deployed direct RTC1 provider conformance using its own service-issued grant; Hub-owned discovery, relay and Sandbox routes are optional integration evidence, not provider completion gates. Also continue the separate `docs/END-USER-AUTHORITY.md` product-wide audit: previous developer-only limits may still affect older feature paths. These items must not be silently marked passed from synthetic CI or from this source merge. `npm run session:status` prints the live queue.

A-1 (repository, fake GitHub, CI, checks) merged in PR #1; A-2 (foundation schema) in PR #7; A-3 (connector login) in PRs #8 and #9; A-4 (GitHub client) in PR #10; A-5a (credential store) in PR #11; A-5b (setup page) in PR #12; A-5c (webhook, `github_whoami`, `github_list_accounts`) in PR #13; A-6 (`docs/DEPLOY.md`) in PR #15; B-1 (write safety layer) in PR #16; B-2 (production guard and switch) in PR #18; B-3 (protected list and project ownership) in PR #19; B-4 (people and spend guards) in PR #20; B-5 (errors and result shaping) in PR #21; B-6 (profiles and downscoped tokens) in PR #22. Plan approved by Chris
(IN-00, 2026-10-10).

## Order and why

| Stage | Batches | Why in this place | Owner gate |
|---|---|---|---|
| 1 Foundation | A | Nothing works without it: tests, login, GitHub Apps from manifests, one polite GitHub client | IN-02/IN-03/IN-04/IN-05 before A-5 can be tried for real |
| 2 Safety | B → C | Every later tool is built on the trust layer (production guard, self-protection, access/message/spend guards) and the context rules | IN-07, IN-08, IN-09, IN-12, IN-13 (defaults; none blocks building) |
| 3 The build conveyor | D → E → G | What Chris's own build process runs on every day: code, branches, PRs, merge at the exact head on green, review threads, CI with log summaries, releases | — |
| 4 Building with GitHub | V | Developer tools for any project: scratch repositories, test branches and PRs, dispatch and wait, simulated checks, webhook deliveries forwarded into apps under development, cleanup by run | IN-06 (scratch organization) before real use |
| 5 The rest of the repository | F → H | Issues and planning; then governance and security (protection, rulesets, webhooks, access, alerts) | IN-11 (optional notifications token) |
| 6 Owner side | O | Admin overview, members, teams, billing and spend, apps and tokens, personal account, every dashboard setting guided | IN-09, IN-11, IN-13 |
| 7 Projects and workflows | P → W | Optional project profiles (Appliance Desk and the Robinson servers first) and the one-sentence jobs | — |
| 8 Everything else | U → R | Universal REST and GraphQL access; the contract doors Robinson's Toolkit (the hub) uses to reach this server | IN-10 |
| 9 Close-out | X | Undo, read-only smoke test on the real accounts | IN-04, IN-05 |
| Production | GO-LIVE-CHECKLIST | Only after Chris turns production on per account | IN-07 |

## Implementing agent — paste this

> Read `docs/SESSION-START.md`, STATUS and the next card (plus its resume note `docs/pr-cards/<ID>.progress.md` if
> present). Find the cited design headings and named code/tests in bounded sections. Run the drift protocol checklist A
> against latest main. If no card exists, write one short card from the approved design (`docs/pr-cards/README.md`) with
> exact current paths, credential/secret/guard/production boundaries, meaningful tests and completion evidence. Routine
> details are yours to implement; a missing security, production, credential or schema decision needs a reviewed
> amendment, not a guess. Implement a coherent unit, run the targeted checks, push once. While checks run, implement only
> the eligible immediate successor. Write the self-review, fix blocking findings in one patch, refresh exact-head gates,
> merge when authorized and green. Update the card, STATUS and `work-index.json` as if merged. Continue while eligible
> work exists; stop only for a real gate, with committed work and the exact next action.

## Work coverage

`docs/pr-cards/work-index.json` is the machine-readable list (`python3 docs/pr-cards/validate-index.py`). **JIT** = covered
by the approved design; write the card when its predecessor is real. Tool counts are from `docs/TOOL-CATALOG.md`
(`python3 scripts/count-catalog.py`: 411 = 405 hand-built + 6 universal).

| Batch | Cards | Tools | Card status |
|---|---|---|---|
| A Foundation | A-1 repo, CI, fake GitHub · A-2 schema · A-3 login · A-4 GitHub client, vendored descriptions, finders · A-5 setup page, Apps from manifests, credential store, one-time secrets · A-6 DEPLOY.md | 2 | A-1 MERGED (#1); A-2 MERGED (#7); A-3 MERGED (#8, #9); A-4 MERGED (#10); A-5 split: A-5a MERGED (#11), A-5b READY; A-6 onward JIT |
| B Trust | B-1 safety layer · B-2 production guard · B-3 self-protection and ownership · B-4 access/message/spend · B-5 errors and shaping · B-6 profiles and downscoped tokens · B-7 check-writes · B-8 server tools | 11 | MERGED |
| C Context | C-1 small results · C-2 listing modes, meta-tools, budgets | 5 | MERGED |
| D Code | D-1 repositories · D-2 files, commits, git data · D-3 branches and tags | 44 | MERGED |
| E Pull requests | E-1 read/create/update · E-2 merge at exact head, auto-merge, stacks · E-3 reviews and threads | 24 | MERGED |
| G CI and delivery | G-1 Actions and log summaries · G-2 checks, statuses, artifacts, caches · G-3 secrets and variables · G-4 environments and deployments · G-5 releases · G-6 Pages and packages | 51 | MERGED |
| V Developer tools | V-1 scenarios, runs, scratch repos · V-2 cleanup · V-3 test branches, PRs, dispatch, check runs · V-4 test webhooks and forwarding · V-5 integration check | 15 | MERGED |
| F Issues and planning | F-1 issues · F-2 labels and milestones · F-3 discussions, projects, search | 32 | MERGED |
| H Governance and security | H-1 protection and rulesets · H-2 webhooks · H-3 collaborators and deploy keys · H-4 security features, alerts, Actions settings | 33 | MERGED |
| O Owner | O-1 admin overview, guided settings, dashboard map · O-2 org and members · O-3 teams and roles · O-4 billing, budgets, Copilot, Codespaces · O-5 apps and tokens · O-6 personal account · O-7 notifications and gists | 61 | MERGED |
| P Project profiles | P-1 `known_projects` + two seeds · P-2 app readiness · P-3 project setup + draft profile | 5 | MERGED |
| W Workflows | W-1 … W-7 (`designs/BATCH-W.md` §4 table) | 15 | MERGED |
| U Universal | U-1 REST · U-2 GraphQL | 6 | MERGED |
| R Hub-ready doors (RTC 1) | R-1 passes · R-2 HTTPS API, manifest, OpenAPI, shared rate limit · R-3 conformance in CI | 1 | MERGED #225 |
| X Close-out | X-1 undo · X-2 read-only smoke test | 1 | MERGED |
| Y Gap closure (designed 2026-10-16) | Y-1 unblock universal tools · Y-2 GraphQL write specs · Y-3 other people's data, follow, star lists · Y-4 Projects v2 lifecycle · Y-5 moderation, org issue types/fields · Y-6 runners, Actions admin · Y-7 security writes · Y-8 artifacts, archives, uploads, jobs, wiki · Y-9 org long tail, read-backs, guides | ~80 planned | Y-1 and Y-2 merged (#227), Y-3 and Y-4 merged (#228), Y-5 and Y-6 merged (#229), Y-7 merged (#230), Y-8 merged (#231); Y-9 source complete (#233); live permission upgrades and provider acceptance pending |
| PUB public-scale readiness | PUB-1 tenant isolation · PUB-2 delegated onboarding · PUB-3 capacity/abuse · PUB-4 mobile+desktop acceptance · PUB-5 independently approved publication gate | No new tools counted yet | PUB-1/2 **MERGED**; PUB-3 **source-complete, PR #267 pending review/merge**; PUB-4 **APPROVED**; PUB-5 **BLOCKED** pending external policy/owner decision |
| CAP maximum legitimate authority | CAP-1 inventory · CAP-2 Standard Full · CAP-3 additional credentials · CAP-4 advanced gap closure · CAP-5 acceptance | No new tools claimed | CAP-1 source reconciled in PR #272 (merge gates required), CAP-2..CAP-5 **APPROVED / NOT IMPLEMENTED** |
| **Total** | **83 cards** (78 previously indexed + 5 CAP) | **411 currently built or planned, PUB counts not claimed** | |
