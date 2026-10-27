# ACC-1 — acceptance sweep: turn released code into real evidence (repeatable)

**Batch FIN · Design:** `docs/designs/FINISH-PLAN.md` §4, `docs/SESSION-START.md` · **Prerequisites:** none to start;
re-run after every release that carries a FIN card · **Effort:** light (careful, not clever) · **No PR needed** for
runs that only add evidence, BUT the ledger lives in `docs/STATUS.md`, so record results in one small docs PR per
session (`ai/<tool>/acc-1-<date>`).

## Outcome
Every row in the release-acceptance ledger (`docs/STATUS.md`, block between `<!-- release-acceptance:start -->` and
the closing fence) ends PASSED, or BLOCKED with one exact external reason (plan, payment Chris has not approved, Hub not
configured). New rows are added for each FIN card. PUB-4 and PUB-6 are closed. 2026-10-23 snapshot: 58 rows,
42 PASSED, 11 BLOCKED, 5 PENDING.

## Drift check A
| Expected | Actual on main | Action |
|---|---|---|
| ledger block between `<!-- release-acceptance:start -->` markers in `docs/STATUS.md` | | |
| `npm run session:status` prints the queue | | |
| deployed SHA at `https://github.robinsonaisystems.com/` | | |

## How to run one session (copy these steps)
1. `git fetch origin main live`; note `main` and `live` SHAs. Confirm the deployed version: open
   `https://github.robinsonaisystems.com/` and read `deployed_source_sha` (or Vercel MCP `list_deployments` with the
   SHA). Only test rows whose `requiredRevision` is an ancestor of the deployed SHA (`git merge-base --is-ancestor`).
2. `npm run session:status` lists what to act on. Pick rows in the order of the table below.
3. Use the **saved connector** in the chat (tools named `mcp__Github_by_Robinson_AI_Systems__*`). Start with
   `github_whoami` and copy mode/profile/accounts into your notes. Never ask Chris to reconnect unless the connector
   errors with an expired/revoked grant.
4. For each scenario: preview (`dryRun:true`) first, then the real call with `confirm:true` only on the scratch
   organization `robinson-ai-scratch` or a disposable fixture named `rtc-acc1-<date>-<n>`; read back; clean up in the
   same session (delete the fixture). Never touch Chris's real repositories except the read-only checks named below.
