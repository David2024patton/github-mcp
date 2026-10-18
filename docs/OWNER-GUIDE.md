# Owner guide — what you can ask for

Plain-English things to say to Claude once each part is built. Each line names the batch that delivered it; all of these are built now (live acceptance varies per line; see STATUS). This file is updated as features ship. Anything that touches your real `main` branches, releases,
settings, access or spending always shows you a preview and waits for your OK.

| Say something like… | What happens | Batch |
|---|---|---|
| "Which GitHub accounts am I connected to?" | Your accounts, PREVIEW or PRODUCTION, what the server may do, how much GitHub rate budget is left, your spend limit | A/B |
| "What's the state of PR 42?" | CI at the latest commit (which checks are required), mergeable or not, reviews, open review threads, and the next step in one sentence | W |
| "Merge it when it's green." | Merges only if every required check passed on exactly the latest commit and no review thread is open; otherwise says what is missing | E/W |
| "Merge the stack." | Merges stacked PRs from the bottom up, waiting for fresh CI on each one after it is retargeted to `main` | W |
| "Rerun the failed jobs once." | Pins the failed workflow/head, delegates existing guards, refuses a second automatic retry; pending runs are checkpoints | W-4 |
| "Review this repository's health, security and access." | Bounded observations with missing/plan-limited coverage kept explicit; no automatic fixes or grants | W-5 |
| "Prepare a release." / "Preview finished branch cleanup." | Draft first; separate exact-release publication. Cleanup needs closed same-repo PR/head proof and preserves protected/owned refs; every write remains independently guarded | W-6 |
| "Set up a standard repository." | Private by default, standard policies, one confirmed step at a time; paid private features remain owner review | W-7 |
| "Find this work." / "Give me a weekly digest." | Scoped mixed-object search; seven complete billing days of activity and observed usage, Denver dates, unknown costs never treated as zero | W-7 |
| "Why did CI fail?" | The failing job and step, the error lines, and whether `main` fails the same way — no giant log | G/W |
| "Answer and resolve the review comments." | Checks each fix on the latest commit, replies, resolves — one preview, one OK | E/W |
| "Cut a release." | Draft release with generated notes; publishes only after you say yes | G/W |
| "Clean up old branches." | Deletes only branches whose PR is merged or closed — never `main`, protected or project branches | W |
| "Set up a new repo for my project the standard way." | Private repo, `main` protected by a rule requiring `ci`, merge commits, secret scanning, labels — previewed first | W/P |
| "Is GitHub set up right for Appliance Desk?" | Every row of the Appliance Desk list: ok, fixed with your OK, or exactly what to click | P |
| "Set the STRIPE_KEY secret for this repo." | Gives you a link to type the value on your setup page — the value never goes through chat | G |
| "Give me a throwaway repo to test this workflow." / "Clean up that test run." | Developer scenarios and remote preflight exist; full run-owned write/cleanup acceptance remains open. Restored scratch OAuth can read, but the original quarantined run belongs to its prior connection. No live seed or deletion without verified cleanup baseline and exact authority. | V |
| "Send my app a test GitHub webhook." | Replays a real delivery into the app you are building, correctly signed | V |
| "Review my GitHub organization." | Members and two-factor, security features, apps and tokens, spending, anything needing attention | O |
| "Who has access to my repos?" | Members, outside collaborators, teams, deploy keys, apps and tokens; anything unusual flagged | O/W |
| "Add Sam to the organization." | Shows exactly what access Sam would get, asks you, sends the invitation | O |
| "How much am I spending on GitHub this month?" | Usage by product in dollars, budgets and how close each is | O |
| "Turn on two-factor for the org." / "Change my plan." | GitHub has no way to do these by API, so you get exact numbered steps, then it checks the result where it can | O |
| "Turn on production for Robinson-AI-Systems." | Two steps: Claude asks, then you re-enter your passphrase on the setup page | B |
| "What changed in GitHub through Claude this week?" | The change log | B |
| "Undo that." | Reverses the last change when it has a clean opposite; says plainly when it doesn't (for example a merge needs a revert PR) | X |
| "Make a 24-hour read-only pass for Codex." | A pass shown once on your setup page; the agent uses it through Robinson's Toolkit or the HTTPS API | R |
| Anything else on GitHub | The universal tools find the right GitHub operation and run it with the same safety | U |

## Live testing status — 2026-10-12 UTC

The separate `robinson-ai-scratch` organization is owner-designated; its own custom App is installed, active on All repositories, with 41 recorded permissions, production OFF and spend $0. The custom server responded correctly to OAuth discovery and refused unauthenticated MCP calls, but no custom-MCP OAuth connection or scratch repo write has yet been completed. When testing resumes, connect **this server's** `/api/mcp` endpoint, not the platform's standard GitHub connector. First choose only the scratch account with mode `preview` and profile `read_only`; for guarded scratch writes use `everyday` only after cleanup/recovery is verified. Owner stopped testing for the day; no further owner action is requested now.

