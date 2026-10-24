# INV-1 — finish the capability inventory (credential support and conflicts)

**Batch FIN · Design:** `docs/designs/MAXIMUM-AUTHORITY.md` CAP-1 · **Prerequisites:** GOD-2 (so `M` routing exists) ·
**Effort:** light (data work, careful) · **Split:** one PR per ~300 operations if large.

## Outcome
`node scripts/capability-inventory.mjs --report` shows **0 unresolved conflict rows** and every
not-yet-classified row either decided from endpoint-specific evidence or explicitly left unknown with a reason: each of the 1,549 operations gets a credential decision where evidence exists (which of App installation `I`, App user `U`,
master/classic `M`, fine-grained token can call it) from an official source, and every conflict between sources has a
recorded resolution. 2026-10-23 report: 1,176 unclassified, 65 conflict rows.

## Read only these
`src/github/capability-inventory.js` (record shape: `credentialSupport.{app_installation,app_user,classic_pat,…}.disposition`),
`src/github/capability-evidence.js` (where reviewed decisions are stored), `scripts/capability-inventory.mjs`.

## Drift check A
| Expected | Actual on main | Action |
|---|---|---|
| report: unclassified 1,176; conflicts 65 | | |
| reviewed decisions live in `src/github/capability-evidence.js` (or the file the inventory imports for them) | | |

## Steps
1. **Use the pinned description first (no network), one fact at a time — never infer one credential from another:**
   - `x-github.enabledForGitHubApps === false` → `app_installation` and `app_user` = `unsupported`. It says NOTHING about
     classic tokens: leave `classic_pat` as it is.
   - `classic_pat` = `supported` ONLY when that operation's own description text names it, e.g. GitHub's standard
     sentence "OAuth app tokens and personal access tokens (classic) need the `<scope>` scope to use this endpoint"
     (record the scope). Search the operation's `description` with a regex; store the matched sentence as evidence.
   - Paths under `/app/` and `/app-manifests/` that say "You must use a JWT" → `app_jwt` = `supported`, every other
     credential `unsupported` for that row.
   - No endpoint-specific evidence → keep `unknown` and add `reason: 'no endpoint-specific authentication evidence'`.
   Evidence object: `{source:'pinned-openapi', revision:<vendor/github-openapi/SOURCE.md sha>, text:<matched sentence>}`.
2. **Official permission pages** (fetch with the web tool, cite URL + date in evidence): "Permissions required for GitHub
   Apps", "Permissions required for fine-grained personal access tokens", "Endpoints available for GitHub App user access
   tokens". Where a page contradicts the pinned flag (example: `GET /user` is flagged not-for-Apps but works with `U`),
   record a conflict resolution: the more specific official page wins; note both.
3. **GraphQL:** no default. Record a credential as supported only from evidence for that field (GitHub docs pages for
   the object, or a schema directive); otherwise leave `unknown` with the same reason as step 1.
4. Update `MASTER_AREAS` (GOD-3) if a row shows a whole family is M-only and not yet listed.
5. Tests: the inventory validator (`node scripts/capability-inventory.mjs --validate`) must stay green; add a unit test
   that conflicts unresolved = 0 and that every `unknown` row carries a `reason`.

## Done when
- [x] Every row has a decision backed by endpoint-specific evidence, OR stays `unknown` with the reason "no
      endpoint-specific authentication evidence" (an honest unknown is better than a wrong decision; never fill gaps by
      inference). 0 unresolved conflicts; each decision has evidence (source + date or pinned sha).
- [x] A unit test proves `GET /app/hook/config` is recorded as JWT-only (not classic token).
- [x] No coverage percentage is printed (unchanged rule); "verified" still means real-account evidence only.

## Progress
- Built (one PR). Source of the decisions: GitHub's own per-operation token lists (github/docs `src/github-apps/data/fpt-2026-03-10`, commit
  `02c25d16`, vendored as `vendor/github-app-permissions/fpt-2026-03-10.json`, regenerate with `scripts/vendor-app-permissions.mjs`) plus each
  operation's own text in the pinned REST description (`src/github/credential-derivation.js`). Hand-reviewed rows keep priority and a test proves
  the derived decisions never contradict them.
- Result (`node scripts/capability-inventory.mjs --report`): unresolved conflict rows 65 -> 0 (227 rows now carry a written resolution);
  1,232 of 1,232 REST operations have at least one credential type decided from official evidence; GraphQL stays unknown with a reason
  (no field-level evidence exists); every unknown carries `reason`.
- Design choice (docs/DECISIONS.md 2026-10-24): where the pinned description flag says "not for GitHub Apps" but GitHub's per-operation list includes
  the operation (149 rows), the list wins and both statements are kept; where the description enables Apps but the lists omit the operation
  (51 rows), the answer stays unknown with the reason written down.
- Step 4 (MASTER_AREAS): no whole family is newly master-token-only. `classroom` is already listed; `agent-tasks` and `credentials` have no
  classic-token evidence, so they stay unknown.
