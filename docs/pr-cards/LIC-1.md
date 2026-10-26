# LIC-1 — Declare current source rights and contribution review policy

**Requested 2026-10-26:** The owner wants David2024patton to keep contributing by PR without automatically accepting everything and asked for a documented licensing policy. The owner is also evaluating, but has NOT authorized, making the upstream repository private.

## Drift check / existing state

- `Robinson-AI-Systems/github-mcp` is public, owned by a GitHub Free organization, and has no root LICENSE or CONTRIBUTING file as of the branch base `9683ae6`.
- `package.json` has `"private": true` for npm publication; that field **does not** license source code or make the GitHub repository private.
- Without an express software license, copyright is reserved by default. No open-source license (MIT/Apache/GPL) has been chosen by the owner.
- David's existing public fork is separate from upstream; making upstream private is out of scope, would not convert his fork, and needs a separate owner decision.

## Acceptance — commit this plan before drafting files

1. Add a clear, conservative root `LICENSE` describing the **existing default**: original project material is all-rights-reserved, no public-source use/distribution grant, and third-party dependencies remain under their respective licenses. Do not introduce an OSI open-source license, claim ownership over contributors' own code, or purport to override GitHub's Terms of Service.
2. Add `CONTRIBUTING.md` explaining that collaborators propose changes via feature branches and PRs; the owner/maintainer reviews each diff for security, correctness, tests, release cost and scope, may approve/request revisions/reject, and only an intentional accepted green PR may merge. Require contributors to have rights to their submitted material, call out third-party licenses, and avoid submitting credentials or private data. Do not silently grant access or automatic merge authority.
3. Link both documents in README, add brief owner-facing status/decision note; perform exact-head required `ci` and `release-policy` checks. Do not make upstream private, change visibility, invite collaborators, change Actions spend cap, or release production.

## Review drift and correction

- GitHub review on PR #410 identified a forbidden addition to the top of `docs/STATUS.md`. Removed that shared ledger edit; retained the separate `docs/status/2026-10-26-license-contribution-policy.md` note per AGENTS.md.
- The private-repository evaluation verified an additional decisive constraint: Free organizations cannot enforce required branch protections on private repositories. A Team-or-higher plan would be needed before the owner can preserve equivalent CI enforcement. No plan upgrade is authorized.

## Legal and release boundary

This is a documentation of the pre-existing copyright default, **not** an open-source license or permission for third parties to redistribute the code. If the owner wants MIT, Apache-2.0, a custom commercial license, or a contributor agreement, obtain that separate business/legal decision before granting rights. A final PR merge still follows the repo's normal reviews and checks. Scheduled release is unaffected.
