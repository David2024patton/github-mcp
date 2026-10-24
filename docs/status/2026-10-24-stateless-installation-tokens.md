# 2026-10-24 — GitHub's new (longer) installation tokens

GitHub is moving App installation tokens to a stateless format: still `ghs_`, but a JWT with dots, about 520 characters
(https://github.blog/changelog/2026-05-15-github-app-installation-tokens-per-request-override-header).
- Checked: tokens are stored as TEXT (sealed), every length check allows up to 4096 characters, nothing parses them.
- **Fixed a leak-guard gap (security):** the redaction pattern stopped at the first dot, so a stateless token in a result or
  log line would have kept most of itself visible after `[hidden]`. Patterns in `src/tools/util.js`,
  `src/github/mutation-classes.js` and `src/github/operation-classes.js` now include `.`, `-`, `_`.
- Added the temporary validation switch `GITHUB_STATELESS_INSTALLATION_TOKENS` (`enabled` / `disabled`; unset = GitHub's
  normal rollout), sent as GitHub's `X-GitHub-Stateless-S2S-Token` header when minting. Remove it after validating.
- Tests: `tests/unit/stateless-installation-tokens.test.js` (520-character fake; fails on the old pattern).
- Next (optional, owner row): set the switch to `enabled` on production for a day, check normal tool calls, then remove it.
