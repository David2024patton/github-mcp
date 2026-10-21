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
| "Can this connection perform this particular GitHub API action?" | Universal discovery can locate a pinned API operation, but the action may still need a different GitHub credential, scope, plan or guarded specialized tool; unknown and blocked are not successful execution | U/CAP-1 audit in progress |
| Anything else on GitHub | Universal tools search the pinned REST/GraphQL surfaces; only operations with supported credentials, scoped dispatch and all safety checks can actually run | U |


## Standard Full access diagnosis and explicit recovery — CAP-2 source reviewed for PR #273

The ordinary GitHub consent form already supports Full, with Everyday as its default. The new source describes Full as enabling requests allowed by a real provider grant and existing user policy, **not** creating provider permissions or bypassing approval. You may ask `github_check_permissions` with a `tool` such as `github_pr_merge` and a selected `account` to see recorded profile, credential, mode and resource/policy blockers. You can also include an exact pinned REST `operation` (for example `GET /repos/{owner}/{repo}`) to show audited GitHub credential documentation separately from your actual, unverified grant; a specific account and tool or area are required. Results showing no source blocker remain **unverified** until an authorized scoped provider call and independent readback. After a known blocker the response includes a concrete ordered recovery recipe, with separate client Full reauthorization, verified user consent, GitHub installation permission approval, production enablement and repository selection where applicable. GitHub's owner must separately approve any permission increase; no automated grant or tool argument can do it for them. Recheck the same operation afterward; unknown provider execution remains unknown until readback. Source CI/merge and deployed acceptance are independently tracked in STATUS.

## Operation readback: Standard versus additional authority

GitHub documents that ordinary App user and installation tokens can list packages for an organization through the REST API, so the optional package token is not automatically required for that read. Notifications, however, require a classic personal access token with a compatible scope. On the protected setup page, a new package or notifications token can be asked for one small matching API metadata read. Only a successful result records that exact read as observed at enrollment; it never proves the user's current permission or broader write/registry rights. Results remain restricted to the owner setup and do not grant delegated passes or other tenants access.

## What the new notification setup recheck actually shows

If your connected owner account lacks an enrolled notifications token, the exact `GET /notifications` diagnostic gives a protected setup link. Once GitHub has returned a successful notification-list read using the currently saved encrypted classic K credential, the same diagnostic returns `read-observed-at-enrollment` rather than telling you to enroll again. This is a historical capability read only: current permission, expired/revoked tokens, tenant ownership, read-only policy, confirmation, and present provider operation must still be enforced when called. A manual token may require GitHub's own secure UI and cannot be issued or pasted through an MCP chat argument.

## Private-member optional credentials — implementation status

Private pilot users are never allowed to borrow the owner server's classic P/K tokens or another tenant member's credentials. The source now reserves an encrypted, per-human, per-workspace K/P record with expiry and provider identity/resource metadata and replay-safe replacement, but it is **not connected to a private member setup form or live execution**. No customer should treat this as working tenant God Mode. The only current guided setup uses the owner-controlled protected page and requires that owner's independent verification. The future private member interface must obtain explicit GitHub issuance/approval, verify the current user and exact operation, seal the token inside that user's workspace, and confirm before/after capability without leaking the bearer.

## Ask the connected MCP how to activate missing optional access

Use `github_check_permissions` with your connected GitHub `account`, an exact pinned REST `operation` such as `GET /notifications`, and a registered `tool` or audited `area`. If GitHub only supports an extra classic token for that operation, the server may provide a link to its own protected setup. This is **a browser form**, not a token request in chat: the owner completes GitHub token issuance and passphrase/CSRF-verified credential entry, then rechecks the same operation. Private tenants and delegated service passes cannot receive the owner's setup link. An operation where ordinary GitHub App credentials are supported, such as listing organization Packages metadata, should not be called God-Mode-only. A provider GET observed during enrollment is historical and does not authorize later operations or override your chosen profile, production, spend, tenant or confirmation policy. Full agent-initiated callback return and broader optional credential scope enrollment are still incomplete.

## Optional credential evidence — CAP-3 draft

