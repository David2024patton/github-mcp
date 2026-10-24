# 2026-10-23 — GOD-1: the master token (God mode as ONE token)

**State:** built on branch `ai/claude/god-1-20261023`; PR and CI to follow. Not live.

**What changed (plain English):**
- God mode is now **one optional master token** (a classic GitHub token with every permission ticked), not a menu of keys.
- Credential kind `M`: checked to be the same GitHub person who signed in, classic tokens only, permissions recorded,
  encrypted, lasts exactly as long as the person set it on GitHub (no limit of ours), revocable.
- The God page walks through four plain steps (create on GitHub with all boxes pre-ticked, copy, paste, continue).
- **Add or remove any time without reconnecting:** new tool `github_master_token_link` returns a private one-use,
  10-minute link to the same page.
- Used only when the App cannot: notifications (K) and packages (P) tools fall back to it for their own exact reads;
  `github_api_*` and `github_graphql_*` accept `cred:"M"` under every existing guard (classification, preview, confirmation,
  production and spend gates, journal). Never for read-only connections, passes or narrowed scopes; never any host except
  `api.github.com`.
- `github_whoami` shows whether it is added, its permission names and expiry (never the token).

**Verified:** `tests/db/pub-6-public-connect.test.js` GOD-1 suite (real Postgres + fake GitHub): wrong person refused,
fine-grained refused, one-use links, fallback limits, host limit, read-only refusal, revoke needs the same person.

**Not done / next:** GOD-2 (purpose-built tools for things only the master token can reach), GOD-3 (expiry reminders,
"what can it do" summary), multi-organization install picker on the sign-in page (currently one at a time, repeating).

**Follow-up (same day, owner request):** no 90-day limit of ours. The token lasts exactly as long as the person set it on
GitHub; a token with no expiry date never expires on our side. `github_whoami` shows days left and, within 14 days, a plain
reminder to replace it with `github_master_token_link`. Already-expired tokens are refused.
