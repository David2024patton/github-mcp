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

## #116 RTC discovery and batch result follow-through (MERGED; CI verified)

Reject ambiguous array/unknown/oversized discovery parameters before reading the scoped catalog. A batched read that stores oversized output now returns its connection-owned handle and summary for that individual call, without returning the retained payload. This closes the gap between single and batched reads. Unit tests cover both paths. RTC remains rtc:0; genuine Hub direct/relay/Sandbox, owner pass revocation, custom OAuth-connected testing and V-2 cleanup are still unverified.

## #117 RTC HTTP wire limits

Single read calls and batched calls now reject JSON bodies exceeding 32 KiB measured in UTF-8 bytes, with a strict top-level batch envelope. This bounds pass-only resource consumption before the dispatcher. Fake HTTP tests exercise valid small reads, oversized multibyte payloads, and unknown envelope keys. No external D-4 evidence, full RTC certification or real OAuth-connected cleanup claim.

## Service-specific gateway recovery acceptance — 2026-10-12

RTC0 manifest must not be changed to RTC1 merely to unblock a Hub probe. Remaining full metadata/profiles/areas/write and two-instance conformance must be reconciled; a separately reviewed restricted read subset is not certification. Existing scratch/default-label ownership and protected OAuth gates remain independent. No standard GitHub connector proves custom MCP acceptance.

## #134 — actual two-process shared-database subset verification

`tests/db/rtc-cross-process.test.js` starts two separate Node HTTP processes using `test/helpers/rtc-rate-worker.mjs`. Each process opens its own PostgreSQL connection to the same uniquely named disposable localhost schema and executes the real restricted `createRtcHttpHandler`, `getRtcPass`, account-isolation checks and atomic `consumeRtcPassRate`. Sixty-four overlapping authenticated whoami requests must produce exactly sixty successes and four 429 responses with `rate_limited`/Retry-After. Both processes independently refuse the revoked pass and later removed scratch designation. A separate pass retains an independent rate budget. Child processes inherit only the disposable database/schema configuration; no provider credentials or passes appear in command lines or output.

This closes the previously missing automated cross-process test for the implemented read-only RTC subset. The pinned full runner still reports rtc:0 and skips its dependent full-conformance checks; this subset result is not a fabricated passing `limits.two_instance` runner probe. Mode stays preview, not TEST. No actual deployed URL, owner-issued live pass, Hub route, OAuth acceptance or certification is asserted. Local PostgreSQL is absent; mandatory CI's disposable database runs this test before merge.

## #135 — service identity and restricted HTTPS capability evidence

Public manifest retains the full standalone catalog totals/profiles/modes, with a separate `https_subset` that names the real service-issued pass authentication, server/meta areas, preview mode, read_only profile and exact zero-write/zero-money subset count. One selector is used for both HTTP dispatch and this public count; tools lacking read-only hints, write tools and passthrough wrappers stay out. Authenticated whoami additionally returns explicit production/money restrictions and the same service identity. This is discovery evidence, not a credential or grant.

`service_identity.reported_revision` uses only a canonical 40-character lowercase `VERCEL_GIT_COMMIT_SHA`; absent/malformed data yields null. `independently_verified` stays false: compare self-report against independently fetched deployment source metadata before accepting a running revision. No secret/ID/host/other environment value is returned. The standalone OAuth MCP door and original dispatcher/state remain unchanged; no shared core or Hub connection is required. RTC0, preview mode and both full/deployed authenticated acceptance flags stay unverified.

#134's exact-head and final-main cross-process tests both passed; the final-main database suite separately exposed an old elapsed-time assumption in the provider write-queue contract. #135 corrects that fixture using transaction-frozen PostgreSQL time for slot tests only, retaining all thresholds and adding exact unchanged reservation assertions; expiry tests retain real time. Database CI must demonstrate the corrected contract before merging.
