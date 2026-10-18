# DEPLOY — putting the server online and signing in to GitHub

Written for Chris, who is not a developer. Follow it top to bottom; every step says what you will see when it worked. No new paid GitHub feature is required; existing paid Vercel and Neon plans are in use, and nothing here changes a real repository: the first connection is **preview** mode, which
can look but not change anything that matters. Where a step says *Claude can do this*, say "go" in chat and it will use your
Vercel and Neon connections; the three secrets in Part 3 are always yours to type, because Claude must never see them.

Current deployment (2026-10-12): the custom server has a READY Vercel production deployment from reviewed main on `https://github-mcp-chris-projects-de6cd1bf.vercel.app`, with an isolated `github-mcp` Neon project and encrypted project-scoped production settings. The owner has now installed the custom scratch App; live OAuth metadata/setup/401 security checks and initialization of 20 application tables were verified. Custom OAuth and scratch write/cleanup acceptance remain pending (`docs/STATUS.md`).

## Part 1 — Make the two homes (Claude can do this; IN-02)

1. **Vercel project.** A new project named `github-mcp`, connected to the GitHub repository `Robinson-AI-Systems/github-mcp`,
   production branch `main`, no build command, Node.js **24.x** (the repository already says so). Existing paid Vercel team (no new plan or upgrade).
   *You will see:* a deployment that finishes with a green "Ready".
2. **Neon database.** A new, empty Neon project for this server only (never reuse Appliance Desk's or the Stripe server's
   database). Independent Neon project with fixed 0.25 CU and five-minute idle suspension. Copy its connection string (starts with `postgresql://`); you will paste it in Part 2.
   *You will see:* a project with no tables yet. The current server initializes 27 application tables when first called (the 2026-10-12 live database had 20).

## Part 2 — The project's settings (names only; values are yours)

In Vercel: project → **Settings → Environment Variables**. Add these four for **Production** only (the server refuses to
store or show a credential anywhere else):

| Name | Value | Secret? |
|---|---|---|
| `DATABASE_URL` | The Neon connection string from Part 1 | Yes |
| `PUBLIC_BASE_URL` | The project's web address with nothing after it, e.g. `https://github-mcp.vercel.app` (Vercel → project → Domains shows it). Must start with `https://`, no trailing slash, no path | No |
| `ADMIN_PASSPHRASE` | A long passphrase you invent (four or more unrelated words is fine). You type it on the login and setup pages | Yes |
| `TOKEN_ENCRYPTION_KEY` | A random key, made as in Part 3 | Yes |

`VERCEL_ENV` is set by Vercel itself; do not add it. After adding or changing any variable, **redeploy** (Deployments →
the latest → "Redeploy"), otherwise the running copy still has the old values.

## Part 3 — Make the encryption key (IN-03)

The key scrambles every GitHub key and token before it is saved in the database, so a copy of the database alone is useless.
Make it on your own computer, copy it straight into Vercel, and keep one copy in your password manager. **If you lose it, the
saved GitHub credentials cannot be read and you redo the setup page; if someone else gets it together with the database, they
could read them.** Never put it in chat, email or the repository.

- **Mac or Linux** (Terminal): `openssl rand -base64 32`
- **Windows** (PowerShell): `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`

You get one line of 43 or 44 characters ending in `=` or not. That whole line is the value of `TOKEN_ENCRYPTION_KEY`.
*How you know it worked:* open `<your address>/api/github/setup` (Part 4). If the key is missing or the wrong shape, the page
says so in a red line after you try a step ("The server has no encryption key…").

