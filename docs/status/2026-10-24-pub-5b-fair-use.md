# 2026-10-24 — PUB-5 PR B: fair use, cost protection, no people cap

**What now works**
- **Free daily limit per person:** 5,000 assistant calls a day and 300 real changes an hour (settings `PUBLIC_FREE_CALLS_PER_DAY`, `PUBLIC_FREE_WRITES_PER_HOUR`). Only real tool calls count (not `initialize`, `tools/list`, previews or refused changes). A `github_batch` of 3 changes counts 3. At the limit the assistant gets a plain sentence with the reset time; reads keep working when only the change limit is hit. Counting problems never block work.
- **Your own GitHub account (and any numeric ids in `PUBLIC_UNLIMITED_SUBJECTS`) is never limited**, still measured.
- **New sign-ups pause automatically** when the estimated monthly cost (last 7 days of calls x 30/7 x `PUBLIC_COST_PER_1K_CALLS_CENTS`) reaches `PUBLIC_COST_PAUSE_CENTS` (default $50; 0 = off), or by hand with `GITHUB_PUBLIC_NEW_SIGNUPS=paused`. People who already have a store always sign in.
- **No cap on the number of people.** Old `GITHUB_PUBLIC_MAX_TENANTS` is ignored. App registrations never used for 30 days are cleaned up; the registration cap is 100,000.
- **Inactive clean-up:** after 180 days without a call or sign-in (`PUBLIC_INACTIVE_DAYS`) a person's stored GitHub grants and app tokens are removed (store stays, they sign in again). At most 20 per run, hourly.
- **Owner page:** people, active today/this week, calls, estimated cost, sign-ups open/paused, top 10 by calls (names read from each person's own store). Privacy draft updated to say so. My connection shows "Used today: X of Y".

**How it was checked:** `tests/unit/pub-5b-usage-hook.test.js` (9), `tests/browser/fair-use.test.js` (4, through the real `/api/mcp` route), and in `tests/db/pub-6-public-connect.test.js`: no cap, pause by hand and by cost, stale registrations, inactive clean-up, owner numbers.

**Not verified:** the cost rate default (5 cents per 1,000 calls) was not re-measured against the last 30 days of Vercel/Neon usage; kept at 5 as the card allows. Recheck once real traffic exists.

**Owner action:** put your numeric GitHub id in `PUBLIC_UNLIMITED_SUBJECTS` (checklist row). **Next:** PR D (home page, rename, Marketplace pack).
