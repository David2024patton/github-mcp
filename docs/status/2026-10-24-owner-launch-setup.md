# Owner launch setup — 2026-10-24

The owner clarified that “finish the work” lifted the earlier Marketplace publication hold. Publication is authorized, subject to GitHub's technical requirements and action-time confirmation of legal agreements. Do not ask the owner to lift the hold again.

## Verified external setup

- Production `PUBLIC_UNLIMITED_SUBJECTS=227716942` was saved before the verified READY production redeploy. No secret values were disclosed.
- The company website serves the connection guide/button at https://www.robinsonaisystems.com/tools/github.
- Official MCP Registry `com.robinsonaisystems/github`, version `0.1.0`, is active and matches `server.json`.
- Vercel has an active $200 team budget with alerts at 50%, 75%, and 100%; existing pause settings were preserved.
- Neon billing shows an enabled $20 email spending notification, verified after owner sign-in.
- GitHub confirmed transfer of the public `robinson-github-mcp` App from scratch to Robinson-AI-Systems; its registration identity and public URL were retained.
- Setup URL is https://github.robinsonaisystems.com/api/github/setup; both existing callback URLs remain unchanged.
- A repository read through GitHub by Robinson AI Systems succeeded after transfer. It is the owner's default GitHub connector.
- Public publisher email is hello@robinsonaisystems.com, matching the company website. The connector independently read back the change. GitHub's verification email was requested; dashboard still shows verification pending.

## Marketplace submission progress

Draft: https://github.com/marketplace/robinson-mcp-for-github/edit.

Contact information and listing description are marked complete by GitHub. Saved content includes product links, introductory/detailed descriptions, existing company logo, branded background and two captioned product screenshots. GitHub has now confirmed “Your plan has been published” for the Free plan; plans/pricing is marked complete. The overall listing is still a draft: no Developer Agreement was accepted and no publish request was sent.

Security/compliance returned a server-error page on the earlier save; its form is accessible again after the ownership transfer, but the fields were not persisted. Trader self-certification remains undecided; no legal classification or certification was invented. Trust pages remain DRAFT. Owner confirmation of applicable declarations and action-time agreement acceptance remain necessary.

## Marketplace engineering prerequisite (not solved by the listing pack)

`src/github/webhook.js` handles only ping, installation, installation_repositories and github_app_authorization. It verifies the per-App signing secret selected by the App installation-target header. It is not a Marketplace purchase handler. Do not configure the Marketplace form to use it and claim acceptance.

Verified GitHub requirements apply even to a free plan:
- Purchase flow: after OAuth, provision the customer and verify the subscription via GET /user/marketplace_purchases.
- Cancellation: deactivate the Marketplace customer, revoke the relevant OAuth authorization, and remove customer data within 30 days.
- Handle marketplace_purchase through a verified-signature endpoint with durable delivery deduplication, meaningful purchased/cancelled behavior, and denial/replay/recovery tests. Merely logging receipts is insufficient.

Current direct-MCP identity/grant storage is shared. Marketplace lifecycle/provenance must be isolated so cancellation does not revoke or erase unrelated direct ChatGPT/Claude connections. This adds customer-lifecycle product work beyond PUB-5's original listing-pack scope; obtain the owner's scope/design decision before treating this as routine form completion. Secrets remain encrypted/server-owned; never read or print the App signing secret.

Primary references, checked 2026-10-24:
- https://docs.github.com/en/apps/github-marketplace/creating-apps-for-github-marketplace/requirements-for-listing-an-app
- https://docs.github.com/en/apps/github-marketplace/using-the-github-marketplace-api-in-your-app/handling-new-purchases-and-free-trials
- https://docs.github.com/en/apps/github-marketplace/using-the-github-marketplace-api-in-your-app/handling-plan-cancellations

PR #383 passed ci and release-policy at its original head. Merge was refused because main requires the App identity and this connector has no App installation for Robinson-AI-Systems. No branch-rule override or manual installation was attempted; preserve the owner's requirement to test installation through initial sign-in. The publication hold is lifted; the merge/technical/legal prerequisites are separate. No extra release was triggered.
