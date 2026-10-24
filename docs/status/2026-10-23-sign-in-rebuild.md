# 2026-10-23 — sign-in rebuilt and browser-tested

Chris asked for a review of why the connector sign-in kept failing, then approved all four fixes. Done in one PR:
1. **Real-browser tests** (`tests/browser/`, `npm run test:browser`, new CI job `browser`). Real Chromium (Android phone and
   desktop) and WebKit (iPhone) walk the whole sign-in and My connection page against the real `api/` code, a fake GitHub
   and a fake app, through a throwaway local database. On the old code they reproduced both failures Chris hit on his
   phone ("loading bar, then nothing" and "This page was already used").
2. **Slim sign-in:** app → GitHub once → Approve → app; install page only when needed; no cookies at all.
3. **My connection** at `/connection`: add accounts (existing apps get them without reconnecting), master token, read-only,
   time zone, disconnect an app, delete my data.
4. **One sign-in:** with public sign-in on, the private-pilot sign-in sends people to reconnect; new registrations always use
   the public flow. Chris's own move is on his checklist.

Verified locally: browser suite 17/17 on Chromium (WebKit runs in CI only; the agent environment cannot download it),
database suite 201/201, unit and shape suites, lint, check. Still dark: `GITHUB_PUBLIC_CONNECT` is off until Chris says go.
Next: CI on the PR, merge, then the daily release carries it.

Follow-up (same PR): the browser check on GitHub's Chrome found a real phone bug: the master-token page was wider than
the screen (paste box and Continue button off the right edge). It now uses the same Robinson look as the other pages and
fits; the browser tests now check that every page fits the screen.
