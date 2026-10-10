# Execution cards — just in time

Same system as the Stripe MCP and Appliance Desk. The implementing agent writes a short card for the current unit and,
when useful, its immediate successor. Sol 5.6 at light/medium effort is the intended routine use. Avoid writing distant
cards whose prerequisites are hypothetical; `work-index.json` preserves all later scope. A missing card is work, not a
reason to stop. Designs govern behavior; cards cannot silently override them.

## Minimum card (usually 40–100 lines)

- ID, title, design section, prerequisites, "Baseline inspected" SHA.
- One risk area, migration ownership (if any), realistic budget (≤500 production lines).
- **Read only these:** a bounded list of design headings and files (with line ranges when long).
- Drift check A table (or "first card: no prior code").
- Build contract: files, exported signatures, which tools (by TOOL-CATALOG name) with their safety marks (production,
  access, message, spend), credential (`I`/`U`/`K`), summaries used, GitHub operations (method + path from
  `node scripts/openapi-find.mjs`, or the GraphQL mutation/query from `node scripts/graphql-find.mjs`).
- Named tests: unit, write-contract (nine checks) per write tool, request-shape test per GitHub call (fake GitHub
  validates against the vendored description), db when SQL changes.
- Commands to run (with `set -o pipefail` when piping).
- Done when: observable conditions; what the successor inherits.

Validate coverage with `python3 docs/pr-cards/validate-index.py` and the catalog with `python3 docs/count-catalog.py`.

## Effort guide for Sol 5.6

Light: read tools in an area whose pattern already exists; docs cards. Medium: the trust layer and every guard, merges,
secrets, credentials and login, passes, universal tools, developer tools, anything touching SQL. A Sonnet/Opus second
opinion is optional and limited to one concrete question; no mandatory model switch.
