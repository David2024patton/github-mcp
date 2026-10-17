## 2026-10-16 — Y-1/U-1 universal provider price classification (owner-authority correction)

The former universal `universalPrice` source threw for 100 risk-keyword routes, unconditionally preventing otherwise legitimate paid GitHub API actions for a consenting end user; other unreviewed operations that lacked one of the risk keywords were incorrectly priced at $0. Owner-approved correction: precisely the independently reviewed pinned 54 `FREE_ROUTES` may be quoted free; **all other GitHub universal REST writes are cost unknown**, may be executed only through real owner-delegated full PRODUCTION confirmation, and are blocked by an actual user-selected finite spend cap or RTC pass cap. A missing user product cap is not the implementing agent's $0 policy. Curated routes, scoped principal, protected resources, exact official schema, sealed secrets, anti-bypass and no-unverified-readback protections remain intact. No developer live, paid, unauthorized org or cross-project mutation is approved.

## 2026-10-16 — Bundle 10: owner answered IN-15/16/17 yes; wiki over git in memory; no leaked-credential tool

**2026-10-16 — Product-user authority supersedes developer-restriction interpretations (owner correction).** The GitHub MCP's end user's coding agent must be able to execute every feasible GitHub API action that user has delegated, even if it spends money or alters production/security. The developer agent's $0/scratch/no-LIVE restrictions are development-process constraints, **not** default product denials. Give cost/risk notices, obtain the authorization required by the end user's own delegation settings and provider policy, then execute and verify. Unknown metered cost must be identified honestly and offered through an authorized execution path rather than permanently refused or downgraded to a guide. Historical IN-09/B-4 and Y3 were misread when made product-wide; preserve explicit end-user budgets and account permissions. See [END-USER-AUTHORITY.md](END-USER-AUTHORITY.md); runtime implementation and acceptance remain open. No developer spending or live tests were authorized by this decision.

1. IN-15, IN-16, IN-17 were all answered "yes" by Chris (2026-10-16). Y-8's earlier "guide only" wiki default is replaced by real tools.
2. Wiki: `isomorphic-git` and `memfs` (exact versions pinned). Nothing touches disk; only `https://github.com/<owner>/<repo>.wiki.git/...` is reachable through the injected fetch; redirects refused; token is the HTTP password only; limits 200 pages / 5 MB / 1 MB per page / 20 MB transfer. `credentialFor` was split out of `githubFor` so the wiki uses the same pass narrowing and error messages.
3. Organization migrations never relay the archive (private data); status points to the browser download.
4. `github_credential_report_leak` is not built: the GitHub endpoint receives the secret itself, which breaks "secrets never pass through a tool". A guide covers revoking on github.com.
5. Read-backs live in one table (`src/data/readbacks.js`); a test checks every route and value pointer against the vendored GitHub description.

## 2026-10-16 — Y-8: jobs never wait, archives are opened in memory only, wiki stays a guide

1. A slow GitHub operation returns a job id; `github_job_status` makes one GitHub call and returns, so no request is held open and no loop exists. Jobs belong to the connection that started them and expire after 24 hours.
2. Artifacts and repository snapshots are read on the server with hard limits and never written to disk; binary files return only name, size and SHA-256; the signed download address is never shown.
3. Committing an autofix requires a named branch (the production check needs it) and a ready fix; the default branch counts as production.
4. Release upload gained an artifact source but no new host: the existing upload address check stays the only upload path.
5. Wiki editing: IN-17 is still recorded as open, so the default stands (guide only, no `isomorphic-git`/`memfs`). If the owner approves, it becomes a later card.

## 2026-10-16 — Y-7: paid security features are refused, not priced; advisory text is never stored

