# INV-1 — finish the capability inventory (credential support and conflicts)

**Batch FIN · Design:** `docs/designs/MAXIMUM-AUTHORITY.md` CAP-1 · **Prerequisites:** GOD-2 (so `M` routing exists) ·
**Effort:** light (data work, careful) · **Split:** one PR per ~300 operations if large.

## Outcome
`node scripts/capability-inventory.mjs --report` shows **0 "not yet classified"** rows and **0 unresolved conflict
rows**: every one of the 1,549 operations has a credential decision (which of App installation `I`, App user `U`,
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
1. **Use the pinned description first (no network):** for every REST operation, `x-github.enabledForGitHubApps`
   (false → `app_installation` and `app_user` = `unsupported`, `classic_pat` = `supported`) and, when present,
   `x-github.enabledForGitHubApps`/fine-grained metadata. Write these as reviewed decisions with evidence
   `{source:'pinned-openapi', revision:<SOURCE.md sha>}`. This alone classifies most rows.
2. **Official permission pages** (fetch with the web tool, cite URL + date in evidence): "Permissions required for GitHub
   Apps", "Permissions required for fine-grained personal access tokens", "Endpoints available for GitHub App user access
   tokens". Where a page contradicts the pinned flag (example: `GET /user` is flagged not-for-Apps but works with `U`),
   record a conflict resolution: the more specific official page wins; note both.
3. **GraphQL:** mutations/queries default to `app_user` + `classic_pat` supported unless the schema directive or docs say
   otherwise; record as `reviewed-default` with that reason so they are not counted unknown.
4. Update `MASTER_AREAS` (GOD-3) if a row shows a whole family is M-only and not yet listed.
5. Tests: the inventory validator (`node scripts/capability-inventory.mjs --validate`) must stay green; add a unit test
   that the report counts unclassified = 0 and conflicts unresolved = 0.

## Done when
- [ ] Report shows 0 unclassified and 0 unresolved conflicts; each decision has evidence (source + date or pinned sha).
- [ ] No coverage percentage is printed (unchanged rule); "verified" still means real-account evidence only.
