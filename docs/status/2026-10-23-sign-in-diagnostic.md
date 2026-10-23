# 2026-10-23 — Sign-in still refused; diagnostic added

After the permission-name fix, Chris's real sign-in still ended on "Could not connect" after pressing "Continue to GitHub" (the consent page itself loads). The refusal reason was hidden. Now the server logs a short internal reason (error name and first 160 characters, no secrets) so the cause can be read from the Vercel logs. Next: release, Chris retries once, read the reason, fix.
