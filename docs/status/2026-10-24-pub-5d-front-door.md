# 2026-10-24 — PUB-5 PR D: front door (home page, new name, website button, registry file, Marketplace pack)

**What now works**
- **Home page** at `/` for people in a browser: what it does, the address to paste (shown in one copyable box), "Not affiliated with or endorsed by GitHub.", and connect steps for Claude, ChatGPT, Claude Code, Cursor and VS Code, plus links to My connection, limits, privacy, terms, security, support. No scripts; fits a phone. Programs that do not ask for a web page still get the plain status JSON from `/`.
- **New name:** "Robinson MCP for GitHub" everywhere people see it (page header, Approve page, sign-in form, MCP server title). The "Not affiliated…" line is in every page footer.
- **One version number:** `package.json` feeds the MCP server info and `server.json`.
- **`server.json`** for the official MCP Registry (name `com.robinsonaisystems/github`, remote address, schema dated 2025-12-11 which is the current one).
- **`docs/website/`** button (paste-ready, no scripts) and **`docs/marketplace/`** listing text plus three Playwright screenshots (home, Approve, My connection; fake data; `npm run marketplace:screenshots`).
- Your GitHub number (227716942) is on the checklist for the "free daily limit" exemption.

**Client steps** were checked against each client's own documentation on 2026-10-24 (pages cited in the HTML comment on the home page). Not verifiable from docs: adding a connector on the Claude phone app; the page says the apps use your connectors list "when your version offers it".

**Registry crawlers:** `/api/mcp` answers 401 to everyone without a sign-in, `initialize` and `tools/list` included. Sign-in was not weakened; a directory that cannot sign in will not list the tools.

**How it was checked:** `tests/unit/pub-5d-front-door.test.js`, `tests/browser/home-page.test.js` (three browser profiles; WebKit runs in CI, not on this machine), renamed assertions in older tests.

**Owner action:** rows in `docs/OWNER-CHECKLIST.md` (website button, registry DNS record + publish, Marketplace listing, `PUBLIC_UNLIMITED_SUBJECTS`). **Next:** after the next release, ACC-1 checks `/`, `/limits` and one public sign-in on the live service.
