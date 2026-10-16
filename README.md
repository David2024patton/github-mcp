# Robinson GitHub MCP

A hosted MCP server that lets Chris Robinson's AI agents work in his GitHub accounts safely — for every project:
repositories, pull requests, CI, releases, issues, rules, security, members, apps and billing. Previews before changes,
a separate "production" switch for anything that touches `main`, releases or settings, merges only when CI is green at
the exact commit, secrets and keys that never pass through an AI, and small results that don't burn an agent's context.
It follows the Robinson Tool Contract, so Robinson's Toolkit (the hub) can offer it to any agent alongside Chris's other
servers — and it works fully on its own.

**Status (2026-10-16):** all 64 planned work cards are merged (366 tools). Deployed to Vercel with its own Neon database; the custom GitHub App is installed on owner-designated `robinson-ai-scratch`; custom OAuth and scratch reads were verified after the October 15 reconnect. **Still owner-run: the real-account read-only smoke report, connected scratch write/cleanup acceptance, per-account production activation and Hub route evidence. Production remains OFF.** Gap-closure work is planned in `docs/designs/BATCH-Y.md`. See [`docs/STATUS.md`](docs/STATUS.md), [`docs/OWNER-INPUTS.md`](docs/OWNER-INPUTS.md), [`docs/DEPLOY.md`](docs/DEPLOY.md). Agents read [`AGENTS.md`](AGENTS.md) first.
