# STATUS — current work, blockers and next action

Updated 2026-10-10. Plan written by Claude (Opus 5.5) in the same planning system as the Stripe MCP and Appliance Desk.
**Nothing is built yet.** No GitHub App, credential, Vercel project or Neon database exists for this server; nothing
here touches Chris's real repositories.

## Next

- **Chris:** read the plain-English summary in the README and approve the plan (IN-00). IN-01 (public repository, no
  automated review) is applied provisionally, the same as his Stripe decision of 2026-10-10 — say if you want it
  different.
- **Then A-1:** repository, test harness (fake GitHub), CI and doc checks — `docs/pr-cards/A-1.md` (READY).
- **Queue:** A → B → C → D → E → G → V → F → H → O → P → W → U → R → X (`MASTER-ROADMAP.md`).

## Environment

- Repo: `Robinson-AI-Systems/github-mcp`, default branch `main`. The plan commits are local; the planning coordinator
  reviews and pushes them. Because the repository starts empty, the plan goes straight to `main`; every later change goes
  through an `ai/*` branch and a PR.
- Runtime: Node 24.x (DECISIONS 2026-10-10). GitHub REST API version to pin: `2026-03-10`.
- Vercel project, Neon database, GitHub Apps: not created yet (IN-02, IN-03, IN-04, IN-05).

## Recent changes (newest first)

**2026-10-10 — Plan completed (local commits):** process and acceptance files (PLAN, MASTER-ROADMAP, STATUS,
AI-PR-READ-FIRST, ARCHITECTURE, GO-LIVE-CHECKLIST, DECISIONS, ROADMAP, OWNER-GUIDE), the Appliance Desk profile
(`APP-NEEDS-APPLIANCE-DESK.md`, rows G1–G20), drift protocol and archive index. The catalog counter moved to
`scripts/count-catalog.py`; profile tools renamed `github_profile_*` so they no longer share a prefix with GitHub
Projects tools; a dated amendment lets a profile allow its own agent steps on an owned branch (Appliance Desk's
`transfer/**`).

**2026-10-10 — Plan written (initial commits):** AGENTS, START-HERE, SESSION-START, PLAYBOOK, research audit (GitHub API,
credentials, old toolkit's 311 tools and 20 bugs, official connector comparison), 15 batch designs, TOOL-CATALOG (301 tools:
295 hand-built + 6 universal, every name `github_…`), owner inputs IN-00 … IN-14, work index (65 cards) with validator,
first card A-1.

## Blocked

Nothing in engineering except plan approval (IN-00). Owner inputs open: IN-02 … IN-14 (`OWNER-INPUTS.md`); none blocks
A-1 … A-4.

## Unverified (each has an owner card)

- Paid security feature prices per active committer (O-4 §0 row O4) — read GitHub's pricing page before O-4 and H-4 merge.
- Whether Appliance Desk's `main` ruleset also blocks force pushes and deletion (APP-NEEDS row G3) — P-2 reads it.
- That `2026-03-10` is still the newest REST version when A-4 starts (BATCH-A §0 row A2).
