# 2026-10-23 — Branch protection verified on the real scratch repository

Merged and released: PR #296 (live at 610394f, Vercel production READY at that commit).

Real-account check on `robinson-ai-scratch/rtc-ghaccept-h1-public-oct14`, branch `main` (scratch organization only, public fixture):
- `github_protection_get` after the fix reads the protection that was set earlier (required_conversation_resolution on, enforce_admins off): `classic_protection_readable: true`.
- `github_protection_remove` preview, then confirm: applied; readback says no classic protection is set (`protected: false`). The test protection is cleaned up.
- Rulesets were not exercised in this pass (separate surface; stays a listed acceptance row).

Next: remaining acceptance rows that need a prerequisite stay on the queue with their trigger (see OWNER-CHECKLIST.md).