5. Record: change the row's `status`, write `lastEvidence` as "<date time MDT> on live <sha> (Vercel READY), custom
   service-issued MCP, <MODE>/<profile>. <what you called> → <what came back>. Cleanup: <what>." Add a matching record to
   `docs/developer-evidence.json` (copy an existing record's shape; no tokens, no secrets, no private repo content).
6. Run `npm run check:developer-evidence` and `npm run check:session`, then open the docs PR.

## Existing open rows (2026-10-23) and the plan for each
| Row | Status | What to do now |
|---|---|---|
| GITHUB-H2-SIGNER-LIFECYCLE | PENDING | Create a test webhook on a disposable public scratch repo pointing at `https://example.com/acc1` with `github_dev_create_test_webhook`; rotate its secret; read deliveries; delete. Signature proof is optional (owner checklist item); record the rest. |
| GITHUB-H3-ACCESS-LIFECYCLE | PENDING | Deploy key add/delete on a disposable scratch repo (public key generated locally with `ssh-keygen -t ed25519 -N "" -f /tmp/acc1key`, private half deleted immediately). Collaborator invite needs a second GitHub account (owner checklist, optional) — record that part BLOCKED with that reason. |
| GITHUB-Y9D-SPONSORS-U-READ | PENDING | Run the curated sponsors read for `christcr2012`; an empty sponsorship list is a valid PASS if the identity matches. |
| GITHUB-Y9D-SAFETY-DENIAL | PENDING | Needs REAL restricted connections, not a production dry run (`src/core/write.js` checks the connection mode before `dryRun`). Production-off/preview part: connect a second throwaway app with **Read-only** ticked on the Approve page and observe the refusals there. User-cap part: needs an explicit spend limit set on the account (owner setup page) — otherwise keep BLOCKED with that reason. Narrow-pass part: needs a real narrow RTC pass (GITHUB-RTC-DIRECT prerequisite) — keep BLOCKED until it exists. Only mark PASSED when all parts are observed. |
| GITHUB-PRIVATE-USER-PASS-SCOPE | PENDING | Private-pilot path is retired for new sign-ins (PUB-6 rebuild). Mark BLOCKED → "superseded: private-pilot sign-in retired 2026-10-23; public tenants covered by tests/db/pub-6-public-connect.test.js" (needs no live run). |
| GITHUB-NATIVE-REVOCATION | BLOCKED | Now possible without touching the working connection: connect a SECOND throwaway app client (e.g. a fresh Claude connector named "acc1-revoke" or a manual OAuth client from `tests/browser/setup.js` style against the live server), then disconnect it on **My connection** and show its token is refused (401). |
| GITHUB-Y7-AUTH-PREVIEW | BLOCKED | Enterprise trial on robinson-ai-scratch includes security features: read security/advisory settings on a private scratch repo; record. |
| GITHUB-Y7-AUTH-PRIVATE-PAID-WRITE | BLOCKED | During the trial only, enable one security feature on one disposable private scratch repo and disable it again (trial = $0). If GitHub shows any price, stop and record BLOCKED. |
| GITHUB-Y9D-HOSTED-READ | BLOCKED | Re-try on robinson-ai-scratch during the trial (hosted runners may now be eligible). |
| GITHUB-O4-AUTH-CODESPACES-WRITE | BLOCKED | Keep BLOCKED unless the trial makes the setting readable; then set Codespaces access to the current value (no change) and read back. |
| GITHUB-O4-AUTH-BUDGET-WRITE / GITHUB-Y9D-OWNER-AUTH-WRITES / GITHUB-U1-AUTH-METERED-WRITE | BLOCKED | Need real money decisions: leave BLOCKED, reason "owner money decision (OWNER-CHECKLIST)". |
| GITHUB-RTC-DIRECT | BLOCKED | Issue a short-lived read-only RTC pass on the setup page (owner passphrase) — owner checklist item; then run `npm run rtc:public-evidence` style read. |
| GITHUB-RTC-RELAY / GITHUB-RTC-SANDBOX | BLOCKED | Optional Hub routes; leave BLOCKED "optional Hub not configured" (not a completion gate, AGENTS.md). |

## New rows to add (one per FIN card, when its code is released)
`GITHUB-GOD2-PERSONAL-M` (gist create+delete as SECRET gist on christcr2012; list keys/emails read-only),
`GITHUB-GOD3-UNLOCKS` (whoami lists areas), `GITHUB-ENT1-READS` and `GITHUB-ENT1-CONFIG-LIFECYCLE` (before 2026-11-22),
`GITHUB-GOD4-CODESPACES-SECRETS` (user-level secret via generate, then delete), `GITHUB-GOD4-EXPORT` (one disposable
scratch repo exported, link read, archive deleted), `GITHUB-GOD4-SPACES`, `GITHUB-GOD5-PLACE` (add read-only place,
read OK, write refused, remove), `GITHUB-GQL1-<group>` (one representative mutation per group on scratch),
`GITHUB-HARD1-SIGNIN-NO-CAP` (sign-in works after the cap change).

## Closing PUB-4 and PUB-6
- PUB-6: tick its card's remaining items with today's evidence (Chris reconnected Claude and ChatGPT on
  `github.robinsonaisystems.com` on 2026-10-23 through the new Approve page) and set `MERGED`/`COMPLETE` in
  `work-index.json` (use `COMPLETE`, the index already uses it for done-without-a-single-PR cards).
- PUB-4: the Android ChatGPT (2026-10-23) and desktop Claude/ChatGPT connections plus the browser suite (Android
  Chrome, iPhone WebKit, desktop) cover criteria 1–5 for the public flow; criterion 6 (stay private) is superseded by
  Chris's 2026-10-23 decision to make the App public. Write that reconciliation in `docs/pr-cards/PUB-4.md`, mark
  `COMPLETE`, and leave PUB-5 BLOCKED.

## 2026-10-26 released-source acceptance reconciliation (new approved session)

The source running at `https://github.robinsonaisystems.com` is verified READY at `12d108dc507a2ebf093fa5bbb94d812ea2d72993`. This session accounts for all 71 current ledger tasks instead of treating blocked external prerequisites as untested source. Use the saved native MCP connection and do **not** change production user accounts, protected lists, spending, live branches or actual third-party pull requests to manufacture an acceptance pass.

- [x] Preserve the 53 previously passed observations. Complete `GITHUB-GOD4-EXPORT` only if the existing disposable export's archive has independently ceased to exist; record both native API readback signals and that the export metadata may remain.
- [x] For the four remaining pending scenarios, record **BLOCKED** with their exact missing external prerequisite and feasible next action: user-chosen capped/read-only connection for Y-9d, independent live sign-in for HARD-1, user's Act-as-me-off/read-only grant plus scratch app-only proof for GOD-6, or owner-configured protected-list scratch fixture for override denial. Do not conflate simulated tests with provider acceptance.
- [x] Add accurate developer-evidence cleanup observation; independently check all 71 rows have an evidence disposition and no PENDING status. PUB-4 and PUB-6 are already MERGED; leave their audited prior outcomes untouched.
- [ ] Run exact-head documentation consistency checks, review, and merge through the repository's normal PR/CI gates. Do not claim ACC-1's deferred scenarios passed or request an early live release.

## Done when
- [x] Every ledger row is PASSED or BLOCKED with an exact external reason; no PENDING rows remain.
- [x] FIN rows added and run after each release; PUB-4 and PUB-6 closed in `work-index.json` (both were previously MERGED and are not misrepresented as new work).

## 2026-10-26 accounting outcome

Independently confirmed current custom live READY source 12d108dc507a2ebf093fa5bbb94d812ea2d72993 and the saved PRODUCTION/full MCP connection. All 71 existing acceptance rows accounted for; **54 PASSED, 17 BLOCKED with specific prerequisites, 0 PENDING**. The already-exported disposable archive is absent by two read-only observations, while its historical metadata persists. The other four pending rows are blocked on distinct real-world permissions or owner-controlled checks; no fake PASSED labels. Source-only fork-run approvals and any unreleased feature remain separate. Final PR/CI verification still required.
