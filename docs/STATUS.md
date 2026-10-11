# STATUS — current work, blockers and next action

Updated 2026-10-10. **The foundation is built (A-1, PR #1):** Node 24 package with a committed lockfile, a fake
GitHub for tests, the check scripts, throwaway-Postgres database tests and CI with one `ci` merge gate. No tools exist
yet. No GitHub App, credential, Vercel project or Neon database exists for this server; nothing here touches Chris's real
repositories.

## Next

- **A-2 — foundation database schema:** `docs/pr-cards/A-2.md` (READY). Branch `ai/<tool>/a-2-schema` from `main`.
  Then **A-3** connector login (`docs/pr-cards/A-3.md`, written; split into A-3a and A-3b).
- **Answered 2026-10-10 (Chris):** IN-00 — plan approved ("I approve the plans"); IN-01 — **no automated review** ("I don't want the automated review at this time"); the repository stays public as Chris created it; the implementer self-reviews every diff.
- **Queue:** A → B → C → D → E → G → V → F → H → O → P → W → U → R → X (`MASTER-ROADMAP.md`).

## Environment

- Repo: `Robinson-AI-Systems/github-mcp` (public), default branch `main`. Every change goes through an `ai/*` branch and
  a PR; the `ci` check is the merge gate.
- Runtime: Node 24.x (`package.json` engines, every CI job). GitHub REST API version to pin: `2026-03-10` (still the
  newest on 2026-10-10).
- Dev commands (all finish by themselves): `npm ci`, `npm run check`, `npm test` (unit), `npm run test:db` (throwaway
  Postgres: CI service, or local binaries — works as root), `npm run test:shapes` (Octokit against the fake GitHub).
- Vercel project, Neon database, GitHub Apps: not created yet (IN-02, IN-03, IN-04, IN-05).

## Recent changes (newest first)

**2026-10-10 — CI cadence (docs + CI config PR #5):** never push while a PR's CI run is in progress (SESSION-START §6,
PLAYBOOK Step 5); obsolete PR runs are cancelled, runs on `main` never are. Next action unchanged.

**2026-10-10 — A-1 foundation merged (PR #1):** `package.json` (Node 24.x, pinned dependencies, lockfile), ESLint,
three Vitest suites (unit, db, shapes), `scripts/check-secrets.mjs` (scans tracked files for GitHub tokens, PEM keys,
non-local database URLs, Neon/Vercel identifiers, committed `.env`), `check-docs-updated`, `check-writes` and
`check-budgets` (starting form), `check-core-imports`, `count-catalog.py` and the index validator in `npm run check`;
`scripts/local-postgres-test.sh`; `test/helpers/fake-github.js`; CI jobs check, unit, db, shapes and the aggregate `ci`.
A deliberately failing test turned `unit` and `ci` red once (https://github.com/Robinson-AI-Systems/github-mcp/actions/runs/38077330755), then was removed; the final run is green at the
exact head (linked in PR #1). Actions pinned to `actions/checkout@v7` and `actions/setup-node@v7` (Node 24 runtimes). Cards A-2 and A-3
written.


**2026-10-10 — Gap check against prior toolkits (local commit):** every GitHub tool name Chris built or planned in
`robinsons-toolkit-mcp`, `robinsonai-mcp-servers` and `robinsons-toolkit-api` (528 names) mapped to this plan in
`docs/audits/2026-10-10-prior-tools.md`: 432 covered by hand-built tools, 59 by the universal tools, 34 dropped with
evidence (GitHub retired the endpoint, Enterprise-only, or out of scope), and 4 gaps added — `github_content_check_codeowners`,
`github_release_delete_asset`, `github_package_delete`, `github_security_compare_dependencies`. Catalog now 305 tools
(299 hand-built + 6 universal). Cortiware, oldReplit and Household-Assistant were checked for GitHub needs too.

**2026-10-10 — Plan completed (local commits):** process and acceptance files (PLAN, MASTER-ROADMAP, STATUS,
AI-PR-READ-FIRST, ARCHITECTURE, GO-LIVE-CHECKLIST, DECISIONS, ROADMAP, OWNER-GUIDE), the Appliance Desk profile
(`APP-NEEDS-APPLIANCE-DESK.md`, rows G1–G20), drift protocol and archive index. The catalog counter moved to
`scripts/count-catalog.py`; profile tools renamed `github_profile_*` so they no longer share a prefix with GitHub
Projects tools; a dated amendment lets a profile allow its own agent steps on an owned branch (Appliance Desk's
`transfer/**`).

**2026-10-10 — Plan written (initial commits):** AGENTS, START-HERE, SESSION-START, PLAYBOOK, research audit (GitHub API,
credentials, old toolkit's 311 tools and 20 bugs, official connector comparison), 15 batch designs, TOOL-CATALOG (301 tools:
295 hand-built + 6 universal, every name `github_…`), owner inputs IN-00 … IN-14, work index (64 cards since the old-toolkit decision note was dropped) with validator,
first card A-1.

## Blocked

Nothing in engineering. IN-00 and IN-01 answered; owner inputs IN-02 … IN-13 (`OWNER-INPUTS.md`; IN-14 answered: not needed)
are open and none blocks A-2 … A-4.

## Unverified (each has an owner card)

- Paid security feature prices per active committer (O-4 §0 row O4) — read GitHub's pricing page before O-4 and H-4 merge.
- Whether Appliance Desk's `main` ruleset also blocks force pushes and deletion (APP-NEEDS row G3) — P-2 reads it.
- That `2026-03-10` is still the newest REST version when A-4 starts (BATCH-A §0 row A2).