The protected owner setup already accepts package (P), notifications (K) and fine-grained (F) credentials and retains their values encrypted. CAP-3 source adds a separate record of the GitHub human's numeric identity **only when independently verified using that submitted credential**. A mismatch or a token replaced since verification is not trusted. You can ask `github_check_permissions` for a selected account and registered tool: the optional credential section distinguishes identity checked at enrollment from operation permission, which remains **not proven**. Removing P, K or F through the protected setup page clears the server-stored token and its recorded proof; separately revoke the original credential on GitHub if necessary. This is NOT active God Mode, does not acquire a GitHub PAT for you, and does not bypass installation permissions, private tenant membership, scopes, spending or production policy. The complete agent-started credential lifecycle is still under implementation.

## Capability inventory — source reviewed for PR #272, October 21, 2026

The CAP-1 source implementation adds `node scripts/capability-inventory.mjs --summary` and `--json` for a versioned operation-by-operation gap inventory. This is **not** an end-user authorization or proof of GitHub provider access. Separate statuses identify a real curated implementation, a merely eligible universal route, unknown credential or enterprise availability, and independent deployed acceptance. No percentage of GitHub functionality is claimed from the current named-tool count. Ordinary Full access recovery is CAP-2 source engineering; optional additional credential setup remains CAP-3 work; using this report does not enroll a token, start God Mode, or enable production.

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

A provider permission header lists an endpoint’s accepted grants; it does not by itself prove that your App is missing them. Error guidance now asks the agent to compare actual grants, credential support and resource access. Boolean metadata and known unavailable setting names are never presented as permissions for you to approve. Actual refusals remain visible, and valid existing OAuth should not be repeated merely to satisfy a fabricated permission label.


Sponsors reads verify whether the payer and recipient are people or organizations before querying GitHub. A verified missing Sponsors listing is shown as unavailable with no tiers. Starting a sponsorship still requires a real published tier, your configured spending authority and confirmation; public visibility or opting into maintainer email also honors your delegated access-change settings. These source changes take effect through the normal scheduled release.


## Upgrade a PREVIEW-only ChatGPT cloud-adapter connection (B-2 correction)

After a reviewed release includes this correction, open the existing protected production `/api/github/setup` page. Submit **Show my accounts** using your administrator passphrase to list the custom connector's IDs, profiles and modes. Under **Upgrade existing custom connection to PRODUCTION**, enter the exact **FULL/PREVIEW** custom ChatGPT connection ID and its sole GitHub account (already production-enabled). The server atomically changes its stored mode with the same bearer and refresh grants, verifies readback and logs access widening. Return to ChatGPT and run `github_whoami` to independently confirm. This avoids repeated ChatGPT sign-in and does not affect the official GitHub connector or authorize individual paid/destructive operations. Preview/non-full/mixed-account sessions fail closed. Deployment and real-world acceptance remain separately tracked.

The adapter's owner-requested label **GitHub by Robinson AI Systems** is not accomplished by this server correction. The current Sites-generated plugin is PRIVATE and the Plugin Creator updater explicitly prohibits App name/presentation changes; obtain a supported adapter presentation-edit workflow before claiming this rename is done.


### Mobile and desktop availability — not yet accepted

The **GitHub by Robinson AI Systems** direct MCP plugin uses the service-owned OAuth selection flow and is currently a PRIVATE desktop-capable candidate; its Codex desktop deep link is **not** an Android ChatGPT entry point. The existing **Robinson GitHub Cloud** ChatGPT Sites/cloud adapter is the mobile-capable candidate and exposes a separate ChatGPT account sign-in. They target the same independent GitHub MCP service, but they need individually verified authorization and tool-call readback before the official GitHub integration can be retired. No public plugin listing or open sign-up is authorized.

After the corrected source passes exact-head CI/review and reaches independently READY live production, the owner can inspect **Custom MCP connections** after passphrase login at the existing setup page. Expired access tokens with valid refresh grants remain identifiable. Only if the target shows FULL / PREVIEW and exactly the owner-approved production-enabled scratch account should the owner explicitly upgrade that existing adapter connection. The upgrade does **not** install or connect a new mobile/desktop client, replace an OAuth grant for a different user, alter GitHub permissions, or authorize a particular paid/destructive change. Verify `github_whoami` from both Android and desktop through each actual connected plugin. Preserve the official integration until both pass and the remaining production acceptance backlog is genuinely completed.


## Private scale work (PUB-1) is NOT a public registration page