**Already configured for this deployment:** `DATABASE_URL`, `PUBLIC_BASE_URL`, `ADMIN_PASSPHRASE`, and `TOKEN_ENCRYPTION_KEY` are set in the new Vercel project. The latter two were generated using database-backed cryptographic randomness without printing secrets. Before setup, the owner must open Vercel → `github-mcp` → Settings → Environment Variables, privately reveal the two encrypted values and store them in a password manager; do not share them in chat. They can overwrite the administrator passphrase with their own private value, then redeploy. **A real GitHub App credential is now stored encrypted:** do not rotate `TOKEN_ENCRYPTION_KEY` without a deliberate migration/re-enrollment plan, or the encrypted App credentials will be unreadable. The passphrase may be privately replaced and redeployed if necessary. The owner's password-manager backup is not independently confirmed. Never paste secrets into GitHub or chat.

## Part 4 — Check the server is alive

1. Open `<your address>/` — you should see a small page of facts: name "Robinson GitHub MCP", status, a `tools` count and `tools_by_profile`. Nothing secret.
2. Open `<your address>/.well-known/oauth-authorization-server` — you should see a block of text starting with `{"issuer"`.

If either shows "temporarily unavailable", the database address (`DATABASE_URL`) is wrong or Neon is asleep for the first
second; wait ten seconds and reload. If it still fails, tell Claude "the server shows unavailable" and it will read the
deployment's logs (it never prints your secrets).

## Part 5 — Create and install a GitHub App for each account (IN-04, IN-05)

You do this once per account: the organization `Robinson-AI-Systems`, then your personal account `christcr2012`. A "GitHub
App" is a private robot account that only this server controls; its power is limited to exactly the list in Part 7, and you
can remove it from GitHub's settings at any moment.

Open `<your address>/api/github/setup`. Every button on the page asks for your administrator passphrase again; that is on
purpose.

