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

## #136 — complete current read-only OpenAPI wire description

The public OpenAPI document now declares every required path parameter, eight unique operation IDs, public/pass-only security, direct tool argument bodies, 32 KiB JSON request bound, one-to-ten finite read batches, result query limits, retained-handle/RTC envelopes and documented 429 Retry-After. Schemas are exercised against the real restricted adapter’s success/refusal responses and malformed batches; all placeholders resolve. The complete UTF-8 document stays within 8 KiB. No HTTP method, provider tool, scope, mode or guard is added. OpenAPI completeness for this subset is not full RTC1 or deployed/genuine authenticated acceptance. Official OpenAPI 3.1 path-parameter requirement: https://spec.openapis.org/oas/v3.1.0.html.

## #139 — nested RTC meta-tool scope escape correction

A server-owned restricted RTC HTTP pass is scoped to read-only server/meta. The
existing `github_batch` tool advertises read-only area meta but consumes the
full registry and could call nested tools from other provider areas; discovery
wrappers could also describe out-of-area tools. Do not confuse the parent tool's
area with all the operations it can dispatch. The RTC HTTP selector now excludes
all `usesRegistry` wrappers, while keeping the separate built-in HTTP search,
describe, call and batch routes, where each actual read is independently checked.
The original full standalone OAuth MCP registry and its guarded meta tools remain
unchanged. This security regression is proven with the actual dispatcher in unit
CI; no hosted credential, custom OAuth connection or RTC1 certificate is claimed.

## #140 — honest restricted read failure envelopes

The RTC HTTP adapter now runs the existing MCP argument validator before
calling the same original guarded dispatcher. Actual malformed arguments
receive `invalid_args`/HTTP 400 without executing a provider read; dispatcher
failures or missing result shapes receive fixed `service_error`/HTTP 503, not
an invented claim that the caller's request was invalid or a successful null.
Explicit `structuredContent:null` remains a valid empty read. No upstream
private error text is exposed. This is local/CI wire correctness, not evidence
of a deployed revision or authenticated RTC pass/OAuth acceptance.

## #141 — two-phase protected custom RTC pass acceptance tool

The manual `rtc:auth-evidence` command can exercise the service's own public
revision preflight, short-lived owner-provided pass, limited read-only scope,
non-mutating write-discovery denials and a harmless server read. Its second
explicit phase checks that the same pass is refused *after* separate owner
revocation; the script neither issues nor revokes a pass. It refuses non-pinned
origins and deployment mismatch before sending the pass, never prints a token
or response data, and uses only fixed service-owned HTTP routes. No live pass is
available in this agent session; CI uses fake transport exclusively. Thus
source implementation is available but deployed/authenticated custom RTC,
OAuth MCP, Toolkit Hub and cleanup acceptance remain separately unverified.

## #225 — scoped service passes and the conformance run (R-1, R-2, R-3)

Source now supports passes with owner-chosen scope over the same HTTPS contract (preview or production, profile, changes, access changes, spend allowance, areas, repositories, lifetime up to 30 days or a year for the Hub, 1–600 requests per minute, default 120). The pinned upstream runner (`test/upstream/rtc`) runs against this server's real handler and dispatcher with a fixture registry and a fake database; all probes pass except `reads` (the runner expects a >8 KB string to be recoverable in full; this server never replies with more than 8 KB, so long text is paged by offset). The production manifest therefore stays `rtc: 0`. No deployed revision, real pass, real Hub route or OAuth refresh against production was exercised; those remain owner/release-queue acceptance.
