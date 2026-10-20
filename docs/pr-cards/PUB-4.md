# PUB-4 — PRIVATE genuine mobile AND desktop ChatGPT GitHub MCP

**Stage: APPROVED / PLAN FROZEN BEFORE CODING.** No actual mobile or desktop real-client acceptance is claimed. Baseline main `315a3259faafa474a9b36cc8410c5718d5b9326f` (PUB-3 source merged PR #267, merged-main CI/release policy still subject to exact head check). The original 57-row provider acceptance remains separate. Distribution remains PRIVATE and GitHub by Robinson AI Systems is not officially GitHub-endorsed; public Directory eligibility is blocked.

## Drift check before implementation

- Native/direct plugin: `plugins_6ad4e0de57f48191a150db0d040b67c7`, PRIVATE, display **GitHub by Robinson AI Systems**, `.mcp.json` `https://github-mcp-chris-projects-de6cd1bf.vercel.app/api/mcp`. Its previously observed `chatgpt.com/codex/open-...` prompt launch did not work on Android. A green plugin/MCP indicator is NOT a working authorized connection.
- Hosted/Sites adapter: `plugin_asdk_app_sites_6cfcd475448481919dbea3f6730ae7b0`, PRIVATE, `Robinson GitHub Cloud`. Its ChatGPT sign-in UI is different from the MCP's server-owned OAuth form and the last truly observed session remained FULL/PREVIEW despite account-level scratch PRODUCTION enabled by owner. PR #260 provided an owner-protected per-connection upgrade, but genuine new mobile session still must be rechecked on deployed live code.
- Source current `main` includes PUB-1 verified isolated tenant store, PUB-2 private provider-verified OAuth, PUB-3 tenant capacity and owner-only revocation. **Private pilot remains OFF** and no outside customer registration is authorized. Existing original single-owner OAuth must remain usable throughout a safe migration.
- Current independently released `live=f98b45c4e53a154b369d126c59cda35b7a1886fa` is behind merged main. No unscheduled release approved. Keep official GitHub ChatGPT connector untouched until both custom real-device acceptances are evidenced.
- Hub optional, never an individual server product completion requirement; verify advertised Hub spec interoperability at service boundary but no forced Hub relay/sandbox test.

## Acceptance criteria (entire approved PUB-4)

1. [ ] A supported desktop/web ChatGPT client can establish its own PRIVATE native/direct OAuth MCP connection to the real deployed service, select a verified GitHub identity/account, PREVIEW or independently authorized PRODUCTION, and profile, then call github_whoami and representative authorized provider reads. GitHub's official ChatGPT connector remains separate and untouched.
2. [ ] A real Android/iOS ChatGPT client can establish its own PRIVATE supported hosted/ChatGPT app connection without a Codex desktop-only deep link, obtain genuine service-owned consent and a selected account/mode/profile, then call github_whoami with those actual source scopes; hosted adapter session reuse cannot silently change them.
3. [ ] Both clients use one versioned standalone native MCP implementation independent of Hub, share truthful tool schemas and delegated user authority, and preserve confirmed GitHub App installation, tenant, profile, protected resource, production/money/notification and request-key/replay safeguards on every action.
4. [ ] Client sign-in and callback errors are actionable and safe: an unrecognized or revoked principal, unauthorised installation, stale expired refresh, mismatched state/PKCE, missing mobile surface support or blocked PRODUCTION selection returns a truthful refusal without pretending install status or a green MCP indicator means working access.
5. [ ] Real separate Android/iOS and desktop/web connection acceptance captures exact source/released SHA, true identity/account/mode/profile, observed provider read and independently authorized disposable scratch guarded write/denial, reconnect, refresh, revocation and switching behavior; synthetic OAuth/HTTP tests are preparatory and never counted as real-platform success.
6. [ ] Both GitHub by Robinson AI Systems plugin candidates stay PRIVATE and clearly independently branded; no outside user enrollment, public Directory submission, GitHub App public distribution, live change, spend, or official GitHub connector removal occurs without separate required owner approval and verified completion.

## Execution method

1. Read governing rules, source and actual plugin manifests; document any platform limitations with current official specifications, not assumptions. No cloning of a third-party service or publishing through unofficial directory.
2. Reuse server's genuine GitHub OAuth consent and scoped connection state rather than duplicate provider credentials in Sites. Keep owner protected setup separate from customer OAuth; native desktop and hosted mobile must not leak tenant IDs, passwords or bearer material.
3. Stage and exercise real HTTP/POST/auth code/refresh/PKCE/provider mocks in full source tests and disposable Postgres. For any client software limitations beyond this environment, clearly record the exact missing capability, no false success.
4. Where supported in connected user interfaces, run real mobile and desktop private client tool calls and confirm provider identity/account/mode/profile, preview refuses writes, approved scratch write exact target, readback, revoke. Do not perform unauthorized production changes, public signups, paid operations, destructive cleanup or email/SMS.
5. Reconcile original 57 case queue and dependent data/evidence, run exact-head CI, independent security review, update card evidence, merge only full eligible engineering. If real client acceptance requires user-controlled device sign-in, continue the other work first and request one precise owner action after checked release.

## Dangers

A plugin display name is not account authority; adapter sign-in does not prove GitHub consent; a GitHub App installation being active is not an authorized tenant token; a private connector on Android must never launch only a Codex desktop deep link. No public listing, fake affiliation, tool permission elevation, user-cap override, early release, billable capacity or production DB mutation.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "315a3259faafa474a9b36cc8410c5718d5b9326f",
  "outcome": "Make the PRIVATE Robinson GitHub MCP independently usable through genuinely supported mobile ChatGPT and desktop/web clients with truthful OAuth/connection scopes, preserving standalone authority and two-platform live acceptance as independent mandatory gate.",
  "integrationBoundary": "Current private direct MCP plugin + private ChatGPT-hosted Sites adapter + versioned GitHub MCP OAuth/connection state; Hub discover/connect is optional Hub responsibility. No public listing, paid capacity, unscheduled release, outside-user sign-up or GitHub App distribution.",
  "newEngineering": "Audit both client entry points, update the server/adapter integration so mobile users reach supported sign-in and exact account/mode/profile selection without Codex desktop deep link, validate native desktop OAuth and no-silent-elevation refresh, add focused browser/HTTP/real DB contract tests and clear client-facing setup/correction guidance. Finish with genuine two-client acceptance evidence or leave exact external prerequisite blocked.",
  "estimatedProductionLines": 650,
  "relatedWorkDecision": "One substantial entire PUB-4 connection cross-platform boundary; not a helper PR. Implement all safe in-repo engineering now, but real mobile and desktop acceptance cannot be declared from plugin install, mocked OAuth or source CI. PUB-5 directory eligibility and owner publication remain separately blocked.",
  "subsections": [
    {
      "id": "PUB-4",
      "acceptance": [
        "A supported desktop/web ChatGPT client can establish its own PRIVATE native/direct OAuth MCP connection to the real deployed service, select a verified GitHub identity/account, PREVIEW or independently authorized PRODUCTION, and profile, then call github_whoami and representative authorized provider reads. GitHub's official ChatGPT connector remains separate and untouched.",
        "A real Android/iOS ChatGPT client can establish its own PRIVATE supported hosted/ChatGPT app connection without a Codex desktop-only deep link, obtain genuine service-owned consent and a selected account/mode/profile, then call github_whoami with those actual source scopes; hosted adapter session reuse cannot silently change them.",
        "Both clients use one versioned standalone native MCP implementation independent of Hub, share truthful tool schemas and delegated user authority, and preserve confirmed GitHub App installation, tenant, profile, protected resource, production/money/notification and request-key/replay safeguards on every action.",
        "Client sign-in and callback errors are actionable and safe: an unrecognized or revoked principal, unauthorised installation, stale expired refresh, mismatched state/PKCE, missing mobile surface support or blocked PRODUCTION selection returns a truthful refusal without pretending install status or a green MCP indicator means working access.",
        "Real separate Android/iOS and desktop/web connection acceptance captures exact source/released SHA, true identity/account/mode/profile, observed provider read and independently authorized disposable scratch guarded write/denial, reconnect, refresh, revocation and switching behavior; synthetic OAuth/HTTP tests are preparatory and never counted as real-platform success.",
        "Both GitHub by Robinson AI Systems plugin candidates stay PRIVATE and clearly independently branded; no outside user enrollment, public Directory submission, GitHub App public distribution, live change, spend, or official GitHub connector removal occurs without separate required owner approval and verified completion."
      ],
      "remainingEngineering": [
        "Inspect private plugin manifests, native client specs, installed custom adapter behavior, current deployed OAuth; compare to actual ChatGPT Android and desktop workflows",
        "Implement compatible private supported entrypoints and service-owned user/account/mode/profile chooser without end-user global owner passphrase; preserve existing owner-only admin controls",
        "Prove native MCP authorize/token/client registration + hosted client flows through truthful HTTP/PKCE/refresh/revoke contracts and genuine disposable Postgres, never Hub-owned routing acceptance",
        "Get real private ChatGPT mobile and desktop connections and github_whoami reads/guarded scratch operations verified separately after checked scheduled release; request owner sign-in only for unavoidable human steps",
        "Reconcile STATUS/PLAN/roadmap/owner guide and CI, self-review, merge only after full eligible engineering; do not mark device acceptance passed without actual proof"
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->