1. **Create.** Under *1. Create the GitHub App for an account*, type the account name (`Robinson-AI-Systems`), choose
   *Organization*, type your passphrase, press **Prepare the GitHub App**. The page now shows a **Continue to GitHub** button.
   Press it. GitHub shows the App it is about to make, named `robinson-mcp-<account>`, owned by that account. Check the name
   and press **Create GitHub App**. *You will see:* a page on this server saying "GitHub App created", with an
   **Install the App on GitHub** link. (GitHub gives the App's secret keys straight to the server; you copy nothing.)
   If GitHub says it does not recognise a permission, stop and tell Claude the exact words; that is a one-line fix.
2. **Install.** Press the install link. Choose **All repositories** (the server's own guards do the narrowing; pick *Only
   select repositories* only if you want less) and press **Install**. GitHub sends you back to the setup page and shows
   "The GitHub App is installed on <account>".
3. **Check.** Back on the setup page, type your passphrase and press **Show my accounts and check them with GitHub**. The
   account's card should show: App created, installed, and — if GitHub lists any — *requested permissions not yet granted*.
   If it lists some, open the App's page on GitHub (Settings → Developer settings → GitHub Apps → the App → Permissions) and
   accept the new permissions.
4. **Authorize as me (optional but recommended).** Under *3. Authorize as me*, type the account name and passphrase and press
   **Authorize on GitHub**, then **Authorize** on GitHub's page. This lets the server use your own sign-in for the few things
   only a person can do (personal settings). The card then says "You are signed in as …".
5. Repeat 1–4 for `christcr2012`, choosing *Personal user* in step 1.

**No App wanted?** Under *Alternative: use a fine-grained token*, paste a fine-grained token you created on GitHub. It is
checked with GitHub, saved scrambled, and only its last four characters are ever shown. Classic tokens are refused, with one
exception: the optional notifications token (below).

**Notifications (optional, IN-11).** GitHub lets only a classic token read notifications. On GitHub create a classic token
with **only** the `notifications` box ticked, paste it under *Optional: notifications token*. Any other box ticked and the
page refuses it.

## Part 5a — Approve the disposable scratch Organization (IN-06)

After GitHub App setup above, use the same setup page to create **this custom server's App** for `robinson-ai-scratch` (choose Organization), install it on **All repositories**, and click **Show my accounts** to verify an active installation. Under **IN-06: Disposable scratch organization**, enter `robinson-ai-scratch`, choose **Enable**, re-type the exact name and enter your private administrator passphrase. This owner-only setting checks the live GitHub App installation, all requested permissions, an Organization account and production OFF. Never designate `Robinson-AI-Systems` or a real-work organization as scratch. The page also supports disabling scratch mode. **Owner prerequisites verified 2026-10-12 UTC:** the custom App is installed on All repositories, 41/41 stored permissions match, owner enabled scratch ON, production OFF and spend $0; an owner-confirmed audit row exists. This is **not** connected-write acceptance. OAuth clients, active tokens and test-run objects are all zero.

## Part 6 — Connect a compatible client to the CUSTOM server (preview mode first)

1. In a custom OAuth MCP-compatible client (for example Claude: **Settings → Connectors → Add custom connector**), enter `https://github-mcp-chris-projects-de6cd1bf.vercel.app/api/mcp`. This is not the standard GitHub plugin offered by any platform.
2. Complete the custom OAuth sign-in in your browser. Select **only `robinson-ai-scratch`** as account/default, keep **Mode = preview**, use **Profile = read_only** for first live reads (switch to **everyday** only for guarded scratch writes), and enter the admin passphrase privately. Press **Authorize this connection**.
3. Ask the custom-MCP-connected agent: *"Which GitHub accounts am I connected to?"* `github_list_accounts` should show `robinson-ai-scratch` with `scratch: true`; `github_whoami` should confirm PREVIEW, read-only profile and current rate limits.

Production remains OFF for scratch. **Never create a real disposable test repository until run-owned cleanup/recovery is verified.** V-2's `github_dev_cleanup` is now built; a preview+everyday connection can create scratch writes after the owner's OAuth sign-in, with run-owned cleanup proven first on the scratch account. Normal account production is a separate IN-07 decision.

## Part 7 — What the Apps ask GitHub for

Requested when the App is created (source of truth: `src/github/app-manifest.js`). Level is what the server may do at most;
the server's profiles and guards decide when it actually does.

- **Repository, read & write:** actions, administration, checks, codespaces, codespaces secrets, contents, Dependabot secrets,
  deployments, discussions, environments, issues, pages, pull requests, repository custom properties, repository webhooks,
  secret scanning alerts, secrets, security events, commit statuses, Actions variables, vulnerability alerts, workflows.
  **Read only:** metadata, attestations.
- **Organization:** read & write — members, Actions variables, Codespaces, Codespaces secrets, Codespaces settings, Copilot
  seat management, Dependabot secrets, organization webhooks, personal access token requests and tokens, projects, secrets,
  user blocking, custom properties; read only — administration, custom organization roles, plan.
- **Your account (personal) permissions:** none yet. They are added with the personal-settings tools (Batch O) after being tested
  against real GitHub.
- **Webhook:** `<your address>/api/github/webhook`, signed. The server listens only for the App being installed, changed,
  suspended, removed, and for you revoking your sign-in.

Seven of these names appear in GitHub's documentation data but not in its machine-readable API description. They have not been
tried against real GitHub yet. If creating the App fails on one of them, the fix is to delete that line from the list in
`src/github/app-manifest.js` (Claude can do this in a small pull request).

## Connected-testing checkpoint, 2026-10-12 UTC

- Custom GitHub App `robinson-mcp-robinson-ai-scratch` installed/active on `robinson-ai-scratch`, repository selection All; 41/41 stored permissions, scratch ON, production OFF, spend $0.
- Live HTTP: `/.well-known/oauth-authorization-server` **200**, `/.well-known/oauth-protected-resource` **200**, `/api/github/setup` GET **200**, unauthenticated `/api/mcp` GET and JSON-RPC POST **401** with Bearer challenge. (2026-10-12 snapshot) Informational `/` was **404**; `vercel.json` now rewrites `/` to the landing function — re-verify live; (needs routing fix/test).
- Custom OAuth clients/tokens **zero**, `dev_runs` and `dev_run_objects` **zero**. The network-restricted temporary Vercel sandbox used for HTTP smoke was stopped. No live GitHub write or cleanup has been tested.
- For the next agent: **do not use the environment's standard GitHub connector as evidence of the custom server's OAuth behavior.** Do not bypass the owner-authorized client grant, and do not rotate the encryption key. User stopped testing for today.

## If something goes wrong

**If submitting a form just clears your entries:** The top of the page now contains a labeled **Setup response** and internal forms direct the browser there automatically. A rejected passphrase is not saved and does not create an App. The `ADMIN_PASSPHRASE` is the exact, project-specific encrypted value configured in Vercel `github-mcp` → Settings → Environment Variables, *not* your Vercel/GitHub account password or the encryption key. Privately reveal it there, or replace it with a strong password manager-generated value in Vercel and redeploy. Never paste either value into a chat or GitHub.


**Mobile setup form error (`Secure browser required`):** Open `https://github-mcp-chris-projects-de6cd1bf.vercel.app/api/github/setup` directly in Chrome or another full browser, not the ChatGPT in-app browser. Alternate `vercel.app` setup aliases now redirect to the configured URL before creating a session cookie. The setup form uses `Referrer-Policy: same-origin` instead of `no-referrer`: browser specifications make ordinary HTML form POSTs send `Origin: null` under `no-referrer`, which the server correctly refuses. Only the forms use this policy; callback/error result pages keep `no-referrer`. The administrator setup still requires an exact HTTPS `Origin`, a SameSite=Strict CSRF cookie, its matching form token, and the private administrator passphrase. The server does not weaken these checks for embedded browsers that omit the `Origin` header.


| You see | Meaning | Do this |
|---|---|---|
| "Credentials can only be set up on the production deployment" | You opened a preview deployment's address | Use the production address (`PUBLIC_BASE_URL`) |
| "The server has no encryption key" | `TOKEN_ENCRYPTION_KEY` missing, malformed, or not redeployed | Part 3, then redeploy |
| "Too many attempts. Try again later." | Five wrong passphrases from this network address | Wait 15 minutes |
| "Setup page expired; reload it" | The page was open for over ten minutes | Reload it and repeat the step |
| "Setup link expired" after GitHub | The link is single-use or older than an hour | Start the step again from the setup page |
| Card says "Could not read the GitHub App back" | GitHub did not answer, or the App was deleted on GitHub | Press the check button again; if it persists, delete the App on GitHub and redo Part 5 step 1 |
| An account shows "suspended" | The installation was suspended on GitHub | Unsuspend it in GitHub → the organization's Settings → Installed GitHub Apps |

To start an account over: delete its App on GitHub (Settings → Developer settings → GitHub Apps → Advanced → Delete), then
repeat Part 5. To rotate the encryption key or the passphrase, change the value in Vercel, redeploy, and (for the key) redo Part 5
for each account, because saved credentials were scrambled with the old key.

## Optional package authentication — October 18

Package tools now use a dedicated classic personal access token (`P`), enrolled only through the passphrase/CSRF-protected private setup page. Use `read:packages` for metadata, plus `delete:packages` for deletion and `write:packages` for restoration. Repository-scoped registries additionally need `repo`; do not select unrelated scopes. The token must belong to the connected personal account or the person already authorized for the organization. It is encrypted separately from notifications (`K`) and never accepted as a tool argument. Replace or remove it on setup; revoke it on GitHub if no longer needed. Package-level access, SSO and organization token policies still apply. Repository/permission-limited passes cannot use an un-narrowable classic token; read-only connections can list but cannot mutate. Package operations preserve production, preview, confirmation and independent readback guards. Universal REST requires explicit `cred: P` on supported org/user package routes; curated deletes/restores still require their specialized tool. A saved token or accepted App grant does not prove real package access.

The database upgrade is additive and rerunnable, adding four nullable dedicated package columns. Existing credentials and account policy remain intact. Rollback code can ignore these columns; remove the optional credential in setup before retiring the new path. Real package acceptance still requires owner enrollment and an exact disposable package fixture.
