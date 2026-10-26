# CONTRIB-2 — No signed download bearer links in model-visible results

**Owner decision 2026-10-26:** David2024patton's PR #401 and #405 raise a genuine issue: GitHub redirect Location headers may contain short-lived access grants. His default-only redaction can still return the complete secret-bearing URL under detail:full. We, the maintainers, implement a complete solution without asking the outside author to fix his branch.

## Drift check
- Current `github_content_get_archive_link`, `github_artifact_get_link` and `github_account_export_link` return redirected download URLs verbatim to the AI.
- Secret-value tools are forbidden by AGENTS.md and docs/AI-PR-READ-FIRST.md. Download access query/fragment can be bearer material despite no recognizable ghp_ token prefix.
- The official provider may redirect to unrelated file-storage hosts; a bare redirect path is not necessarily a safe/usable human download.
- Existing queryless links from known GitHub web/archive origins are useful and can remain functional; all other redirected addresses are withheld from AI output.
- The product must not claim an omitted signed download is directly usable. Provide a human-safe GitHub navigation URL and actionable explanation; no new login, storage or generated bearer token.

## Acceptance (committed before source)
1. Add one side-effect-free helper to validate GitHub redirect URLs and return a public, *allowlisted known provider-host, HTTPS, queryless* URL only when safe. If the redirect has a query, fragment, URL credentials, unknown host or embedded authorization, **never expose any part of that redirected URL** as a model result, including under `detail:full`, `fields`, compact listing, metadata or stored-result handles. Return `url: null`, `sensitive_redirect_omitted: true` and a fixed safe human-navigation link in a separate field.
2. Apply to all three affected read tools (archive, Actions artifact and account export). Preserve existing descriptive metadata and truthful notes; never log raw redirect values or put them in thrown errors or change logs. Missing location still produces a generic error without provider body.
3. Validate the helper against URL query, fragment, encoded credentials, non-HTTPS, unexpected origin and clean queryless codeload; test all three tools in default/full modes via actual dispatcher with fake GitHub redirect containing a unique secret marker. Every result shape must omit it. Do not skip/relax old tests: update expectations explicitly where the previous test wrongly expected the secret-bearing link.
4. Maintain the existing tools, grants, tenant isolation, reader profiles and browser/RTC contracts. No additional DB tables or credential paths. Update catalogue wording, dated decision and a standalone status note.
5. Green exact-head `ci` and `release-policy`, resolved reviews, merge through the repo's PR conveyor; ONLY THEN explain and close David's #401 and #405 as safely superseded. A richer human-only authenticated download handoff, if needed, is future planned work, not a hidden insecure `detail:full` escape hatch.

**No deployment, spending, protected-branch override or release**; scheduled live promotion remains separate. The current #409 CI-approval PR is independent of this bundle.
