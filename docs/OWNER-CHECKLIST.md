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

- [x] **Phone check, Claude app** — done 2026-10-22: the Claude phone app reported the connector, account robinson-ai-scratch,
      live mode, no spending limit. Desktop/web is covered by the connector you added on claude.ai.
- [ ] **Decide what PUB-4 covers:** its card is written for ChatGPT phone/desktop clients. Choose Claude only (agent rewrites the
      card; PUB-4 can then close), ChatGPT only, or both. Tell the agent in chat.

## B2. Give the agent a working connection to your deployed server (lets agents run the real-account tests for you)

- [x] **Add the server as a connector in Claude** — done 2026-10-22 (scratch organization). Agents can use the GitHub tools
      directly in a new session. Ordinary scratch writes (create/close an issue, branches, PRs on disposable fixtures) work in
      preview mode; only operations the server classifies as production need production mode.
- [x] **Connector switched to production mode for the scratch organization only** — done by Chris 2026-10-22 (compact tool menu).
      Never for his real accounts without his say-so. This lets agents test production-classified operations on scratch
      fixtures, each still behind its own guards and confirmation.

## B3. Things that cannot be tested until you have them

- [ ] **A GitHub Enterprise account or enterprise admin sign-in:** needed only to test enterprise-wide audit logs and
      enterprise SAML/SCIM. Without it those stay untested; nothing else depends on them. Buying one is your call.

## C. Decisions only you can make

- [ ] **Release approval:** an agent will ask in chat only when everything else is done and a release would unlock
      a concrete next task. Otherwise the daily automatic release handles it.
- [ ] **Optional paid GitHub plan:** some protections on private repositories need a paid GitHub plan. The agent
      will never buy it. Decide whether you want it; until then those checks stay on hold.
- [ ] **Turning on production** for each real account, when you want the server to make real changes there
      (`docs/GO-LIVE-CHECKLIST.md` section 3).

## Done

(Nothing yet.)
