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


## Pending U-1/Y-1 universal paid-operation authority correction — not released

The four REST tools still use the pinned GitHub OpenAPI index: `github_api_search`, `github_api_describe`, `github_api_read`, and `github_api_write`. The 2026-10-16 correction permits a **properly authorized end user's** coding agent to call any otherwise eligible *non-curated* GitHub write—even if future use can cost money. A developer's $0/no-LIVE testing policy is not a user-selected product budget.

**Exactly 54 reviewed provider routes are classed as free.** Every other non-GET REST mutation is treated as **unknown future cost**, regardless of whether its name mentions billing. The agent presents the exact provider operation, connected account/repository, required PRODUCTION/full-mode confirmation, possible access/notification impact and the risk that GitHub can charge for subsequent usage without a known maximum. A user-selected **$0 or finite monthly product cap**, or finite scoped RTC pass allowance, refuses that unknown-cost operation. An owner with no user-selected product cap and genuine GitHub authorization can explicitly approve it through the guarded service. A 403 or plan restriction from GitHub remains a real refusal.

This broad route never bypasses a dedicated curated tool, actual GitHub credential scope, secret sealing/redaction, unsupported enterprise or App-JWT restrictions, protected resources or replay journal. A provider success without independent matching readback is always **unconfirmed**, never falsely reported as fully verified. The developer has not enabled production, spent any money or executed paid provider tests; merging source is not live-source acceptance.
