# MUSE-1 — Meta Muse and Muse Code interoperability

**Approved:** Owner request, 2026-10-26. **Scope:** this GitHub MCP repository and its public service homepage only. **Stage:** in progress; external Meta-client acceptance pending.

## Observable outcome

A person opening `https://github.robinsonaisystems.com` sees correct, usable connection instructions for Meta Muse (personal assistant) and Meta Muse Code, using the same secure hosted `/api/mcp` service, without copying tokens into a chat or bypassing authorization. Muse Code interoperates with standards-based Streamable HTTP and OAuth 2.1; the consumer Muse custom-connector path is presented truthfully as platform-dependent, not as an already-approved catalog integration.

## Acceptance criteria

- [x] The home page explains the difference between consumer Muse custom connectors and Muse Code native MCP, with the exact HTTPS service endpoint and a usable `mcp_servers` settings example, `muse mcp login` and `/mcp`.
- [x] Consumer Muse instructions give a safe custom-connector request, browser-based authorization and an honest fallback if Muse cannot create an MCP-backed connector. No promise that Meta has reviewed, listed or approved the service.
- [x] The existing Streamable HTTP / OAuth stack remains the single integration path: no special Muse bypass, no credential prompt in chat, no client-specific grant escalation. The documented URL matches the deployed endpoint.
- [ ] Automated tests assert the new website content, configuration format, no embedded bearer or custom script, and phone-compatible HTML alongside existing browser checks. Run the full repo checks / browser CI for the candidate SHA.
- [ ] Update the public setup guide, roadmap/status/owner guide as applicable; open one PR, self-review, and merge only after exact-head `ci` and `release-policy` green.

## Source references

Meta's primary sources (read 2026-10-26):
- Muse Code: https://dev.meta.ai/docs/muse-code/extending (native `streamable_http`, settings, `muse mcp login`).
- Consumer Muse: https://about.fb.com/news/2026/09/introducing-muse-small-business/ (custom connectors).
- Muse Connector Platform: https://platform.muse.ai/docs (review, tools and OAuth approval).
- Muse Code config: https://dev.meta.ai/docs/muse-code/configuration.

## Boundaries and external acceptance

No new endpoint, token vault, Meta credentials, production writes, publication, or manual deployment. Consumer Muse's own custom connector generation and Meta's platform submission/review cannot be asserted working from source or CI: a real Muse account must complete those client-side acceptance steps. Existing App installation and OAuth setup is reused without widening privileges. The site's change reaches production only through the repository's established checked `live` release policy.
