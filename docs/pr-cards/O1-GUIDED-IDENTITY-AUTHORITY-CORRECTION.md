# O-1 owner-guide identity and capability-truth correction — 2026-10-17

**Work kind:** CORRECTIVE MAINTENANCE of already-merged O-1/Y-9 owner guidance, not a new roadmap phase, subsection or bundle. **Baseline:** `dc2b2fc3ed87d10ffdc7e1b09771913617fa84ba`, live independently READY `20389ae0c667ec49d8ce80c5d48f4e2c42f7b2a2`. **Trigger:** Real native `github_admin_list_guided_settings({scope:'user'})` returned `https://github.com/robinson-ai-scratch` for personal profile links despite installed U naming `christcr2012`; current `github_where_is_setting` also substitutes default organization as user. Several static guides falsely say the finished MCP "never" buys, sponsors, or deletes, contrary to `docs/END-USER-AUTHORITY.md`.

## Frozen acceptance — do not shrink after editing

1. `github_admin_list_guided_settings` and `github_where_is_setting` resolve `{org}` from the explicitly enrolled selected organization and `{user}` from the bound actual enrolled personal principal; an organization login must never be represented as its member's personal username. Never derive identity from arbitrary caller input or foreign account.
2. Missing, invalid or unmatched personal enrollment must not generate an actionable fabricated user-profile link, silently fall back to organization login, infer successful authorization, leak a bearer or request new OAuth without evidence. Organization/repo guides still populate correctly, including exact chosen owner and repo, and the existing manual/provider confirmation semantics.
3. Correct legacy owner guides that categorically say the product `never` purchases, sponsors or deletes for **end users**. Explain real provider/API capability, authorization, financial/confirmation guards and manual-only guide status honestly; do not claim the API tool already exists where it does not. Recovery-code and credential-secret prohibitions remain intact.
4. Add unit tests for both guide doors with genuine enrolled org U, personal-account enrollment, no U, foreign account and default/explicit owner, invalid login, and for all affected owner-authority guide text. No provider mutations, paid or production requests, deletion or new OAuth; preserve normal existing tests.
5. Full required exact-head `ci`, `release-policy`, database, shapes, RTC and security gates; substantive self-review and review-thread disposition; expected-head merge only on green. No manual release. Genuine source-bearing READY acceptance remains in original `GITHUB-O1-OWNER-OVERVIEW` queue, no reopened historical PASSED, and original 57-row queue remains 13 PASSED / 44 OPEN until genuine additional proof.

## Integration boundary and delivery accounting

- Reuse `ctx.db.getAccount` and existing `user_login`/credential enrollment state, `fill`, and the O-1 mapping; no schema/API/permission expansions.
- Changes in `src/tools/admin-guided.js`, `src/tools/server-diagnostics.js`, `src/data/dashboard-map.js`, narrowly shared helper if justified, and `tests/unit/o1-admin-guided.test.js`/diagnostic tests.
- Source measurement: record exact meaningful additions/deletions in PR. A contained urgent owner-guidance repair is below the ordinary 400–800 line guideline; do not pad or fabricate a new batch subsection.
- Local runner currently unavailable. Use Git data / GitHub Actions no-shell workflow and label any unrun local tests **unrun**. Do not mark new source as deployed/accepted from CI alone.
