# CONTRIB-3 — Bound OAuth request data regardless of transport parser

Owner requested 2026-10-26 that the maintainer handle each outside PR, including modifying it ourselves or declining unsafe parts. David2024patton PR #399 proposes per-instance rate limiting, 64KB request caps and 400 on malformed requests. A serverless instance-local throttle is not a reliable cross-instance quota; the shared core already enforces a 16KB limit on raw request strings, but accepts unlimited already-parsed JSON objects.

## Drift check

- `src/core/http.js` `paramsOf` currently rejects strings larger than 16384 bytes and arrays but returns any non-array object with no byte-size check.
- The public registration handler `src/tenancy/public-http.js` catches most errors as 503, including a malformed body, which misrepresents bad client requests as unavailable service. Legacy registration and token endpoints already respond 400 for parsing failures.
- GitHub public sign-in has existing capacity and per-person database-backed limits, but none is a uniform pre-auth per-IP quota. Claiming a distributed per-IP limit from an in-memory `Map` would be misleading; a genuinely shared bounded store is a separately designed capability requiring independent cost/security analysis.
- The rest of the service uses `paramsOf`; regression tests and existing accepted normal object/form requests must keep working.

## Acceptance: commit plan FIRST, then implement

1. Enforce the existing 16384-byte maximum for **every** accepted `paramsOf` POST object and string, using UTF-8 byte length of serialized JSON for parsed objects; fail closed for cyclic/invalid serializations, arrays, nonstring bodies and oversized raw inputs. Never trust a caller-supplied `Content-Length` in place of measuring data.
2. Public dynamic OAuth registration must return 400 `invalid_client_metadata` for malformed/oversized data before initiating registration or other side effects. Preserve 201 for valid public registration and 503 for actual database/capacity errors. Legacy OAuth registration/token/authorize already use 400; verify regression behavior.
3. Unit tests: valid parsed JSON and raw form, exact boundary, above-boundary string and parsed objects including multibyte UTF-8, cyclic object, arrays, and malformed raw JSON; public registration and token respond expected error without invoking DB on invalid body. Verify the size limit is truly the parser's existing limit, not a new arbitrary 64KB promise.
4. Do **not** adopt per-Vercel-instance anonymous limiter as global protection. Record future shared, bounded pre-auth abuse controls as backlog, with DB write-amplification and IP privacy considered before implementation. No new table, DB migration, cost, permissions or runtime setting.
5. Run exact-head CI and release-policy, resolve reviews, guarded merge, then thank David and close #399 as partially incorporated/superseded. Retain user-facing honesty about what this change does and does not guarantee.

No production data mutation, spending, new plans, OAuth behavior downgrade, protected-resource setting change or direct `main` commit.
