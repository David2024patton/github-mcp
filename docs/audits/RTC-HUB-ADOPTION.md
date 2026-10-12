# RTC Hub adoption evidence — 2026-10-12

Authoritative RTC 1: Robinson-AI-Systems/robinsons-toolkit-hub docs/CONTRACT.md and D-4.
Pinned runner: hub main f8e61dbca058c29ded572a660082429d5a3e6641
(files: packages/conformance/src/run.js, oauth.js, rate-limit.js, fake-server/server.js).
These exact sources are vendored under test/upstream/rtc and executed by npm run test:rtc in the CI shapes job.

**Not certified:** GET /api/contract deliberately reports rtc:0. The pinned Hub runner
reports its manifest probe FAILED (not skipped/passed); dependent full-conformance
probes are correctly SKIPPED. The reference fake exercises named positive probes.
This server's localhost HTTP adapter verifies pass-only denial, expiration, revocation
and no claim of RTC 1. This is CI coverage, not a live D-4 route certificate.

Owner-approved D-4 scope: short-lived read_only, preview/non-production tests only.
Real direct CLI, private encrypted relay, and Vercel Sandbox routes have NOT been
verified with a live service-owned pass. Do not use ChatGPT's standard GitHub connector
for custom service acceptance. Passes must be created by owner on the protected
setup page, supplied to test runner only through protected environment, and revoked
on the server afterward. Record UTC, exact commit, route, exit, and revocation.
Production disabled, spending $0, independent owner approvals unchanged.

Remaining adoption dependencies: complete RTC 1 tool profiles/area scoping,
guarded HTTPS writes, full conformance (including 2-process shared rate test),
server-side result-handle envelope, real route evidence, and owner revocation proof.

## #110 scope and handle audit
The read-only pass and its separate scope row are atomically created in PostgreSQL. CHECK constraints pin only server/meta reads, no writes, no production and $0 money allowance. The HTTPS gateway independently enforces the stored scope, active scratch designation, expiry/revocation and atomic rate limit per call. MCP OAuth clients and other passes remain distinct. Result handles are surfaced at the RTC envelope's top level and loaded only through the original connection-scoped result store.

**Not RTC 1 certified.** Until owner-assisted real D-4 tests (local direct, GitHub-only encrypted relay, Vercel Sandbox direct), full metadata/writes/profiles/areas implementation, and two-instance conformance pass, the public manifest remains rtc:0. Standard GitHub connector tests, fake GitHub tests, and a READY Vercel deployment must not be called custom RTC connected acceptance.

## #112 batch authorization boundary

Previously the batch endpoint authenticated a pass only once, then reused the initially approved connection for all ten possible reads. A mid-batch revocation, expiry, loss of verified scratch-org status, or rate exhaustion could allow remaining reads under stale authority. The adapter now re-fetches and validates the pass and account before each subsequent read, charges the same shared PostgreSQL rate counter per dispatch, and uses the refreshed connection. Malformed later batch entries are rejected before the first dispatch. Unit coverage uses mutable fake DB state to revoke/narrow between calls; no real credential was exercised.

This hardening does not lift the server/meta read-only scope or certify RTC 1. Hub direct/relay/Sandbox real read-only routes, full conformance, and connected custom OAuth acceptance remain unverified.
