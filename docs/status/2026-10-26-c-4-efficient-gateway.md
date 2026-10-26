# 2026-10-26 — C-4 fast routine gateway (source awaiting review)

Owner approved moving performance into the server so simple or sophisticated agents can get work done quickly. Source branch `ai/chatgpt/efficient-routine-gateway-20261026` has a separately committed acceptance plan at `docs/pr-cards/C-4.md`, indexed after merged C-3 (#415).

The existing `defineWrite` already executes an authorized routine action on the first call without `dryRun`, yet discovery guidance said to always preview and confirm. `src/core/meta.js` now tells agents to make one normal authorized call and to use a separate confirmation only when the server actually returns `needs_confirmation`. The write guard code and production, spending, access, notification, branch/race and idempotency protections remain unchanged. `src/tools/meta.js` now issues independent read batches in 3-wide waves (up to 10 total) without changing the per-call dispatcher, preflight write denial, profile, optional consent or output shaping. `tests/unit/meta-tools.test.js` adds bounded concurrency, result order, one-item failure and no-read-on-mixed-batch checks.

Documentation: `docs/OWNER-GUIDE.md`, `docs/TOOL-CATALOG.md`, `docs/DECISIONS.md` and `docs/pr-cards/C-4.md`. Pending: exact-head full CI and release-policy, self-review and merge. No real-account mutation, published speed measurement or early live release is claimed.
