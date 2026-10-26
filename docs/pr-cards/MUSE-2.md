# MUSE-2 — public Muse OAuth onboarding (2026-10-26)

**Owner requested:** public, per-person Muse connection with each person's own GitHub sign-in; no owner credentials, password, access token or manually obtained OAuth secrets. Build on the existing PUB-6 self-service tenant flow. This outcome fixes client registration, browser authorization, code/refresh token exchange and public setup instructions together.

## Acceptance and verification

- [ ] OAuth discovery offers `none` as well as `client_secret_post`; RFC 7591 registration accepts public clients with no secret, persists their method, and keeps existing confidential registration intact.
- [ ] Public OAuth authorization and token/refresh accept omitted `resource` only as the canonical MCP resource; a supplied different audience fails. S256 PKCE and exact registered redirect matching stay mandatory.
- [ ] Secretless public clients redeem authorization codes only with a valid one-use PKCE verifier, can refresh only their own connection, and never gain access to another person's tenant, identity or OAuth client. Confidential clients still require their secret.
- [ ] Muse Android's observed manual-client-ID fallback has a public, reusable **nonsecret** client ID with only the verified `https://agent.meta.ai/api/hatch/oauth/callback` redirect. Users leave Client Secret blank; GitHub account authorization stays per person. Automatic DCR works for clients that support it.
- [ ] Tests exercise both client methods, PKCE, missing/wrong resource, cross-client failure, confidential regression, public-tenant storage and public Muse setup copy; run exact-head CI, browser and database suites before merge.
- [ ] Update public homepage, user setup guidance, roadmap/status and owner acceptance checklist. Real Muse Android client connection and deployed revision remain separately pending until tested; never claim Meta approval.

## Boundaries

No new GitHub OAuth App, owner token sharing, production sign-in without GitHub consent, new credentials in chat, permission expansion, secret logging or bypass of the existing GitHub/public-tenant guards. All changes through a reviewed PR to main; regular checked live release policy continues.

**External observations:** Muse Android screenshots show Client ID/Secret fields; independent September 2026 Muse connection test (thetangstr/agentdash #674) observed pre-registered client ID, no DCR. Engram's October 2026 Muse setup guide records callback `https://agent.meta.ai/api/hatch/oauth/callback` and secretless `none` method. These are integration hints, **not proof of acceptance** on this service.
