# Drift and reconciliation — start of every PR, end of every PR, end of every batch

Code moves while plans sit still. This is how the implementing model keeps plan, cards and code in agreement without
stopping for a planning session. Same shape as the Stripe MCP's and Appliance Desk's protocol (2026-10-09/10). Three
checklists: **A** before coding each PR, **B** inside each PR (written as if merged), **C** when a batch finishes.

This repo has three extra sources of drift:
- **GitHub itself** — the pinned REST version (`2026-03-10`), the vendored OpenAPI description and GraphQL schema
  (`vendor/github-openapi/SOURCE.md`, `vendor/github-graphql/SOURCE.md`), which credential an operation accepts (App
  installation token, user token, classic token — research §4), and plan-dependent features (Free / Team / Enterprise).
- **The contract-generic code copied in A-1** (hub package `robinson-mcp-core` > Stripe MCP `src/core/` > Google Workspace
  MCP files; A-1 records the source and commit).
- **The Robinson Tool Contract** (RTC 1, hub repo `docs/CONTRACT.md`): this server follows a pinned contract version.

| Kind | Example | Do this |
|---|---|---|
| Mechanical | file moved, helper renamed, fixture changed | adapt in this PR, correct the card, run the regression |
| Already delivered | the card's tool exists with a passing write-contract test | remove it from the card, cite the PR/test |
| Compatible extension | GitHub added an optional parameter, enum value or response field at the pinned version | include it in schema, summaries and tests |
| GitHub semantic | an operation or field the design relies on does not exist at `2026-03-10`; an App token is refused where the design expected it to work; a feature needs a paid plan | don't guess. Record GitHub's actual answer (description, docs page, or the scratch organization once IN-06 exists), propose a dated amendment to the design, continue other work |
| Semantic (ours) | different production rule, guard behavior, credential handling, pass permission, merge rule, protected-resource level | dated amendment, reviewed in the current PR before coding that slice |
| Owner-only | production for an account, protected-resource list, own-people list, spend limit, buying anything | keep the gate and its `IN-xx`; never pretend it is done |

## A. Start of every PR (one bounded pass, ~10 minutes)

1. Record: current `main` SHA, the predecessor's merged SHA, the card's "Baseline inspected" SHA.
2. Read the predecessor PR's description (self-review dispositions, carried findings) and the resume note if present.
3. `git diff --name-status <card-baseline>..origin/main -- <card's paths> | head -50`; read each changed function the
   card relies on (≤150 lines).
4. For each GitHub operation the card uses: confirm it exists at the pinned version with the parameters the card names
   (`node scripts/openapi-find.mjs "<words>"`, `node scripts/graphql-find.mjs <mutation>` — from A-4 on; before A-4,
   GitHub's REST reference page for `2026-03-10`) and which credential it accepts (TOOL-CATALOG Cred column; research §4).
5. For a card that copies or changes contract-generic code (`src/core/`): note the source commit and whether the hub's
   `robinson-mcp-core` package now exists (then the card depends on it instead of copying).
6. Write the table in the PR description, then fix the card before coding:

| Card assumption | Actual at `main` / in GitHub's description | Kind | Card correction / test |
|---|---|---|---|

## B. End of every PR (inside the same PR, written as if it had already merged)

CI enforces the minimum (`scripts/check-docs-updated.mjs`, A-1): a PR that changes `api/`, `src/` or `packages/` must also
change `docs/STATUS.md` and its card or `work-index.json`, and `docs/TOOL-CATALOG.md` when it changes `src/tools/` —
unless the PR description says "Docs-update: not needed — <reason>".

1. The card says `MERGED (#n)`; anything split off names its new owner card.
2. Successor card updated (baseline, changed paths/signatures, carried low-risk findings). If it is JIT, put the same
   facts in `docs/designs/CHANGES-SINCE-DESIGN.md`.
3. Living docs: TOOL-CATALOG (Card cell gains `built #n`; `python3 scripts/count-catalog.py` still green), ARCHITECTURE
   (tables, env vars, endpoints, API version, App permissions), GO-LIVE-CHECKLIST (new switch or owner step),
   OWNER-INPUTS (new question or applied answer), OWNER-GUIDE (something Chris can now ask for),
   APP-NEEDS-APPLIANCE-DESK (a row now covered).
4. Queue: STATUS says this merged and names the next card; `work-index.json` status updated; delete the resume note.

## C. End of every batch (one small docs PR)

1. Every PLAN acceptance item for the batch checked with evidence; anything unproved stays open with an owner card.
2. Living docs match the code (ARCHITECTURE tables and env vars, TOOL-CATALOG Card column, OWNER-GUIDE rows).
3. Retire what no longer instructs anyone (`git mv` to `docs/archive/<folder>/`, RETIRED banner at the top, update
   references, one row in `docs/archive/README.md`, one DECISIONS entry).
4. Run the next batch design's "0. Verify before starting" table against today's code and GitHub (API versions page,
   GitHub changelog since the last batch, the vendored description's commit); amend or record "no drift" in STATUS;
   write the next batch's first card.
5. Retire consumed entries in `docs/designs/CHANGES-SINCE-DESIGN.md`.
6. MASTER-ROADMAP, `work-index.json`, STATUS, one DECISIONS entry; tell Chris in plain English.

## Planning while a card is being built

A planning or docs PR that lands while a card is in progress does not edit that card's file, status lines or
`work-index.json` entry; it adds its own sections and says which in-flight card it affects. The implementer reconciles
once, at the PR boundary, by merging `main`.
