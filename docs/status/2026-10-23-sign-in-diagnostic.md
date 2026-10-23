# 2026-10-23 — Sign-in still refused; diagnostic added

After the permission-name fix, Chris's real sign-in still ended on "Could not connect" after pressing "Continue to GitHub" (the consent page itself loads). The refusal reason was hidden. Now the server logs a short internal reason (error name and first 160 characters, no secrets) so the cause can be read from the Vercel logs. Next: release, Chris retries once, read the reason, fix.

Same PR: the public consent page now leads with one "Sign in with GitHub" button and a plain line saying GitHub asks you to sign in next. Time zone, accounts, God mode and Read-only moved under a collapsed "Options (most people skip this)" section. Same fields, same defaults.
