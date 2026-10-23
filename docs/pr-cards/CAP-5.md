# CAP-5 — end-to-end acceptance and truthful coverage reporting

**Status: CLOSED 2026-10-22 (source done; acceptance item 2 run on the scratch organization with two named deferrals).** Source engineering is the capability report; everything else is acceptance run by an agent
through the saved developer connection against the deployed service (never the owner's device, never a standard provider
connector). Anything needing Chris is a row on `docs/OWNER-CHECKLIST.md` and does not block this card.

## Drift check A
CAP-1 inventory (`scripts/capability-inventory.mjs`) already emits denominators with "NOT COMPUTED" coverage; CAP-2..CAP-4
are merged. Dispositions for what CAP-4 did not curate are in its Closeout.

## Outcome
A reproducible capability report with honest denominators, plus recorded real-account acceptance of the Standard Full
workflows on the scratch organization, in `docs/developer-evidence.json` (exact deployed revision, credential kind never value,
fixture, observed effect and readback, cleanup).

## Acceptance
1. `npm run capability:report` states counts per state with the denominator spelled out and never a
   percentage without one; test proves a changed inventory changes the report.
2. On the scratch organization via the deployed service: read; guarded write with dry run; read-only denial; wrong
   tenant/resource denial; revocation then recovery; ambiguous-write replay. Each recorded with observations or a precise
   deferral with trigger.
3. No account upgrade, spend or non-scratch mutation is used to generate evidence.
4. Anything that cannot run goes to the owner checklist with its re-entry trigger.

## Progress 2026-10-22
Item 1 delivered: `npm run capability:report` prints every figure as "X of N" with the denominator and no bare percentage
(test in `tests/unit/capability-inventory.test.js`). Item 2 (real-account runs through the saved developer connection)
is not run: this agent session had no saved connection and no rtool vault. It is queued on `docs/OWNER-CHECKLIST.md` (row B2)
and re-enters as soon as a connection is available. Items 3-4 hold.

## Closeout 2026-10-22
Item 2 was run through the owner's connected custom server (scratch organization only; see `docs/status/2026-10-22-acceptance-first-live-observations.md`
and `-org-reads-and-phone.md`): reads (account, org, billing, repos, alerts, webhooks, protection); guarded write with dry run (previewed, no write); wrong-account
denial (`client:outside_scope`); applied write with readback; same-request replay (one issue, no duplicate); cleanup (issue closed).
Deferred with triggers, both needing an owner action and neither blocking anything: (a) read-only-profile write denial and (b) revocation then recovery.
Trigger: the owner disconnects and reconnects the connector (b), or connects a read-only profile (a); the checklist row "Disconnect/reconnect test" carries it.
Not recorded in `docs/developer-evidence.json`: the deployed revision (`live`) cannot be independently verified from this agent shell, and that file requires it;
these are observations until a verified revision is recorded. Items 3 and 4 hold: no upgrade, spend or non-scratch change was used.
