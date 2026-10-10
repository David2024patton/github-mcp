# PLAYBOOK — how to deliver one PR card, step by step

The rules are in `AGENTS.md`; the short start is `docs/SESSION-START.md`; the work is the card in `docs/pr-cards/`.
Same procedure as the Stripe MCP's PLAYBOOK, adapted to this repo (no official GitHub mock: request shapes are validated
against GitHub's own published description instead).

## Step 0 — Orient (minutes, not a reading session)

1. `git fetch origin && git status -sb`. Resume the branch/PR in `docs/STATUS.md` (and the card's resume note) before
   starting anything new. Never discard local work.
2. Read the card. If the roadmap row says JIT, write the card first from the design and current code
   (`docs/pr-cards/README.md`). A missing card is work, not a reason to stop.
3. Read only what the card names, a section at a time.
4. Check `docs/OWNER-INPUTS.md` only for inputs this card needs. Build what doesn't depend on a missing answer; keep
   the dependent behavior off; list the ID.

## Step 0b — Drift check (every card)

`docs/implementation-contracts/DRIFT-PROTOCOL.md` checklist A before coding; B inside the PR; C at batch end.

## Step 1 — Branch

`git checkout -b ai/<tool>/<topic>` from current `main` — or from the unmerged predecessor's branch when stacking.
At most two unmerged implementation PRs in one chain.

## Step 2 — Inventory before coding

`grep` the area (`src/tools/<area>.js`, `src/github/`, `tests/unit/<area>*`). Reuse existing helpers (`defineWrite`,
the guards, `summaries`, `listAll`, the CI-state helper, write-contract helper). For a new GitHub call, look the operation
up in GitHub's description first: `node scripts/openapi-find.mjs "merge a pull request"` or
`node scripts/graphql-find.mjs resolveReviewThread` (built in A-4) and the official reference page; cite the reference
URL in the PR. Check which credential it needs (catalog Cred column; research §4).

## Step 3 — Implement in ordered commits

One work unit = one local commit. Inside it: (1) additive SQL + `docs/ARCHITECTURE.md` table row if the database
changed; (2) the tool module with its unit tests **in the same commit**; (3) its request-shape test; (4) registry
metadata (`area`, `profiles`, `writes`, `production`, `accessWidening`, `notifies`, `spend`, `cred`, `audience`) and the
TOOL-CATALOG Card column.

While implementing:
- Every write tool: `defineWrite` with `plan` (reads the target from GitHub first), `target`, `classify`, `apply`,
  `readAfter`, `verify`, a price function when it spends, `inverse` when it has a clean opposite.
- Every read tool: a summary mapper (or an existing one), text caps, and the default page size of 20.
- No mock data, stubs returning success, or TODO-as-implementation.
- **Ripple check:** `grep -rn "<changed export>" src tests packages | head -50` and update every affected fake and test
  in the same commit.

### Step 3a — PR size

About 500 production lines (tests/docs not counted), about 15 production files, hard stop ~800 lines, at most one
migration, one risk area (credentials / guards / tools-of-one-area / doors). Measure before opening the PR:

```bash
git diff --shortstat origin/<base>...HEAD -- api src packages scripts ':!**/*.test.*'
git diff --name-only origin/<base>...HEAD -- api src packages scripts | wc -l
```

## Step 4 — Verify before pushing

### 4a. The quick gate (every push)

`npm run check` = secret scan (`scripts/check-secrets.mjs`, fails on anything shaped like a real GitHub token, a PEM
private key or a connection string), docs check (`scripts/check-docs-updated.mjs`), index validation
(`docs/pr-cards/validate-index.py`), catalog count (`docs/count-catalog.py`), lint, write-safety
(`scripts/check-writes.mjs`), token budgets (`scripts/check-budgets.mjs`), core imports
(`scripts/check-core-imports.mjs`). Never `--no-verify`.

### 4b. Add the checks your change needs

| You changed | Run |
|---|---|
| Any tool | `npx vitest run tests/unit/<area>.test.js tests/unit/write-contract.test.js` |
| A GitHub call | `npm run test:shapes -- tests/shapes/<area>.test.js` (fake GitHub validates method, path, parameters and body against `vendor/github-openapi/`, GraphQL documents against `vendor/github-graphql/`) |
| SQL / `src/db.js` | `npm run test:db -- tests/db/<file>.test.js` (`scripts/local-postgres-test.sh`: disposable **localhost** Postgres, never Neon). If no Postgres binaries exist in your workspace, push and let CI run it; say so in the PR |
| A door (HTTPS API, `github_call`) | `npx vitest run tests/doors/` |
| Listing or descriptions | `node scripts/check-budgets.mjs --print` |

### 4c. Registries that break CI when you forget them

`src/tools/index.js` module list · TOOL-CATALOG row and Card column · `profiles` and guard metadata ·
`src/github/hand-built-map.js` (after U-1) · `src/github/operation-classes.js` (new write operations) ·
`known_projects` seed (P-1) · `work-index.json`.

## Step 5 — Pushing and CI

1. **Push once per CI cycle.** A push cancels the running CI.
2. **After a red run:** read all failures, reproduce each locally with 4b, fix every failure, push once.
3. **Is it mine?** If the same test is red on `main`, it isn't: port the fix or make a tiny separate fix PR.
4. **Same failure twice:** reproduce locally. **Third red run:** evidence-based diagnosis before any further push.
5. "Flake" is not a cause. Never skip, retry-loop or quarantine.
6. Put "CI runs used: N (red: R, cancelled: C)" in the PR description.

**When `main` moves while your PR is open:** sync once at the PR boundary with `git merge origin/main` — never rebase a
pushed branch. Conflicts in STATUS, MASTER-ROADMAP or `work-index.json`: keep both sides, re-run the validator.

## Step 6 — Docs as if merged, then open the PR

DRIFT-PROTOCOL checklist B (CI checks it): card `MERGED (#n)`, STATUS names the next card, `work-index.json` status,
TOOL-CATALOG Card column for built tools, ARCHITECTURE for env vars/tables, GO-LIVE-CHECKLIST for new switches,
OWNER-INPUTS for new questions, DECISIONS for decisions. PR title `<type>: <plain description>`. Description in plain
English: what Chris can now ask for; acceptance with evidence; owner decisions (IN-xx or none); review dispositions;
what is not included; CI runs used. Delete the resume note in the final commit.

## Step 7 — Review

1. Credentials, secrets, guards, production, access, spend, auth, passes: re-read `docs/AI-PR-READ-FIRST.md` and write
   one line per applicable constraint in the PR.
2. Freeze scope. There is no automated review in this repo (IN-01): inspect the whole diff yourself against
   AI-PR-READ-FIRST, write "Self-review: …" with every finding and its disposition, and fix all blocking findings in one
   patch. If an organization-wide reviewer posts anyway, fix or answer each thread and resolve it; never wait for one.
3. Resolve a thread only after verifying the fix at the exact head (GraphQL `resolveReviewThread`, or this server's
   `review_resolve_thread` once it exists).

## Step 8 — Preview

Vercel builds a preview per branch. Previews share the production database, so they must never act on production:
the server refuses production mode and every credential step on non-production deployments (A-5). For a card that changes
a door or login, open the preview's home page and confirm the tool counts shown match the PR.

## Step 9 — Merge (authorized when all are true)

`ci` green at the exact head; acceptance met with evidence; self-review written; threads handled. Merge with the
expected-head SHA (merge commits):
`gh api -X PUT repos/<owner>/<repo>/pulls/<n>/merge-async -f merge_method=merge -f merge_action=direct_merge -f sha=<head>`
returns `merged`, `failed` (read the message) or `pending` (record it, do other work, check once later — no polling).
Never pass `bypass_rules`. Stacks merge bottom-up, retargeting each PR to `main` first and waiting for fresh `ci` at that
head. After the lower PR merges, sync the successor once onto final `main`.

## Step 10 — Waiting and stopping

- External waits are checkpoints: check once, act on anything new, then build the immediate successor.
- A quiet bounded CI wait is allowed: at most 60 seconds per wait, 10 minutes total
  (`timeout 300 gh run watch <id> --exit-status --interval 60 > /tmp/ci-wait.log 2>&1`); timeout means pending.
- Before ending a turn: commit, update the resume note and STATUS (exact head, pending gates, next action), and tell
  Chris in plain English.

## If you get stuck

- Same failure after two focused attempts: stop editing, inspect the evidence, change the hypothesis.
- GitHub refuses something the design assumed (an operation, a parameter, a permission for App tokens, a plan-dependent
  feature): don't improvise. Record what GitHub answered (fake-GitHub fixture from the documented response, or the
  scratch organization once IN-06 exists), propose a dated amendment, continue other work.
- Docs contradict code: tests are the truth for behavior, AGENTS for rules, PLAN for scope, card and design for how.