## Coding-agent development access (2026-10-13)

The implementing agent uses a renewable native OAuth connection, not a new copied RTC
pass for every retest. `rtool developer-connect ALIAS --profile full` prepares one mobile
link using the custom service. Choose the intended account/resources and authorize once;
return to chat without copying secrets. The agent reruns the command to finish privately,
then uses developer-check, developer-tools and developer-call. Existing original service
write previews, owner approvals and resource guards still apply. This developer workflow
does not reduce the finished product's tool capabilities.

On a managed POSIX cloud runner, configure RTOOL_DEVELOPER_VAULT_DIR to an absolute private
folder outside every Git checkout. The CLI creates a separate 0600 encryption key and
AES-GCM encrypted connection files in a 0700 folder; keep that private runner state for
resumes. OS credential managers remain the desktop default. Neither option places secrets
in chats, prompts, Git or shared artifacts. Initial provider consent or an expired/revoked
underlying authorization can still require a new owner sign-in. Source/tests are not
proof that the new deployed workflow has been exercised against the real provider.

**October 15 source/deployment distinction:** W-5/W-6 source merged in #217; W-7 merged in #218. These new tools require the normal checked release before they are live. The restored custom OAuth can perform approved scratch reads; the original run journal belongs to the old connection and remains quarantined pending its exact preflight/owner disposal gate. No production activation, spending or disposal is implied.

## End-user delegated paid and administrative GitHub actions — Y-9d source merged 2026-10-16

After the verified release and any required GitHub App permissions and user sign-in, the MCP can **actually perform** provider-supported actions — not merely give a guide — when the connected end user delegates them: manage GitHub Sponsors payments, create or scale GitHub-hosted runners, set Copilot cloud-agent policy, assign team seats and start real Copilot agent tasks. These all still honor genuine GitHub account permissions, PRODUCTION/full profile, protected resources, a preview and explicit confirmation. The developer's $0/no-LIVE testing authority is **not** the end user's permanent tool limit.

GitHub can meter runner compute and Copilot agent usage after a change; this has **no guaranteed total upper dollar amount**. The agent must show this plainly before a real change. A user-selected optional $0 or positive monthly MCP spending cap remains binding, and a scoped RTC pass's finite allowance cannot authorize unknown future charges. An account that has not selected a product spending cap is not automatically treated as having chosen a $0 product cap. To raise an existing selected cap use the protected setup page and its passphrase; credentials are never pasted into chat. Recurring future provider bills and provider-specific pricing policies remain GitHub's responsibility. **Code is merged, but these new paths are not declared live or real-provider accepted until the matching `GITHUB-Y9D-*` checks in STATUS pass on a verified READY deployment.**


## Pending O-4 owner-authority repair — not released or accepted

Once this exact corrective PR is merged and released, a properly authorized end-user agent may call `github_billing_delete_budget` to DELETE one exact verified GitHub billing budget after repeating its ID. It shows the existing enforcement, warns of **unbounded future GitHub charges**, requires full-profile PRODUCTION consent, honors any explicit user spending cap or RTC pass allowance, sends DELETE once, and independently reads the budget inventory and individual ID back. The implementation/developer agent is not allowed to delete real budgets during development.

Likewise, `github_codespace_set_org_access` will send GitHub's genuine Codespaces access PUT under explicit permission, production and confirmation guards. With `selected_members`, the complete replacement list must be named and `replaceSelectedUsers: true` supplied after member verification; omitting the flag refuses the action. Allowing members can incur uncapped future compute/storage costs and is refused under an explicit unprovable spending ceiling. **Disabling** org Codespaces access is allowed even with a selected $0 spending cap. GitHub has no documented policy GET endpoint, so an HTTP 204 is marked **unconfirmed** until the owner separately inspects saved settings at `https://github.com/organizations/OWNER/settings/codespaces`; do not interpret a 204 or the caller's submitted values as independent readback.

These capabilities remain **source-only, not provider-accepted or live** while current READY `live` is behind `main`. No existing credentials, configuration, budget, real Codespaces access or production release were changed to develop them.


## Pending Y-7/H-4 paid private security correction — source only

The earlier developer-spend interpretation incorrectly prevented even an authorized end user's agent from enabling private-repository code scanning, premium security features, or attaching paid organization security configurations to private repositories. The approved 2026-10-16 owner decision restores **actual guarded GitHub API execution** on these operations, rather than forcing the user to click through manually.

