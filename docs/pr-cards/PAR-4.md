# PAR-4 — GitHub-authorized Enterprise universal REST parity

**Owner authority:** 2026-10-27 completion/parity audit. **Status:** IN_PROGRESS. **Outcome:** A connected full-profile enterprise administrator with an enrolled master credential can use supported, non-curated enterprise REST operations through the universal MCP door, instead of receiving a local blanket denial. Preserve account/enterprise identity, authentic GitHub permissions, spending, tenant and protected-resource policies.

## Pre-source drift and evidence

- `src/tools/enterprise-write.js` directs owners to universal REST for Copilot coding-agent policies, but `src/github/operation-classes.js` rejects every `/enterprises/` operation before examining GitHub authority.
- `src/github/enterprise-access.js` already provides `requireEnterprise(ctx, slug, { scope })`, which checks a real enrolled master credential, `read:enterprise`/ `admin:enterprise`, and GraphQL `viewer.enterprises(membershipType: ADMIN)`. Reuse that verification.
- Pinned operation `copilot/set-enterprise-coding-agent-policy` is a genuine `PUT /enterprises/{enterprise}/copilot/policies/coding_agent` (no same-path GET). For non-readable operations, an accepted provider write is **unconfirmed**, never a fabricated success.
- Existing curated enterprise operations, JWT/secret endpoints, protected list, signed-in tenant scope, spend limits and non-master grants must remain as protected.

## Finite acceptance

- [ ] Universal Enterprise reads/writes accept only explicit `cred: "M"`, a valid enterprise slug, verified enrolled admin ownership and adequate scope; no arbitrary `owner` mismatch or foreign tenant route.
- [ ] `github_api_write` preserves the existing `defineGithubWrite` confirmation, PRODUCTION classification, replay journal, configured spend cap, protected list, no-secret arguments and curated-first exclusions. Provider denial remains a denial; no alternate credential fallback.
- [ ] A write without a safe exact-object GET uses enterprise-admin authorization as preflight and returns unconfirmed after GitHub 2xx; no guessed positive readback.
- [ ] Tests prove allowed authenticated enterprise read/write shape and explicit denial of non-M, non-admin, missing scopes, read-only/pass and foreign scope without an enterprise mutation, plus no repeat on retries.
- [ ] Reconcile user guide/catalog/roadmap/status in bounded project files (never prepend `docs/STATUS.md`), run required exact-head `ci` and `release-policy`, self-review, and merge only when both are green. No manual release, live account policy write or spending.

## Verification status

Plan committed separately before code changes. CI, review, provider acceptance and release not yet claimed.
