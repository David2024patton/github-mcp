# 2026-10-23 — Guided "Unlock more tools" (part one of the simple-connect work)

- Done: the three separate token boxes on the setup page (package, notifications, fine-grained) are now one guided section
  "Unlock more tools" (`src/github/unlock-html.js`). Each token says what it opens, gives three plain steps, and links to
  GitHub's token page with the correct boxes pre-ticked. Save and remove actions are unchanged and still protected by the
  passphrase, CSRF and same-origin checks; no token ever passes through a tool argument.
- Tests: `tests/unit/setup-page.test.js` ("guided Unlock more tools section").
- Next: part two, the public sign-in and App-install connect flow (dark, off by default; the App is not made public without Chris's go-ahead).