A private paid activation may bill GitHub **per active committer for continuing future usage**. The agent states the unknown maximum cost, shows the exact repository/configuration and intended setting, and requires real end-user delegated **PRODUCTION/full** approval and genuine provider plan entitlement. A **user-selected finite MCP spending ceiling, including $0, or a bounded service-pass allowance** forbids an operation whose future charge cannot be proven to fit. If no user-chosen product cap exists, GitHub permission and explicit confirmation can authorize the operation. Disabling paid features remains available even with a chosen $0 limit. Changes are logged and read back without assuming provider success.

This is a correction to Y-7/H-4 source and tests; it does not authorize this project's implementing agent to activate any real security products, spend GitHub money, change production configuration, or run live provider acceptance. Only a verified scheduled release plus separately authorized provider tests can establish the custom MCP's live behavior.

## Pending U-1/Y-1 universal paid-operation authority correction — not released

The four REST tools still use the pinned GitHub OpenAPI index: `github_api_search`, `github_api_describe`, `github_api_read`, and `github_api_write`. The 2026-10-16 correction permits a **properly authorized end user's** coding agent to call any otherwise eligible *non-curated* GitHub write—even if future use can cost money. A developer's $0/no-LIVE testing policy is not a user-selected product budget.

**Exactly 54 reviewed provider routes are classed as free.** Every other non-GET REST mutation is treated as **unknown future cost**, regardless of whether its name mentions billing. The agent presents the exact provider operation, connected account/repository, required PRODUCTION/full-mode confirmation, possible access/notification impact and the risk that GitHub can charge for subsequent usage without a known maximum. A user-selected **$0 or finite monthly product cap**, or finite scoped RTC pass allowance, refuses that unknown-cost operation. An owner with no user-selected product cap and genuine GitHub authorization can explicitly approve it through the guarded service. A 403 or plan restriction from GitHub remains a real refusal.

This broad route never bypasses a dedicated curated tool, actual GitHub credential scope, secret sealing/redaction, unsupported enterprise or App-JWT restrictions, protected resources or replay journal. A provider success without independent matching readback is always **unconfirmed**, never falsely reported as fully verified. The developer has not enabled production, spent any money or executed paid provider tests; merging source is not live-source acceptance.

## Package permission checks

The GitHub.com App permission is **Packages → Read and write**. There is no separate organization Packages switch in the observed App settings; the server must not send you to approve `organization_packages` merely because that name appears in GitHub's token schema. The corrected manifest and diagnostics omit that unavailable grant. Your already accepted Packages permission remains valid. The checker reports **capability unverified**, with zero missing package grants, until the package tools have a supported credential path and independent verification; it does not direct you back to settings.

An installation permission check verifies the recorded App grants. It does not prove that a package operation succeeded: GitHub still checks the credential, package/repository access and operation-specific requirements. Read, delete and restore acceptance remain separate; provider refusals must be reported accurately. The scratch App's personal OAuth authorization and available permission updates were completed on October 17. Production remains OFF and paid/destructive tests have their own authorization gates.

## Optional package authentication — October 18

Package tools now use a dedicated classic personal access token (`P`), enrolled only through the passphrase/CSRF-protected private setup page. Use `read:packages` for metadata, plus `delete:packages` for deletion and `write:packages` for restoration. Repository-scoped registries additionally need `repo`; do not select unrelated scopes. The token must belong to the connected personal account or the person already authorized for the organization. It is encrypted separately from notifications (`K`) and never accepted as a tool argument. Replace or remove it on setup; revoke it on GitHub if no longer needed. Package-level access, SSO and organization token policies still apply. Repository/permission-limited passes cannot use an un-narrowable classic token; read-only connections can list but cannot mutate. Package operations preserve production, preview, confirmation and independent readback guards. Universal REST requires explicit `cred: P` on supported org/user package routes; curated deletes/restores still require their specialized tool. A saved token or accepted App grant does not prove real package access.

The database upgrade is additive and rerunnable, adding four nullable dedicated package columns. Existing credentials and account policy remain intact. Rollback code can ignore these columns; remove the optional credential in setup before retiring the new path. Real package acceptance still requires owner enrollment and an exact disposable package fixture.

Private personal package metadata and version reads use authenticated `/user/packages` routes. These require an enrolled personal account whose stored token actor matches that account; an organization-associated token cannot silently expose its actor’s personal packages. Organization routes keep their explicit organization binding. Both supported version inventories accept bounded page parameters. Stored package tokens can be removed on protected production setup even when the encryption key is temporarily unavailable; enrollment still requires a configured key.

Owner overview now recognizes an already authorized personal GitHub identity. It verifies that identity through your enrolled U connection and shows only account ID/login and any readable 2FA/plan status. Missing, revoked or mismatched authorization is reported separately; withheld fields remain unknown. This does not complete a full personal security review or a guided browser setting change, and does not ask you to repeat valid OAuth consent.
