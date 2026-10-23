# 2026-10-23: Post-release retests and any-app read-back fix

Released: live = 66741a4 (Vercel READY) after Chris's "Release now" at 08:12 MST.

Verified on the live release:
- Protection with required checks on a private Pro personal repo: GitHub accepted it (no 422), read back, then removed. The #303 fix works.
- Webhook ping on robinson-ai-scratch: confirmed with a delivery id (the #301 wait works). Webhook then deleted.
- Fixture repo christcr2012/rtc-pro-accept-oct23 deleted.

Found and fixed in this PR: a check set to "any app" (app_id -1) is read back by GitHub as no app, so the server wrongly reported "unconfirmed" although the change was applied. Verification now treats the two as equal. New test fails without the fix.

Next: after this PR is merged and released (daily job), nothing else waits on a release. Owner-only items remain on docs/OWNER-CHECKLIST.md.
