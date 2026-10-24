# 2026-10-24 — Approve page can install the App on your other places

Chris: signing in or adding an organization should install the App, not just mention it.
- Approve page: each of the person's other places without the App (personal account or organization they own) now has an "Add <place>" button. It opens GitHub's install screen for that place, then returns through the silent sign-in to the same Approve page with the new account listed. The old note ("can be added later") is replaced.
- Extra places (master token): adding an organization now says plainly how to install the App there (Add button, or ask an owner).
- First sign-in with no App anywhere already went straight to an install page; unchanged.
- Tests: tests/db/pub-6-public-connect.test.js (new Approve add test; extra-place message). Browser suite run before push.
- Not done / owner step: the live Robinson-AI-Systems organization still needs the App installed (Chris, one tap on My connection).
