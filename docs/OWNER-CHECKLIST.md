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
- [x] **Phone check, ChatGPT** — done 2026-10-22: ChatGPT reached the custom server as robinson-ai-scratch (read-only preview, by your
      choice of permissions at sign-in).
- [x] **PUB-4 scope decided:** covers Claude and ChatGPT both; code part merged.
- [ ] **Later, whenever convenient (blocks nothing): desktop app test.** Open the connector in the desktop Claude or ChatGPT app and ask
      "which GitHub account am I connected to?" Also optionally disconnect and reconnect once on a phone. Tell the agent the answer.
- [ ] **Later (blocks nothing): disconnect and reconnect test.** In Claude or ChatGPT, remove the custom GitHub connector, add it back, and ask
      "which GitHub account am I connected to?" Tell the agent the result. (Closes the "revocation then recovery" line of the final acceptance.)
- [ ] **Two-minute tidy-up (optional):** delete the old, finished branches on the repository page (Branches; GitHub's "delete branch after merge" setting would stop new ones piling up): ai/o2-org-members-20261014,
      ai/o2-owner-org-members-20261014, docs/authority-corrections-acceptance-handoff, docs/hub-contract-reference-20261019 (all merged), and
      scratch/status-fragments (its content is redundant), plus the merged ai/claude/* working branches. The agent's environment is not allowed to delete branches.
- [ ] **Much later, only if you ever want it public: PUB-5 publication.** Needs a third-party directory's approval of an unofficial connector,
      which may not be possible. The product works privately without it; nothing waits on it.

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

## Added 2026-10-23 (connecting more accounts, branch setting, webhook proof)
- [ ] **Turn on "Automatically delete head branches"** for Robinson-AI-Systems/github-mcp: repository Settings, General, Pull Requests. (The agent's environment is not allowed to change repository settings.)
- [x] **Connect more of your accounts (done 2026-10-23):** `Robinson-AI-Systems` (organization) and `christcr2012` (personal) are installed and listed on the connect screen next to `robinson-ai-scratch`.
- [x] **(done 2026-10-23)** Turn on production for the accounts you want changed (`Robinson-AI-Systems`, and `christcr2012` for personal-account tests): setup page, administrator passphrase, production switch for that account. Then disconnect and reconnect the Claude connector and choose **Production**. Until then the agent can only read on those accounts. Waiting on this: the branch setting and old-branch cleanup on github-mcp, and the real-account budget, Codespaces and protection checks.
- [x] **(done 2026-10-23)** Sign in as yourself on the setup page ("Authorize as me") for `Robinson-AI-Systems` and `christcr2012`.** This lets the agent read your personal settings and plan. Your new GitHub Pro covers only personal repositories; `Robinson-AI-Systems` is on GitHub's free organization plan, so organization budgets, Codespaces access and private-repo branch protection stay blocked until you upgrade that organization (your money decision).
- [ ] **Optional, 2 minutes: prove webhook signatures.** The agent created and removed a test webhook but cannot see its signing secret (it is shown only behind your passphrase). To prove the signature check, create a test webhook through the agent, open the one-time link it returns, and compare against a receiver you control.
- [x] **Enterprise trial started on `robinson-ai-scratch` (done 2026-10-23).** It is free for 30 days and ends on its own; do not add a card. Budgets can now be read, rulesets accept "evaluate" mode, and private-repo branch protection works there. Still not working there, and not a plan problem: creating a new budget and the Codespaces access setting both answer "not found". You decided on 2026-10-23 that this is sufficient; no further budget testing.
- [ ] **Decide later:** whether `Robinson-AI-Systems` should move to a paid organization plan (only needed if you want private-repo protection or budgets on that organization).
