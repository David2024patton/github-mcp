# 2026-10-23 — PUB-6 simple public connect (built dark)
- Built: public clients, branded consent page, GitHub sign-in, App-install detour and resume, self-serve isolated tenant per person, several accounts in one connection, God mode (extra keys per account), token routing for public clients, MCP gate update, product icon and server icon. Off by default (`GITHUB_PUBLIC_CONNECT`).
- Verified: 13 new tests in `tests/db/pub-6-public-connect.test.js` against real PostgreSQL; full db and unit suites; lint.
- Not done (on the card and ROADMAP): making the App public, fine-grained tenants, stranger data deletion, domain move, device acceptance.
- Next: CI, self-review, merge; then the rollout items.
