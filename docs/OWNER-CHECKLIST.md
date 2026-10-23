# Chris's checklist — only the things that need you

Everything an AI agent can do, test or verify on your behalf, it does. This page lists the **only** things that
strictly need you (your sign-in, your device, your money or your decision). None of them blocks development; agents
build and merge without waiting. Do them whenever you are ready, top to bottom. Tick the box and add the date.

Rules for agents: add a row here (plain English, one step at a time) instead of stopping to ask. Never tick a box for
Chris. Never mark a check passed without real observations. Results go in `docs/developer-evidence.json`.

## A. Do once, any time

- [ ] **Save your two server secrets** in your password manager, especially the admin passphrase. They were set up
      privately on 2026-10-12 and exist only in Vercel settings. (IN-03)
- [ ] **Connect your real GitHub accounts.** Open the server's setup page and click "Create the GitHub App" once for
      `Robinson-AI-Systems` and once for `christcr2012`, then "Install" on each (All repositories is recommended), and
      "Authorize as me" once. GitHub hands the keys straight to the server; there is nothing to copy. (IN-04, IN-05)

## B. Device checks (need your phone and computer)

- [ ] **Private mobile and desktop connection (PUB-4):** after the PUB-4 code is merged and live, add the private
      connection on your phone and on your computer, sign in, and ask each for "who am I on GitHub" plus one
      read. Tell the agent the result. (Row appears when PUB-4 is ready; not yet.)

## C. Decisions only you can make

- [ ] **Release approval:** an agent will ask in chat only when everything else is done and a release would unlock
      a concrete next task. Otherwise the daily automatic release handles it.
- [ ] **Optional paid GitHub plan:** some protections on private repositories need a paid GitHub plan. The agent
      will never buy it. Decide whether you want it; until then those checks stay on hold.
- [ ] **Turning on production** for each real account, when you want the server to make real changes there
      (`docs/GO-LIVE-CHECKLIST.md` section 3).

## Done

(Nothing yet.)
