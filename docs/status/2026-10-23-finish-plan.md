# 2026-10-23 — finish plan written (nothing built)

Chris asked for everything still needed to finish the product to be designed and planned, written so Sol 5.6 can
implement it at light/medium effort, without building it yet. Added:
- `docs/designs/FINISH-PLAN.md` — current state, gaps with evidence, order, rules, owner items.
- Ready cards (batch FIN): GOD-2, GOD-3, ENT-1, ACC-1, GOD-4, GQL-1, GOD-5, HARD-1, each with drift table, exact files,
  steps, named tests and a "Done when" checklist; `docs/pr-cards/SOL-GUIDE.md` for smaller models.
- `work-index.json` + validator know batch FIN; MASTER-ROADMAP, ROADMAP, GOD-TOKEN, DECISIONS, OWNER-CHECKLIST,
  AGENTS.md ("Start here", "Lessons") and SESSION-START point at the plan.
Time-sensitive: ENT-1 must be released and tested before the Enterprise trial on robinson-ai-scratch ends (~2026-11-22).
Next: GOD-2 + GOD-3 in one PR.

Follow-up the same evening (Chris asked whether the plan covers ALL remaining work): compared against ROADMAP, the
end-user authority audit, REMAINING-WORK and the capability report. Added cards LAUNCH-1 (launch readiness, including a
real gap: App uninstall does not clean up public people's stored state), AUTH-1 (end-user authority audit) and INV-1
(inventory credential decisions), plus a docs-only CI fast path and small polish in HARD-1 and fine-grained-token places
in GOD-5. FIN now has 11 cards.