The upcoming tenant directory is an internal, non-public storage foundation for future independent GitHub users. It has **no** customer account creation control, onboarding link or self-service passphrase. Your existing private owner setup, `robinson-ai-scratch` App, ChatGPT connections and normal scheduled releases stay unchanged. Neither an admin setup passphrase nor a typed GitHub email grants tenant access. When PUB-2 and PUB-4 eventually ship, customers must separately verify their GitHub identities and the correct tenant and mode through their own consent; a private Android/iOS and desktop web connection must each be independently proven by `github_whoami`. Keep both custom plugins PRIVATE and the official GitHub connector until that acceptance succeeds. Public Directory distribution remains blocked by IN-18 policy eligibility and requires your later explicit approval.


## PUB-2 private GitHub OAuth is being built, not ready for live sign-in

Draft [PR #264](https://github.com/Robinson-AI-Systems/github-mcp/pull/264) now includes a separate tenant OAuth path, mobile-sized profile/mode consent page, protected one-use GitHub callback and tenant-specific MCP access/refresh grants. Its simulated GitHub-provider and real throwaway PostgreSQL tests passed at the recorded source head. It is **not deployed, does not publicly enroll people, and has not been tested on your phone or a desktop ChatGPT client**. An actual owner-controlled tenant bootstrap and registered-client discovery still need engineering and review, and the private OAuth flag is OFF. You do not need to create additional keys, reconnect the official GitHub plugin or touch Vercel yet. Keep current owner and official connections intact and both custom plugins PRIVATE; publication requires another explicit decision after genuine real-world acceptance.


## PUB-2 source versus real-world acceptance (2026-10-19)

The private pilot in [PR #264](https://github.com/Robinson-AI-Systems/github-mcp/pull/264) is a **testing/early-access channel** for the actual multi-user GitHub MCP technology. The permanent production product should let each future customer authorize independently through GitHub without your administrator passphrase, scratch organization, or manually copied pilot credentials. GitHub OAuth, verified users, installation checks and tenant isolation are implemented in source, but **no real new user or Android/desktop connection has been accepted on the deployed service yet**. Before you disconnect the official GitHub connector, the checked scheduled release and genuine end-to-end privately connected device acceptance must pass. Keep the custom plugin PRIVATE and leave customer enrollment disabled until separate readiness and distribution approval.


## Private tenant fairness and emergency stop (PUB-3 source, NOT device acceptance)

Your original owner connection is unaffected by private pilot capacity safeguards. If you later enable an authorized private pilot, each enrolled user has an independent GitHub App authorization; one client repeatedly calling tools can be temporarily asked to wait instead of using another customer's shared capacity. The private pilot stores only anonymous aggregate activity counters for operations, not private repository contents or credentials. Its job/result handles expire within 24 hours and private results have bounded stored size.

The protected owner setup's **Revoke private pilot** action first disables all that pilot's access, then clears stored private session clients, pending codes, encrypted GitHub user grants, jobs and retained results from that tenant, without affecting a different tenant or your legacy credentials. If cleanup is interrupted, private access stays disabled and the owner can retry. This is a deliberate access-revocation and deletion operation, not a normal tool; it requires the existing protected setup confirmation and may remove pilot users' outstanding work, which is disclosed in the setup guide. It is not equivalent to uninstalling your official GitHub connector.

The source changes still need exact-head CI/review, scheduled live promotion and first-hand mobile and desktop connection testing. They do not authorize public listings, outside-user signups, paid capacity or production provider writes. PUB-5 public distribution remains separately blocked.


## Private per-tenant capacity and emergency stop (PUB-3 source verified, pending checked release)

The protected GitHub setup page will allow you to set a **separate client and whole-tenant request rate** for an already verified private scratch tenant. Each change still requires the existing origin check, CSRF, your administrator passphrase and explicit account confirmation; no customer receives that passphrase. Your account's legitimate GitHub tool permissions, approved production operations and spending preferences remain distinct from these fair-use server budgets. An over-busy private client receives an honest retry notice rather than disrupting a different tenant. Default private limits remain 120 requests/client/minute and 600 requests/tenant/minute; owner-selected overrides remain capped by conservative hosting ceilings until actual scale readiness is measured.

The existing **Revoke private pilot** setup action first stops access, then clears only that tenant's clients, codes, access grants, active jobs and retained results. If cleanup is interrupted, the tenant stays disallowed and the owner can retry. The isolated disposable PostgreSQL tests prove another tenant's data survives. PR #267 source checks pass, but this new documentation is **not** a live release; actual controlled private pilot, Android/desktop client and public-scale acceptance are still pending. Keep both custom plugins PRIVATE and leave the official GitHub connection installed until verification is complete.
