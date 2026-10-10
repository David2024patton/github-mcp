# Robinson GitHub MCP

A hosted MCP server that lets Chris Robinson's AI agents work in his GitHub accounts safely — for every project:
repositories, pull requests, CI, releases, issues, rules, security, members, apps and billing. Previews before changes,
a separate "production" switch for anything that touches `main`, releases or settings, merges only when CI is green at
the exact commit, secrets and keys that never pass through an AI, and small results that don't burn an agent's context.
It follows the Robinson Tool Contract, so Robinson's Toolkit (the hub) can offer it to any agent alongside Chris's other
servers — and it works fully on its own.

**Status:** plan and foundation (repository tooling, tests, CI); no tools yet — see [`docs/STATUS.md`](docs/STATUS.md). Start at [`docs/START-HERE.md`](docs/START-HERE.md). AI agents: read
[`AGENTS.md`](AGENTS.md) first.
