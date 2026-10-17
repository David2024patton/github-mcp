# W-7 genuine billed-usage envelope correction — October 17, 2026

## Drift check A
On actual provider-ready live `d49aebd6b13365401a8a863876b4a3151b7fa910`, the standalone custom GitHub MCP `github_billing_get_usage({owner:'robinson-ai-scratch',scope:'organization',year:2026,month:10,day:15,summary:true})` returned `{owner,scope,year,month,usage:{items:[],complete:true,total_net_dollars:0,note:null}}` (zero verified cost) from a real GitHub-billed endpoint. Meanwhile, `github_workflow_weekly_digest` invoked this *same* supported reader for all seven exact UTC days, but reported `billing-shape:not_readable` for each day, with false `unknown` amounts. Inspection of `src/tools/workflows-find.js` line 108 confirmed it reads `cost.complete/cost.items` while source `src/tools/billing-read.js` returns `cost.usage.complete/cost.usage.items`; old unit fixtures incorrectly modeled the flat response. This is a **source/consumer contract bug**, not a GitHub entitlement, new feature, or missing owner business decision.

| Authority | Observed implementation | Required repair |
| --- | --- | --- |
| Real provider read tool | Top-level identity/scope/year/month; nested `usage` with `items`, `complete`, `total_net_dollars` | Consume exactly this envelope and recheck requested actor/date |
| Existing weekly digest | Reads top-level `cost.items/cost.complete`, guaranteed never true for real reads | Correct to nested and retain strict complete/day/amount validation |
| Existing W-7 tests | Fake `github_billing_get_usage` returns invented flat rows | Use actual production reader shape for empty, priced, and failure fixtures |
| Safety | No bill guessed, no mutations; incorrect unknown rather than fake 0 | Preserve unknown for absent/capped/foreign/wrong-date/invalid charges; permit exact $0 only when source is complete |

## Acceptance and immutable plan
Original W-7 source requirements remain from `docs/pr-cards/W-7.md`, and existing acceptance queue `GITHUB-W7-DIGEST` remains **PENDING** until a released, legitimately full real-provider check. This is one below-volume corrective engineering outcome; no additional roadmap subsection or duplicate original credit. Source handler, tests, documentation, guard and accounting are reviewed together.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "89bbfbf6b3a35673e43fcf05cfd631d5484e2df0",
  "outcome": "Repair the approved W-7 weekly digest's real GitHub billed-usage integration: existing provider reader returns nested usage.items/complete, but digest mistakenly expects flat top-level fields, rendering ALL real days unknown despite complete zero-dollar responses.",
  "integrationBoundary": "github_billing_get_usage guarded read result -> github_workflow_weekly_digest source adapter in src/tools/workflows-find.js -> honest per-day scoped costs, Denver window and partial/unknown handling -> realistic tests in tests/unit/workflows-discovery.test.js; no new provider, account access or tool.",
  "newEngineering": "Use actual nested provider payload, validate read-account identity/scope/date/complete and financial line amounts, preserve zero-dollar complete days, reject mismatched/truncated/unreadable daily usage, replace misleading flat test fixture with real wrapped response. Do not mutate GitHub.",
  "estimatedProductionLines": 40,
  "relatedWorkDecision": "Original W-7 delivered and merged; this is new corrective engineering proven by real live custom service call 2026-10-17, not re-credit of original planned W-7 subsection. Other W-7 digest real acceptance still needs exact released source/plan eligibility and legitimately readable security inventories. Zero development spending, no production permissions, notification or release.",
  "subsections": [
    {
      "id": "W-7",
      "acceptance": [
        "Build github_workflow_new_repo idempotently: private by default, main, required named check default ci, block force-push/deletion, merge commits only and delete-on-merge.",
        "Enable public/free eligible secret scanning and push protection; report legitimate private-plan limits, enable Dependabot alerts, read-only Actions default tokens, fork-PR approval for all outside contributors and standard labels.",
        "Build github_workflow_find across PRs, issues, runs, releases and commits with mixed-object summaries and explicit paging/partial coverage.",
        "Build github_workflow_weekly_digest across enrolled accounts for seven-day merged PRs, CI failure rates, open alerts, actual Actions/Copilot billed spend and pending invitations, with dollars and Denver dates.",
        "Use existing registry tools and durable desired-state recovery; no direct provider call in workflow, no implicit scope/production/access/notification/spend authorization.",
        "Prove normal, empty, idempotent/two-page/capped, time-budget, denied scope/profile, preview, failed or uncertain child steps, real writer readback and no unasked writes."
      ],
      "remainingEngineering": [
        "Replace flat billing rows in weekly digest with actual billingUsage.usage nested result: all previously successful real day reads must not falsely become unknown, and confirmed missing/incomplete/wrong-date/inconsistent provider data must never become fake $0.",
        "Update W-7 test fixtures to match actual github_billing_get_usage contract, preserving daily UTC/DST, category split, incomplete and replay-independent no-write checks; add provider response-shape and identity/bounds regressions.",
        "Pass exact-head check, unit shards, RTC, DB, shapes, release policy and independent review, merge only on green; live acceptance deferred to next checked READY release."
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->

No local GitHub checkout possible in this connector-only context; rely on actual mandatory exact-head GitHub Actions and code self-review. No off-schedule release or billing mutation is authorized.
