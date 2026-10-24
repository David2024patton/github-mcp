# Marketplace lifecycle — 2026-10-24

Owner approved a separate Marketplace customer lifecycle. Publication hold is lifted.
Branch: `ai/codex/marketplace-free-webhook-20261024`.

Implementation in progress: signed purchase/cancellation ingestion; current GitHub purchase verification and administrator checks; account-specific OAuth/MCP resource and isolated tenant; cancellation barrier, per-token revocation and durable scheduled data deletion. Direct enrollments retain separate tenants and credentials. A keyed account digest and status/effective-date watermark remain to prevent delayed purchase delivery from restoring cancelled access; no customer grant, tenant settings or results are retained after successful cleanup.

Validation: focused resource/cron unit tests pass. Full unit tests pass (9,477 tests), and shape tests pass (21). Full check initially reached its bundle check but needs full git history; history has now been fetched. Disposable PostgreSQL checks must finish in CI before merge. Local PostgreSQL is absent; the repository launcher reports this explicitly. No real credentials are used in tests. No Marketplace production flag, secrets, webhook or cron has been activated.

Remaining activation: exact-head CI/review and merge; secure signing/cron-secret enrollment; published free-plan ID configuration; signed test purchase/cancellation with actual readbacks; owner email verification, trader classification, final trust-page/legal approval and Marketplace agreement/submission. These are not reported complete. Existing custom connector lacks the App installation identity required for merges; do not route around that refusal or override branch rules.
