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