1. Turning on code scanning, secret protection or push protection for a private repository is billed per active committer. There is no verified price source, so the tools refuse instead of guessing (same as `github_security_set_feature`): `github_security_code_scanning_default_setup` refuses private repositories; a configuration with paid settings is attached only with scope `public` (or named public repositories) and cannot be the default for private or all new repositories; turning on paid settings of a configuration already attached to a private repository is refused. The design's "priced and blocked at $0" is therefore stricter: blocked at every limit until a real price table exists.
2. Advisory text (description) is sensitive: results and the change log keep only ids, state, severity, package names, a 200-character summary, and the SHA-256 and length of the description. No inverse is recorded for advisory changes. Publishing needs the GHSA id typed again, is production-class and cannot be undone; a CVE request cannot be withdrawn.
3. A report to another project's repository goes out as the signed-in user (credential U), always asks first and names the receiving owner.
4. Not built: `github_security_bypass_review` (the pinned description only has "create a push protection bypass", which would weaken protection) and advisory private forks (no route; `startPrivateFork` is offered on create instead). Autofix moves to Y-8 with the async jobs table.
5. Custom secret patterns are regular expressions, not credentials; they are sent only as `pattern` and the log keeps a hash. Pattern lists read only the first page (the description's list route is cursor-paged).

## 2026-10-16 — Y-5/Y-6: deletes never replay as errors, runner tokens only through the one-time page, limit increases count as spend

1. Moderation deletes (comment, issue, discussion, issue type, issue field, runner group) are production-class and have no undo; the preview names what is lost and quotes other people's text as untrusted data. Org issue type/field deletes need the exact name typed.
2. Runner registration, removal and just-in-time tokens are sealed in the one-time store (10 minutes, as for other secrets; the design said one hour and was not followed); the tool returns only the setup-page address. A token GitHub reports as already expired is reported as unconfirmed.
3. Letting public repositories (or every repository) use a self-hosted runner group is off by default and is an access change with a plain warning. A runner that is online and busy is never removed.
4. `github_actions_set_limits` is a new tool rather than an extension of `github_actions_set_settings`. Raising cache retention, cache size or artifact/log retention is priced at a one-cent placeholder because the real bill cannot be computed, so it is blocked while the spend limit is $0; keeping or lowering a value is free. The OIDC subject template is free.
5. `github_deploy_review_pending` is not built: `github_actions_review_pending_deployment` and `github_actions_list_pending_deployments` already exist.
6. `github_env_protection_rule_save` refuses an app GitHub does not list as available for that environment. `github_deploy_review_custom_rule` only works for the App that owns the rule; GitHub's refusal is surfaced.

## 2026-10-16 — Y-3/Y-4: public reads, user-credential social writes, project tools identify by owner and number

1. Public reads (`public-read.js`) allow only GET on a fixed list of path roots and always give a private or a missing repository the identical "not found, or not publicly visible" answer. Free text is capped and marked untrusted.
2. Follow, watch, profile links and star lists use the signed-in user (credential U) and prove the user with `GET /user` before and after. Following a stranger needs confirmation (people guard); changing profile links is a production, access-widening change because the links become public.
3. Project tools take `owner` + `number`, never trust the owner from the arguments (GitHub must report the same owner login), and use the installation credential for organizations and the user sign-in for personal accounts. Deleting a project needs the exact title; deleting a project, a field or an item is production-class and has no undo; making a project public always asks first.
4. Select-option edits resend every existing option with its id; options are removed only when named in `removeOptions`. Iteration schedules are not edited through the tool (GitHub replaces all iterations at once); they stay on the web page.
5. "Nothing to do" and "already exists" refusals happen in the apply step, not the read step, so a repeated identical call is reported as replayed instead of as an error.

## 2026-10-16 — Y-1/Y-2: free-route table, account permissions kept out of the manifest, specs never lower guard marks

1. Universal REST spend is decided per exact route (`FREE_ROUTES`), not by a smarter regex; hosted runners, retention/storage limits, Codespaces, Copilot, billing, code-security configurations and Marketplace stay blocked because their cost cannot be computed. Pinned counts: 54 free routes, 100 blocked writes (the design's "about 128" was measured before reading the vendored description).
2. Account (user) permissions are not added to the App manifest: GitHub rejects a manifest with an unknown name, the docs data and REST description name some differently, and no offline test can prove acceptance. They stay on the OAuth user route (credential U) and the owner checklist. `repository_advisories` is not in the pinned description; advisories use `security_events`. Six names that are in the description were added (`packages`, `merge_queues`, `artifact_metadata`, `organization_packages`, `organization_self_hosted_runners`, `organization_events`). An existing App gains them only by the owner's approval on github.com (IN-15); `github_check_permissions` compares the stored installation map and never reports a permission it has not been shown.
3. A GraphQL write spec records its reviewed marks but can only make a write more cautious (destructive wording); the generic production + access + notifies marks are never lowered by a spec. Lowering them for pins, locks and similar quiet changes would need an owner decision. GraphQL schema defaults (for example `notifyTeam: true`) are treated as part of the request and verified, because the server applies them.
4. `github_account_set_status` always asks for confirmation and only accepts `:emoji_name:` shortcodes so the read-back compares exactly.

## 2026-10-16 — scoped passes: defense in depth, owner controls never delegated

A pass is a separate principal with limits chosen by the owner, never inherited from a login. Stronger passes (production, spending, access changes) can be issued only through the passphrase-protected setup page; the agent tool `github_create_pass` can issue only a preview pass without spending or access changes. Owner-control tools are refused for every pass, even a "full" one, so a pass can never mint, widen or revoke authority. The same rules are checked five times (database CHECKs, issuance, authentication, dispatcher, gates) and the GitHub credential itself is narrowed to the pass's repositories, falling back to the pass list rather than "all repositories". A request limit of 120 per minute is the default (IN-10). The conformance fixture serves `rtc: 1` only inside tests; the production manifest stays `rtc: 0`. The upstream `reads` probe (full recovery of a >8 KB string) conflicts with this server's 8 KB reply rule and is recorded as a known difference.

## 2026-10-16 — undo is a dispatched change, not a second writer

`github_undo_change` never calls GitHub. It re-dispatches the stored inverse so every guard of the target tool applies again, and refuses a change followed by a newer change to the same repository and tool family (this also blocks double undo). Reason: a stale opposite must never overwrite newer work, and a second write path would duplicate the safety checks. The read-only smoke test blocks non-read requests at its network function as defense in depth, and skips rather than invents arguments.

## 2026-10-16 — webhook-target seed and run-bound forwarders

A `webhook-target` scenario allows `webhookLimit(scenario)` test hooks (default 3); a run with no single scenario allows none. Its forwarder is bound to the run and repo and is deleted by run cleanup (execute and standalone) after the repository is confirmed absent. The signing secret is revealed once and never journaled; the journal holds only host and counts. Reason: scratch runs must leave no registered receiver behind.

# Decisions (dated)

One entry per design decision, newest last. Reasons live here; current rules live in AGENTS and the designs.

**2026-10-10 — Build a separate, hosted GitHub MCP in the Stripe MCP's style.** Chris's plan is one solid server per
service (Google Workspace, Stripe, then GitHub, Vercel, Neon), combined later by Robinson's Toolkit (the hub). The research
audit (`docs/audits/2026-10-10-research.md` §2) found that the old toolkit's `github` namespace (311 tools) had no
preview, confirmation or change log on any write (including deleting and transferring repositories, force-moving refs and
merging), a branch-protection "update" that silently removes protections, logs returned as cut-off base64 zips, an
outdated API version, and App tools that used the wrong credential. GitHub holds the code and the switches that put it in
production, so it gets the same preview / confirm / read-back / change-log discipline, hosted so it works from a phone and
from any agent.

**2026-10-10 — Standalone first; RTC 1; general tool for builders, owners and operators.** Same decisions as the Stripe
MCP (Chris, 2026-10-10): fully usable on its own (connector, HTTPS API, passes) whether or not the hub exists; follows
the Robinson Tool Contract; every tool tagged builder / owner / operator; Batch V developer tools that refuse production;
Batch O owner tools with guided settings for every dashboard-only setting; project profiles optional (Batch P), with
Appliance Desk and the Robinson servers as completeness checks only.

**2026-10-10 — Two private GitHub Apps created from manifests (recommended; IN-04 decides).** Hour-long installation
tokens instead of a long-lived key, per-installation repository choice, tokens downscoped per connection (a read-only
connection literally cannot write), writes shown as the App's bot, check runs available, one-click suspend. Private Apps
can only be installed on their owner account, so one App per account (`Robinson-AI-Systems`, `christcr2012`; the scratch
organization later). GitHub's manifest flow hands the App's keys straight to the server — nothing to copy, nothing in
chat. A user authorization of the App covers personal settings; an optional classic token with only `notifications`
covers notifications (GitHub offers nothing else). Fallback: one fine-grained token per account. Research §4.

**2026-10-10 — "Production" is GitHub's version of Stripe's live mode.** Connections are `preview` (default) or
`production`. Production targets are computed from GitHub (default branch, protected or ruleset branches, profile
production branches, tags and releases, repository-level settings, production environments, organization and account
scope; a failed read counts as production). Production needs a production connection, which needs the account's
production switch, which needs a tool call plus the passphrase on the setup page. Previews never offer production or
credential setup (BATCH-B B2, BATCH-A A10).

**2026-10-10 — Merges only at the exact head with required checks green; never `bypass_rules`.** This is Chris's own
build rule (AGENTS "Merging" in every Robinson repo) and the official GitHub MCP's `expectedHeadSha` idea, enforced in
one helper (`src/github/ci-state.js`). Merge commits by default. No "merge anyway" argument exists.

**2026-10-10 — Self-protection with two levels.** The server's own repository and the other Robinson servers' repositories
are `pr-only` (the PR conveyor works, so the servers can still be built through this one; everything else is refused);
the hub's relay, the frozen old toolkit and this server's own App installations are `locked`. Edited only on the setup
page (IN-08). Shared decision 7, refined for GitHub.

**2026-10-10 — Access, message and spend guards.** Widening anyone's access or making anything public always needs
`confirm`. Notifications need `confirm` only when they reach someone outside Chris's own people (IN-13), so the daily agent
conveyor (PRs, comments, reviews in his own repositories) runs without friction. Spend has a monthly limit per account,
default $0, raised only on the setup page (IN-09).

**2026-10-10 — Secret values never pass through a tool.** Actions/Dependabot/Codespaces secret values are typed on the
setup page or generated by the server, sealed with the scope's public key (libsodium sealed box) and read back by
`updated_at`. Webhook secrets are generated server-side. Anything that must be seen leaves once through the one-time page.
Moving a value from another service (e.g. a Neon connection string) into a GitHub secret is a hub workflow (ROADMAP).

**2026-10-10 — Testing without an official mock.** GitHub publishes no mock server (`@octokit/fixtures` only replays
Octokit's own scenarios). Tests use a fake GitHub behind Octokit's `request.fetch` that validates every request against
the vendored OpenAPI description and every GraphQL document against the vendored schema (CI job `shapes`), plus real
throwaway Postgres. Real-account checks are read-only (X-2) or confined to a scratch organization (IN-06). Research §5.

**2026-10-10 — Pin REST API version `2026-03-10`.** The newest version on 2026-10-10; the old toolkit sent `2022-11-28`.
The OpenAPI description and GraphQL schema for it are vendored with checksums; moving the version is its own card.

**2026-10-10 — Runtime Node 24.x, not Node 20.** The shared server decisions said Node 20, but Vercel disabled Node 20 for
new deployments on 2026-10-01 (https://vercel.com/changelog/node-js-20-is-being-deprecated, read 2026-10-10). A-1 sets
`"engines": { "node": "24.x" }` and `node-version: 24` in every CI job, so CI runs what Vercel runs. Appliance Desk already
runs Node 24 in CI. Code stays plain ES modules with nothing Node-24-only in `src/core/`, so the hub's shared package is
unaffected. Same change in the Vercel and Neon plans.

**2026-10-10 — Every tool name starts with `github_`.** The Vercel, Neon and GitHub servers share nouns (project, branch,
deployment, environment, webhook); two connectors in one chat must never offer two tools with the same name, and an agent
should see at a glance which service a tool touches. Pattern `github_<area>_<verb>`; `scripts/count-catalog.py` refuses
any other name. Same rule in the Vercel (`vercel_`) and Neon (`neon_`) plans.

**2026-10-10 — Profile tools are `github_profile_*`.** `github_project_*` is GitHub Projects (F-3); the three
project-profile tools were renamed `github_profile_list`, `github_profile_get`, `github_profile_draft` so the two never
mix in search or listings. Matches the Vercel MCP (`vercel_profile_*`).

**2026-10-10 — The catalog counter lives in `scripts/`.** `scripts/count-catalog.py` (was `docs/count-catalog.py`):
every check the gate runs lives in `scripts/`; the work-index validator stays beside the index it validates.

**2026-10-10 — Owned branches may allow a project's own agent steps.** Appliance Desk's fallback publishing runbook has
agents create `transfer/<id>` branches and upload files with their GitHub tool. A profile's owned ref can list
`agentMay: ['create-from-default', 'commit-files']`; every other change to an owned ref still needs `outsideProject`.
Amendments in BATCH-B and BATCH-P.

**2026-10-10 — Public repository, no automated review (IN-01, provisional).** Mirrors Chris's Stripe MCP decision of
2026-10-10: public (free CI minutes, free secret scanning and push protection), and every PR carries a written self-review
of the full diff against AI-PR-READ-FIRST instead of a Codex review. If an organization-wide reviewer posts anyway, its
threads are fixed or answered and resolved; nobody waits for one. Applied provisionally until Chris confirms.

**2026-10-10 — Hand-built where it matters, universal for the rest.** 295 hand-built tools cover the build conveyor, CI,
governance, owner side and developer tools; six universal tools (`github_api_*`, `github_graphql_*`) reach every other
REST operation and GraphQL mutation, validated against GitHub's description, with a safe default (unclassified writes are
treated as production + access-widening). Runners, merge queue, Copilot agent features, migrations and other rarely used
areas are universal only until the change log shows repeated use (ROADMAP).

**2026-10-10 — Gap check against prior toolkits.** Chris asked for every GitHub tool he had built or planned, in any of
his toolkit repositories, to be checked against this plan. `docs/audits/2026-10-10-prior-tools.md` maps all 528 prior
names (the old toolkit's 311 plus 217 from `robinsonai-mcp-servers` and `robinsons-toolkit-api`, built or planned):
432 → hand-built tools, 59 → universal tools, 34 dropped (Projects classic, required workflows, workflow-usage timing and
legacy Copilot metrics endpoints were retired by GitHub; the org audit-log API is Enterprise Cloud only; GitHub Models
inference is out of scope), 3 named gaps plus one planned category added: `github_content_check_codeowners` (D-2),
`github_release_delete_asset` (G-5), `github_package_delete` (G-6), `github_security_compare_dependencies` (H-4).
Each fits its existing card (budgets +40 lines), so no card was split. Everything else stays universal under the ROADMAP
rule (hand-build when the change log shows repeated universal calls). Totals 301 → 305 (299 hand-built + 6 universal).
`docs/TOOLKIT-NAME-MAP.md` (D-1) now covers all 528 names, not only the 311.

**2026-10-10 — Token-approval tools renamed `github_tokenpolicy_*`.** They were `github_pat_*`, which is also the real
prefix of GitHub fine-grained tokens, so every secret scanner (ours included) would flag the tool names themselves.

**2026-10-10 — Plan approved; no automated review (Chris).** "I approve the plans, and I don't want the automated review
at this time." IN-00 and IN-01 answered; designs marked APPROVED. An organization-wide Codex reviewer may still post
until Chris turns it off for this repository; agents answer and resolve its threads but never wait for one.

**2026-10-10 — No compatibility with the old toolkits (Chris).** "The reference to the older toolkits was to help make sure
you designed this custom MCP with as much functionality as possible … I don't need legacy compatibility." Removed the
old-name map from D-1 and the toolkit decision note (X-3); IN-14 answered "not needed". The prior-tools audit stays as
the completeness checklist it was meant to be.

**2026-10-10 — Stronger anti-stall rules (from the implementing agent's own diagnosis).** Sol stopped after opening a PR
with red CI although nothing blocked it. Its reasons: too much code before running tests; preventable CI errors (a wrong
API parameter, lint, outdated test expectations); no rule forcing a red PR to be finished first; and chat sessions that
end between actions. Added: SESSION-START §0 (finish open PRs first), §6 (problems vs real blockers, thin slices, a
no-shell path with draft PRs, an exact recovery point at every push) and AGENTS rules 11–13.

**2026-10-10 — CI cadence (from the implementing agent's review of its own CI use).** Every push runs the full CI on
purpose (the merge gate must be green at the exact head). The waste was pushing fixes while a run was still going, which
started overlapping full runs. Rule added to SESSION-START §6: never push while your PR's run is in progress; collect all
failures, fix them together, push once; run checks locally first; "re-run failed jobs" only for infrastructure hiccups.
CI cancels an obsolete PR run when a newer push arrives.

**2026-10-10 — Connection settings are validated where they are stored (A-3a).** A login code or token row with no
accounts, a default account outside its list, or an unknown mode, profile or listing would either be unusable or hand out
more than the login chose, and a refresh copies those settings forward unchanged. `checkConnection` in `src/db.js` refuses
such a row for codes and tokens alike, so a bug in a later endpoint cannot write one. Whether `production` is allowed stays
in the login endpoint (A-3b), which can see `gh_accounts.production_enabled` and `VERCEL_ENV`. Also: the copied login
primitives had a crash on an empty submitted passphrase; fixed in this copy and flagged for the source and the hub core.

**2026-10-10 — Login handlers take an injected policy; the MCP endpoint refuses every call until Batch B (A-3b).** Stripe's
"core" login handler hard-codes its own account table and modes, which would break the rule that `src/core/` imports nothing
service-specific. Here the core handlers (`oauth-handlers`, `mcp-auth`, `mcp-server`) take a policy or function for everything
service-specific and the GitHub rules sit in `src/oauth/policy.js`, so the hub can extract the core unchanged. `/api/mcp` lists the
registry but its default dispatcher refuses every `tools/call`: with no safety layer yet, a tool registered early must not be able
to run. Production connections are refused unless the deployment is the production one (A10) and, at login, unless every selected
account has `production_enabled`; a production token presented to a preview deployment gets a plain 403 so a client does not loop
on sign-in. The database schema is created once per server instance, not on every request.

**2026-10-10 — The secret scan skips the two vendored GitHub data files (A-4).** GitHub's own REST description contains example
token- and key-shaped strings in its response examples (nine findings), so the scan cannot pass on the file as published. Rather than edit
vendored data (which would break its recorded hash), `scripts/check-secrets.mjs` skips exactly `vendor/github-openapi/api.github.com.2026-03-10.json`
and `vendor/github-graphql/schema.docs.graphql`; their `SOURCE.md` files and every other file are still scanned, and a test pins the list.
Moving the API version means changing that list in the same card.

**2026-10-10 — Write spacing is the database slot, one second for every write; writes are never replayed (A-4).** `@octokit/plugin-throttling`
queues writes per process and makes GraphQL and notification-triggering writes wait one and three seconds, which does not work across Vercel instances
and slows reads that happen to use GraphQL. Its queues are replaced by no-ops and `gh_write_slots` (one atomic statement) spaces every write one second
per account across all instances, with a five-second maximum queue (then `rate_limited`). `@octokit/plugin-retry` retries any method on a 5xx; a write
that failed with a 5xx may have been applied, so writes and GraphQL mutations get zero retries (A8's request key and read-back cover genuine retries by the
caller). Secondary-limit 403/429 answers mean GitHub did not process the request, so those are retried once when `retry-after` fits the 20-second budget.
Bookkeeping after a completed call (rate headers, ETag cache) never turns a successful GitHub call into an error.

**2026-10-10 — The fake GitHub refuses unknown top-level body fields (A-4).** GitHub's description almost never forbids extra fields, so a misspelled or
foreign field (`mergeMethod`, `bypass_rules`) would validate and be silently ignored by GitHub. The test fake reports any top-level body field not named by
the operation's schema as invalid (422), recorded in `invalid`; tests assert it is empty. Nested objects are validated by the schema as published.

**2026-10-10 — Credentials are sealed with a context, App JWTs are signed by hand, and one refresh race is tolerated (A-5a).** Each encrypted value (App key, client secret,
webhook secret, user and refresh tokens, pasted tokens, cached installation tokens, PKCE verifiers) is encrypted with its owner in the authentication data, so a database row copied
to another account, App or scope fails to decrypt instead of being used. The App JWT is signed with `node:crypto` (RS256) rather than `@octokit/auth-app`, whose own network and cache
layers sit beside our client, fake and rate state; the token request itself is an ordinary typed request the fake validates. GitHub refresh tokens work once, so when two instances
refresh at the same moment one is refused; the loser re-reads the account and uses the winner's new tokens, and only clears the sign-in when nothing newer exists. A fine-grained token
cannot be narrowed per connection, so a read-only connection on such an account is refused in words rather than silently given a full token. `upsertAccount` never changes
`production_enabled`, spend limits, credentials or the default flag of an existing account.

**2026-10-10 — The setup page is one dynamic function, asks for no account permissions yet, and splits the webhook out (A-5b).** Vercel's Hobby plan allows 12 functions and the project already used 8, so the setup page and its two GitHub redirects share `api/github/[action].js` (the webhook keeps its own file because it needs the raw body). GitHub names some account-level permissions differently in its docs data and in the REST description (for example `emails` and `email_addresses`), so the manifest requests only repository and organization permissions until Batch O can test the account ones for real; seven requested names exist only in the docs data and a test pins that list so any change is deliberate. The webhook and the first two tools moved to A-5c to keep each PR under the size limit. Every setup action needs the same-origin check, a double-submit CSRF token and the administrator passphrase with the connector login's lockout; credential steps are refused off the production deployment; a GitHub login may not start or end with a hyphen.

**2026-10-10 — A narrow read-only dispatcher stands in until Batch B (A-5c).** The connector endpoint refuses every tool call until the safety layer exists, which would leave the first two tools registered but unusable. `src/tools/dispatch.js` runs only tools that declare `readOnlyHint`, checks their arguments against their own schema, and withholds any result shaped like a GitHub token or private key; everything else is refused exactly as before. Batch B replaces it with the full dispatcher (profiles, guards, change log). The webhook signature is checked with Node's own HMAC rather than `@octokit/webhooks`, so only the GitHub client imports `@octokit/*`, and an installation reported on an account that does not own the App is ignored rather than stored.

**2026-10-10 — The encryption key is made on Chris's own computer and the encryption key, passphrase and database address are set by Chris (A-6).** `docs/DEPLOY.md` gives the one-line commands for Mac, Linux and Windows and tells Chris to keep one copy in a password manager; the variables are set for the Production environment only because the server refuses credential steps elsewhere. Claude may create the Vercel project and Neon database (IN-02) but never sees the three secrets (IN-03).

**2026-10-10 — The write layer is new, gate-based, and claims its request key in the database (B-1).** The design assumed a write layer copied from the Stripe server; that one is built around money and a live/test flag, so GitHub's is a fresh contract-generic `defineWrite` whose classification (production, access, people, spend) comes from the tool and whose refusals come from an ordered list of gates, one per guard card. Missing gates or change log make a write refuse. The "same call within ten minutes" rule is enforced by a partial unique index on `change_log.request_key` for real writes, so two server instances cannot both send; a definite GitHub rejection releases the key so a corrected retry is a new change, an uncertain outcome keeps it and a repeat answers with a warning instead of sending again. Test helpers live in `test/helpers/` (the repository's convention), not `tests/helpers/` as the design wrote.

**2026-10-10 — Production is turned on in two steps, and owner names only add (B-2).** A tool alone can never switch production on: `github_enable_production` only creates a 10-minute single-use request, and the owner's passphrase on the setup page completes it, so an agent that is tricked cannot widen its own power. Turning it off needs no passphrase because it only reduces risk. Extra production names (environments and branches) are stored in the new `server_settings` table and can only be added to the built-in `production`/`prod`/`live`, never subtracted. A failed read of the current state is treated as production.

**2026-10-10 — The protected list fails closed and is allow-list based (B-3).** On a `pr-only` repository the guard permits a named list of pull-request-routine tools and refuses every other tool, including ones not yet built, so a new tool is safe by default; a test checks that every allow-listed name exists in the catalog. Merges there need the 40-character `expectedHeadSha`. The starting list is inserted once (flag in `server_settings`) so the owner's removals stick, and only the setup page edits it. Project ownership is written against the Batch P profile shape and looks profiles up through `ctx.profileFor`, which P-1 provides; without a profile nothing extra applies.

**2026-10-10 — Spend counts everything that may have cost money; unreadable member lists mean more questions (B-4).** The monthly spend total includes sent changes whose result is unconfirmed or uncertain (only a change GitHub definitely rejected is left out), so the limit can never be exceeded by a lost answer. If an organization's member list cannot be read, its members are treated as outsiders, which only adds confirmations. Prices come from one table with source and date; a price GitHub does not publish (Copilot Enterprise) is left out so the tool refuses instead of guessing. The spend limit and the extra own-people names are edited only on the setup page; Claude's tool can only lower the limit.

**2026-10-10 — Hide secrets by name and shape, not by the word "key" (B-5).** GitHub's SSH and deploy-key `key` field is a public key, so only exact secret-like field names (`token`, `secret`, `password`, `pem`, `private_key`, `client_secret`, ...) are hidden, plus anything shaped like a GitHub token or a private key anywhere in the text. Shaping replaces credential-shaped text rather than refusing the whole result; the dispatcher's withhold remains as a second line of defence.

**2026-10-10 — `github_call` is a runner, not a read or a write (C-2).** It hands the named tool back to the same dispatcher, so every check of the inner tool applies and nothing is duplicated; because it can run changes it is annotated as not read-only and destructive. `github_batch` is read-only and refuses anything else before it runs a single call. Neither can run the tool-finding tools (no loops). Tools hidden from a compact list stay callable by name; the profile, not the listing, decides what exists.

**2026-10-10 — The full result is kept, the reply is the cut one (C-1).** Long text and big lists are cut for the reply but the complete shaped result (secrets already hidden) is kept for 24 hours behind a handle readable only by the connection that made it, so nothing is lost and nothing large travels by default. Fields keep the safety marks and Denver times; pages shrink themselves to fit 8 KB and say which size to keep using. The six tools built before this keep their own `brief|full` argument.

**2026-10-10 — The rate-status tool bypasses the rate block (B-8b).** `github_rate_status` is most needed while the server is refusing calls because GitHub said to wait, and the client refuses calls during a block. `GET /rate_limit` is free, so the tool asks GitHub directly with the minted token (`bareOctokit`), and reports a failure as text. The dashboard map is seeded from the catalog's "no API" list because the Appliance Desk needs file has no guided rows.

**2026-10-10 — A paid change is priced by a function, never by the arguments, and the checker compares code with the catalog (B-7).** A spend tool must supply `price`; the cost it returns replaces anything the classifier said, and a failure refuses the change. `scripts/check-writes.mjs` fails any registered tool whose declarations disagree with its tool-catalog row (production, access, notify, spend, confirm, credential, profile) or that has no row, so the catalog and the code cannot drift apart silently. `github_set_spend_limit` became confirm-always and full-profile to match the catalog; `github_enable_production` is marked `A` in the catalog because it can widen what production connections reach.

**2026-10-10 — A read-only connection cannot even mint a writing token, and unknown permissions mean no token (B-6).** Hiding write tools is not enough on its own, so a `read_only` connection's installation token is requested with every granted permission at `read`; an empty permission list would mean "everything" to GitHub, so when the installation's permissions are not known the server refuses to mint instead. Accounts that use a fine-grained token cannot be narrowed this way and rely on the profile and the write layer.

**2026-10-11 — Parameters of a DELETE (or PUT) that are not in the path must be written into the route as a query template (G-2).** Octokit sends every parameter that is not in the path as a JSON *body* for methods other than GET, and GitHub ignores a body on `DELETE …/actions/caches`, so a delete by key would have matched nothing or everything depending on the endpoint. The fake GitHub, which validates each request against the vendored description, reported "query must have required property 'key'". The fix is to write the route as `DELETE /repos/{owner}/{repo}/actions/caches{?key,ref}`. Any future tool whose DELETE/POST/PUT operation lists query parameters in the description must do the same; the request-shape check (`gh.invalid` empty) is what catches a miss.


**2026-10-11 — Add execution packets to reduce repeated implementation discovery (Chris's request).**
The approved plans already define behavior and safety. A second execution layer now records existing exports,
argument-to-request translations, before/after observations, fixture arrangements, ordered edits and exact focused
commands once per JIT card. IMPLEMENTATION-DETAIL, TOOL-RECIPES, REMAINING-WORK and the worked G-4 packet live in
`docs/implementation-contracts/`; workflow entry points make them discoverable. Distant paths remain proposals,
not speculative READY cards. No design override, test reduction, owner approval or model change is implied.
The shared contract's one-write assertion remains intact; compound work additionally proves its mutation trace,
partial failures and replay behavior. Planning does not edit in-flight E-2/G-3 cards or their index entries.

**2026-10-11 — Secret values reach GitHub only from the setup page or the server's own random generator (G-3).** `github_secret_set` never accepts a value. By default it records a request and returns a link; Chris types the value on the passphrase-protected setup page, the server seals it with the place's public key and sends it, then forgets it (a failed send puts the request back). `valueFrom: generate` makes a random value that nobody reads. The design's `change_log_id` column on `secret_entry_requests` is dropped: the setup page writes its own change-log row. Showing a generated value once on the one-time page stays on the ROADMAP.


**2026-10-12 — Batch G implementation gate closed; production and account verification remain separate.** All G-1 through G-6 catalog rows have a merged build reference (#39–#64), fake-transport/contract and database suites were required by exact-head CI, and the post-merge #65 aggregate CI passed (run 38189322554). `docs/audits/G-BATCH-CLOSEOUT.md` is the evidence map. This closes **implementation** only: no Vercel deployment, GitHub App installation, live secret transfer, owner approval, or connected-account smoke test is implied. Batch V proceeds on fake GitHub pending IN-06.

## 2026-10-12 — owner-requested independent server / universal gateway planning repair

RTC external interoperability is independent of shared internal implementation. Hub owns compact broker,
routing and grant mapping; this service owns provider credentials, canonical tools, state and guarded dispatch.
Core adoption is optional and separately gated; do not require K-3 for RTC/Hub acceptance or reduce standalone
capability for common code. Existing source/fake/deployed/real evidence and every owner/CI/release gate remain.
This explicit docs/planning request permits this focused documentation PR; routine cadence remains unchanged.

## October 14, 2026 — owner-delegated concrete implementation designs

The owner requested completing/revising remaining designs, then extending the
same Sol 5.6 implementation detail to all six active custom MCP repositories.
[REMAINING-WORK.md](implementation-contracts/REMAINING-WORK.md) adds typed state/argument/result
contracts, domain-specific failure and recovery cases, current code seams and
finite proof requirements for the remaining indexed scope. This is an explicit
design-maintenance exception to routine no-docs-only implementation work, not a
feature PR or completed subsection. Existing owner-specific missing inputs,
spending/production/credential/cleanup authority remain gated; this entry does
not mark them answered. The original Toolkit stays reference-only.

### 2026-10-15 — W-3/W-4 verified recovery intent

The existing approved review/CI recovery outcome composes guarded E-3/G-1 tools.
Pinned review intents and automatic failed-workflow retry claims reuse the durable
change journal beyond the ordinary ten-minute window, scoped to the principal and
exact target/head. Automatic CI retries conservatively claim the whole workflow/head
across run IDs. No new table or permission. Workflow confirmation binds the original
comment and current discussion; changed lines are evidence for caller judgment,
not a claim of semantic correctness. Thread mutation APIs have no atomic head CAS;
nearest fresh reads plus post-observation detect races without claiming provider
atomicity. Source proof and future custom-service acceptance stay separate.

**2026-10-15 — W source closeout and date-bound usage.** All W-1 through W-7 workflows are implemented at source, independently of actual live/provider acceptance. W-7 reuses the existing P-3 draft checkpoint and guarded writers; conditional paid private security is an explicit owner-review step, never an invented entitlement or activation. Activity and observed billed usage use the same seven complete UTC days because the provider reports daily costs; both boundaries are displayed in Denver time and DST is tested. Unreadable/null/wrong-date costs remain unknown, and absent fixed invoices are not estimated. This is an implementation choice inside approved W-7, not a change to spending, production or owner defaults.

**2026-10-15 — U preflight count correction.** The checked vendored description contains 1,232 REST operations, zero missing x-github.category fields and **24** triggersNotification operations, not the historical research count of 25 in BATCH-U U3. Pinned SOURCE commit/hash and client API version remain unchanged. The next U implementation must derive classifications from this exact checked source, preserve curated-tool precedence and default-deny unknown writes; no automatic vendor/API upgrade or endpoint permission is implied.

**2026-10-16 — V-3 test refs live in plain runs bound to one host repository.** A run created by `github_dev_create_test_branch` has no seed scenario and keeps every object in one repository, because the standalone cleanup engine refuses mixed hosts and seed-scenario runs have finite object bounds. Runs stop at 40 recorded objects (cleanup lists at most 50 and refuses a truncated inventory). A guard that says "no" is returned in plain words (preview and apply) instead of as an unreadable state. The run label is `rtc-run-<runId>` so two runs can share a host repository (the seed default `rtc-run` stays for seeded scratch repositories). A test branch may advance only by the run's own recorded fixture commit (`rtc/<run>/<name>.md`), and cleanup treats that commit as its expected head. Check runs cannot be deleted through GitHub, so cleanup closes them out and says so.
Dispatch additionally refuses a workflow file that differs on the test branch from the default branch, because GitHub would run the branch's code with the repository's secrets.

**2026-10-16 — V-4 forwarders and test webhooks.** A forwarder target is untrusted network input: it must be public HTTPS on port 443, every DNS answer must be public (checked when it is registered and again at each send), the chosen address is pinned for the connection, redirects are refused and nothing is retried (a timeout means "the target may have received it"). The signing secret is generated here, stored only as ciphertext bound to the forwarder, account and connection, and revealed once on the setup page; results, previews and the change journal hold host names and counts only. A test webhook may reuse the forwarder's secret so the developer configures one secret. A forwarder bound to a run or repository can act only inside it. Scratch cleanup used to refuse every webhook; it now accepts only webhooks recorded by exact ID (type Repository) and keeps refusing any other, and a scenario run may carry at most three recorded test webhooks.

**2026-10-16 — Gap-closure Batch Y planned (owner request).** A documentation and capability audit found: the universal REST tool refuses non-enrolled owners, non-JSON bodies and about 128 write operations through a broad spend word list; the universal GraphQL write accepts only two input shapes; `changeUserStatus` pointed at a tool with no status support; the App manifest omits several permissions. Batch Y (`docs/designs/BATCH-Y.md`, cards Y-1…Y-9) closes them in order: a reviewed per-route free list instead of a smarter regex, per-mutation GraphQL write specs that keep independent read-back, hand-built tools for cross-account and viewer-scoped actions, runner tokens only through the one-time page, and owner gates for App permissions (IN-15), money tools (IN-16) and wiki libraries (IN-17). No guard is weakened; unknown operations stay refused.

**2026-10-16 — Bundles ship as one PR (owner).** The full CI and review gates are slow, so a bundle is delivered as a single PR and the complete local gate set (`npm run check`, unit, database, shapes) runs before the one push. A split remains allowed only for the concrete reasons already in AGENTS.md; "it has a migration" alone is not one.
