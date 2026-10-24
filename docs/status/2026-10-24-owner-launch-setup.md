# Owner launch setup — 2026-10-24

Scope: the owner's Vercel exemption, website connect button, MCP Registry listing, GitHub App ownership/Marketplace setup, and hosting spend alerts. The owner explicitly paused Marketplace publication while other agents make fixes. No Marketplace publication or plan activation is authorized until that hold is lifted.

## Verified external setup

- Production `PUBLIC_UNLIMITED_SUBJECTS` is `227716942`; it was saved before the verified READY production redeploy. No secret values were read or disclosed.
- The public company website serves the GitHub connection guide/button at `https://www.robinsonaisystems.com/tools/github`.
- Official MCP Registry: `com.robinsonaisystems/github`, version `0.1.0`, active; remote URL matches `server.json`.
- Vercel has an active $200 team budget, with alerts at 50%, 75%, and 100%. Existing budget and pause settings were preserved.
- Neon organization billing shows an enabled $20 email spending notification; checked after the owner signed in.
- GitHub confirms the public `robinson-github-mcp` App was successfully transferred from scratch to Robinson-AI-Systems. Its public URL and registration identity were retained.
- Post-installation Setup URL was saved as `https://github.robinsonaisystems.com/api/github/setup`; both existing callback URLs were preserved.
- A repository read through GitHub by Robinson AI Systems succeeded after transfer. It is the owner's requested default GitHub connector.
- The publisher organization's public email is `hello@robinsonaisystems.com`, matching the company website; the custom connector independently read back the change.

## Marketplace draft and publication hold

Draft: `https://github.com/marketplace/robinson-mcp-for-github/edit`.

The draft has business contact information, naming/categories/product links, introductory and detailed descriptions, the existing company logo, product screenshots, and a Free draft plan. This is preparation, not Marketplace publication. The free plan has not been activated, no agreement was accepted, and no publish request was sent. Re-read the dashboard before submission; do not assume every section is complete.

GitHub's security/compliance form returned its own server-error page on save and on refresh. Trader self-certification was deliberately left undecided; no legal classification or independent certification was invented. Legal pages remain DRAFT. The owner must approve the applicable declarations/agreement at publication time.

### Engineering prerequisite found while configuring the Marketplace webhook

The existing `src/github/webhook.js` handles only `ping`, `installation`, `installation_repositories`, and `github_app_authorization`. It verifies a per-App secret selected by the App installation-target header. It is not a Marketplace purchase handler; do not point the Marketplace form at it and claim acceptance.

GitHub's current requirements apply to free plans too: new-purchase and cancellation events must be processed. Before submission, implement or verify a dedicated authenticated `marketplace_purchase` route with a separately and securely enrolled signing secret; validate the actual Marketplace header/payload contract, delivery deduplication, purchased/cancelled behavior for a free service, and invalid-signature/replay cases. Preserve independent direct-MCP connections: cancelling a free Marketplace subscription must not silently revoke separately authorized direct connections without an approved product rule. Configure the Marketplace hook only after its route and secret exist, then prove a signed delivery and readback. Do not retrieve or print the existing App secret.

References:
- https://docs.github.com/en/apps/github-marketplace/creating-apps-for-github-marketplace/requirements-for-listing-an-app
- https://docs.github.com/en/apps/github-marketplace/listing-an-app-on-github-marketplace/setting-pricing-plans-for-your-listing
- https://docs.github.com/en/apps/github-marketplace/listing-an-app-on-github-marketplace/configuring-a-webhook-to-notify-you-of-plan-changes

Next: finish the Marketplace-only webhook prerequisite in the normal reviewed implementation flow, reconcile the draft's remaining fields, obtain the owner's legal declarations and explicit removal of the publication hold, then activate the Free plan and submit for GitHub review. No new release was triggered by this handoff.
