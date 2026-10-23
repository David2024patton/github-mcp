# CAP-5 — end-to-end acceptance and truthful coverage reporting

**Status: PLANNED 2026-10-22.** Source engineering is the capability report; everything else is acceptance run by an agent
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
1. `node scripts/capability-inventory.mjs --summary` states counts per state with the denominator spelled out and never a
   percentage without one; test proves a changed inventory changes the report.
2. On the scratch organization via the deployed service: read; guarded write with dry run; read-only denial; wrong
   tenant/resource denial; revocation then recovery; ambiguous-write replay. Each recorded with observations or a precise
   deferral with trigger.
3. No account upgrade, spend or non-scratch mutation is used to generate evidence.
4. Anything that cannot run goes to the owner checklist with its re-entry trigger.
