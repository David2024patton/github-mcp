# START HERE — Robinson GitHub MCP

A hosted MCP server (Node 24.x, plain ES modules, Vercel serverless + Neon Postgres) that gives Chris's AI agents safe,
almost-complete control of his GitHub accounts. Same family and conventions as `Robinson-AI-Systems/stripe-mcp` (the
reference implementation of the server playbook) and `Robinson-AI-Systems/google-workspace-mcp`. General-purpose across
Chris's projects; projects whose own automation manages GitHub get a project profile (Batch P), the first being the
Appliance Desk rental app and the Robinson servers themselves (`docs/APP-NEEDS-APPLIANCE-DESK.md`). Chris operates mostly
from a phone; everything he reads must be plain language.

## Read only what this work needs

1. Implementing a card: [SESSION-START](SESSION-START.md) (one page). Otherwise AGENTS — workflow and hard limits.
2. [STATUS](STATUS.md) — current head/state/next item. **Current live setup, owner approval, connected-smoke gaps and draft PR #83 carry-forward are in its top `Next` checkpoint (2026-10-12).**
3. [MASTER-ROADMAP](MASTER-ROADMAP.md) — order of batches and work coverage.
4. Next card, then its named design headings and code. If JIT, write the short card from the design first;
   [drift protocol](implementation-contracts/DRIFT-PROTOCOL.md) applies every time.
5. PLAN's acceptance for the batch and PLAYBOOK's verification commands.

## Code map (target; confirm the actual path before editing)

`api/` Vercel functions (`mcp.js` connector, `oauth/*` login, `github/setup.js` setup page, `github/manifest-callback.js`
and `github/user-callback.js` credential flows, `github/webhook.js` App installation events, `tools/*` HTTPS API,
`contract.js` RTC manifest) · `src/core/` contract-generic code (no GitHub imports; extracted later into
`robinson-mcp-core`) · `src/github/` the only GitHub client, credentials, rate discipline, CI-state helper, prices,
operation classes, OpenAPI index · `src/tools/` one module per area (`repos.js`, `pulls.js`, `actions.js`, …) plus the
guards (`production-guard.js`, `protect-guard.js`, `people-guard.js`, `spend-guard.js`), `summaries.js`, `errors.js`,
`util.js`, `index.js` (registry) · `src/dev/` scenarios · `src/data/` dashboard map, profile schema · `src/db.js` all SQL ·
`tests/unit|db|shapes|doors` · `scripts/` checks and finders · `vendor/github-openapi/` and `vendor/github-graphql/`
GitHub's published API description and schema for the pinned version.

## One authority per fact

| Fact | Authority |
|---|---|
| Workflow / hard limits | AGENTS; PLAYBOOK for command recipes |
| Current state / ordered work | STATUS / MASTER-ROADMAP / `pr-cards/work-index.json` |
| Remaining acceptance | PLAN |
| How each batch works | `designs/BATCH-*.md` (targeted headings); the card for exact execution |
| Every tool and its safety marks | TOOL-CATALOG (`scripts/count-catalog.py` keeps the totals honest) |
| What each profiled project needs | `APP-NEEDS-<PROJECT>.md` (first: APP-NEEDS-APPLIANCE-DESK), `designs/BATCH-P.md` |
| Owner-only inputs / production switches | OWNER-INPUTS / GO-LIVE-CHECKLIST |
| Runtime facts | code and tests; ARCHITECTURE updated as behavior ships |
| Historical evidence | `audits/`, dated DECISIONS; never current instructions |

Preserve stable IDs (cards, `IN-xx`, decisions). Anything that could touch production, widen access or spend money
starts off. Do not turn a plan or a passing test into a claim of production readiness.
