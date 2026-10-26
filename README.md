# Robinson GitHub MCP

**Hub compatibility:** This server remains independently usable. Its coding agents should follow the [shared Hub compatibility checklist](docs/HUB-COMPATIBILITY.md) and the linked canonical Hub RTC contract; Hub initiates discovery and keeps provider schemas out of the agent's default tool menu.

A hosted MCP server that lets Chris Robinson's AI agents work in his GitHub accounts safely — for every project:
repositories, pull requests, CI, releases, issues, rules, security, members, apps and billing. Previews before changes,
a separate "production" switch for anything that touches `main`, releases or settings, merges only when CI is green at
the exact commit, secrets and keys that never pass through an AI, and small results that don't burn an agent's context.
It follows the Robinson Tool Contract, so Robinson's Toolkit (the hub) can offer it to any agent alongside Chris's other
servers — and it works fully on its own.

**Status (2026-10-16):** all 64 planned work cards are merged (394 tools). Deployed to Vercel with its own Neon database; the custom GitHub App is installed on owner-designated `robinson-ai-scratch`; custom OAuth and scratch reads were verified after the October 15 reconnect. **Still owner-run: the real-account read-only smoke report, connected scratch write/cleanup acceptance, per-account production activation and Hub route evidence. Production remains OFF.** Gap-closure work is planned in `docs/designs/BATCH-Y.md`. See [`docs/STATUS.md`](docs/STATUS.md), [`docs/OWNER-INPUTS.md`](docs/OWNER-INPUTS.md), [`docs/DEPLOY.md`](docs/DEPLOY.md). Agents read [`AGENTS.md`](AGENTS.md) first.

## Meta Muse and Muse Code

- **Muse Code (native MCP):** Add the hosted `https://github.robinsonaisystems.com/api/mcp` as a `streamable_http` server in `~/.config/muse/settings.json` under `mcp_servers`. Run `muse mcp login github-robinson` to authorize in a browser, then `/mcp` to inspect the available tools. See the complete JSON on the [service home page](https://github.robinsonaisystems.com).
- **Muse personal assistant (Android/iPhone/web):** Use the public `https://github.robinsonaisystems.com/api/mcp` URL. Where Muse registers OAuth automatically, it receives a secretless public client with S256 PKCE. Where Muse asks for credentials, use the **public, nonsecret Client ID** `pcl_meta_muse_public_client_20261026_v1xyz` and **leave Client Secret blank**. Every person authorizes their *own* GitHub account using GitHub sign-in and the service's Approve page; no shared GitHub credential, owner passphrase or account is provided. See the [live-service connection guide](https://github.robinsonaisystems.com). Live Meta Muse client acceptance remains pending; this is not a Meta-approved listing.

This service uses its existing independent OAuth consent, security checks and permission limits with every MCP client. Never paste a GitHub token or password into Muse chat.
