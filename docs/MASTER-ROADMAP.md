# MASTER ROADMAP — the one handoff

Written 2026-10-10 for an empty repository. [STATUS](STATUS.md) holds current state; [PLAN](PLAN.md) holds acceptance.

## What is next

**Next:** **A-2** foundation database schema — card READY (`docs/pr-cards/A-2.md`); then **A-3** connector login (card
written, two PRs). A-1 (repository, fake GitHub, CI, checks) merged in PR #1. Plan approved by Chris
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
(`python3 scripts/count-catalog.py`: 305 = 299 hand-built + 6 universal).

| Batch | Cards | Tools | Card status |
|---|---|---|---|
| A Foundation | A-1 repo, CI, fake GitHub · A-2 schema · A-3 login · A-4 GitHub client, vendored descriptions, finders · A-5 setup page, Apps from manifests, credential store, one-time secrets · A-6 DEPLOY.md | 2 | A-1 MERGED (#1); A-2 READY; A-3 written (after A-2); A-4 onward JIT |
| B Trust | B-1 safety layer · B-2 production guard · B-3 self-protection and ownership · B-4 access/message/spend · B-5 errors and shaping · B-6 profiles and downscoped tokens · B-7 check-writes · B-8 server tools | 11 | JIT |
| C Context | C-1 small results · C-2 listing modes, meta-tools, budgets | 5 | JIT |
| D Code | D-1 repositories · D-2 files, commits, git data · D-3 branches and tags | 44 | JIT |
| E Pull requests | E-1 read/create/update · E-2 merge at exact head, auto-merge, stacks · E-3 reviews and threads | 24 | JIT |
| G CI and delivery | G-1 Actions and log summaries · G-2 checks, statuses, artifacts, caches · G-3 secrets and variables · G-4 environments and deployments · G-5 releases · G-6 Pages and packages | 51 | JIT |
| V Developer tools | V-1 scenarios, runs, scratch repos · V-2 cleanup · V-3 test branches, PRs, dispatch, check runs · V-4 test webhooks and forwarding · V-5 integration check | 15 | JIT |
| F Issues and planning | F-1 issues · F-2 labels and milestones · F-3 discussions, projects, search | 32 | JIT |
| H Governance and security | H-1 protection and rulesets · H-2 webhooks · H-3 collaborators and deploy keys · H-4 security features, alerts, Actions settings | 33 | JIT |
| O Owner | O-1 admin overview, guided settings, dashboard map · O-2 org and members · O-3 teams and roles · O-4 billing, budgets, Copilot, Codespaces · O-5 apps and tokens · O-6 personal account · O-7 notifications and gists | 61 | JIT |
| P Project profiles | P-1 `known_projects` + two seeds · P-2 app readiness · P-3 project setup + draft profile | 5 | JIT |
| W Workflows | W-1 … W-7 (`designs/BATCH-W.md` §4 table) | 15 | JIT |
| U Universal | U-1 REST · U-2 GraphQL | 6 | JIT |
| R Hub-ready doors (RTC 1) | R-1 passes · R-2 HTTPS API, manifest, OpenAPI, shared rate limit · R-3 conformance in CI | 1 | JIT |
| X Close-out | X-1 undo · X-2 read-only smoke test | 1 | JIT |
| **Total** | 64 cards | **305** | |
