# ROOT-READINESS — public root status must not infer private setup

Status: **MERGED (#163)** when exact-head CI, review and merge complete; external deployment remains separately unverified.
Baseline inspected: `0c010bcb2b74da60502f9092d01c51464cc89c8c` (main, October 13, 2026).
Approved scope: defect correction to A-6/public deployment diagnostics; no new tool, owner decision, OAuth or provider mutation.
Risk area: publicly advertised operational readiness. Migration: none. Production source change: under 50 lines.

## Read only these
- `api/index.js`, `tests/unit/root-route.test.js`, `vercel.json`
- `docs/SESSION-START.md`, `docs/STATUS.md` current milestone
- `docs/HOSTING-COST-POLICY.md` development/deployment protections

## Drift check A

| Card assumption | Independently observed actual main/deployment | Correction and test |
| --- | --- | --- |
| Root status tells owner whether setup is complete | Live READY Vercel at `abdb685f` served hardcoded `status: setup-required` despite already completed IN-06 scratch App setup | Report only HTTP reachability, not private setup state |
| Build SHA equals independently proven deployment | Service-provided env values can be absent, malformed or self-reported | Include only valid 40-hex SHA; explicit `source_sha_independently_verified:false` |
| Anonymous public route can safely expose private readiness | Account, OAuth grant, custom provider and Hub evidence are unavailable to anonymous root | `not_assessed` for private acceptance; no new DB or provider queries |
| Code changes pass full mandatory docs check | CI #38481296710 failed docs-card gate while other functional CI passed | This card reconciles DRIFT-PROTOCOL B; rerun exact-head CI |

## Build and test contract

- File: `api/index.js`, exported `publicInfo(buildSha?)` and default HTTP `handler(req,res)`.
- Preserve registry counts and profile keys. Never report `connected`, `ready-to-use`, or `setup-required` as a fact based on anonymous access.
- Build source is explicitly self-reported; independent Vercel deployment metadata supplies the only verified deployed SHA.
- GitHub operations: **none**. Credentials: **none**. DB requests: **none**. Resource writes, spend, access grants and production activations: **none**.
- Test: `tests/unit/root-route.test.js` covers HTTP 200, no-cache, public links/tool counts, truthful neutral status, SHA validity and no account disclosures.
- Commands: `npx vitest run tests/unit/root-route.test.js`; `npm run check`; `npm test`; `npm run test:shapes`; disposable-Postgres check via required CI.
- CI: exact PR-head six `ci` jobs and `release-policy` mandatory; self-review and unresolved review threads before merge.
- DONE only when code+test+docs meet full gates; actual scheduled main→live promotion and genuinely authenticated custom-MCP TEST acceptance remain explicitly independent.

## Successor

Recheck current main/live/deployed SHA, current owner connection and actual custom `/api/mcp` credential availability. Prove permitted scratch reads/writes/readbacks, scoped denials, revocation and separately authorized cleanup through the custom service. If external evidence is unavailable, continue eligible full workflows from V-1/V-2 without weakening provenance or restarting completed branch housekeeping.
