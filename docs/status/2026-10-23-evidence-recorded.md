# 2026-10-23 — Formal evidence recorded for the live release

`docs/developer-evidence.json` now records, for live commit 610394f (Vercel production READY, independently read from the provider):
- deployed + custom_transport: this exact commit, reached with the service's own authorization.
- provider: permitted read and write, resource denial (foreign owner refused before GitHub), identity denial (personal key reads refused: user grant lacks the permission), provider readback — on the scratch organization only.
- cleanup: run-owned scratch protection, ruleset, release draft, branches and topics removed or restored with readback.
Still unverified and listed as not run: hub, revocation, webhook receiver signing, package credential, owner-approved spend/access writes, second-account review-thread replies. Old merged working branches in the product repository remain until Chris deletes them (OWNER-CHECKLIST).
