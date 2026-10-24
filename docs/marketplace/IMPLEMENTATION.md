# Marketplace customer lifecycle

Approved by the owner 2026-10-24. This is a separate enrollment source, not a replacement for direct MCP.

Outcome: a verified free Marketplace subscription can authorize a dedicated MCP connection. A signed cancellation blocks that connection immediately, revokes only its provider token, and deletes its isolated customer data. Independent direct connections keep their own tenant and grants.

Acceptance: purchase/subscription readback, account-authority verification, isolated OAuth/MCP resource and tenant, signed/invalid/replayed/out-of-order events, cancellation during sign-in/refresh, provider revocation failures with durable retry, deletion readback, and direct-connection survival. No paid plan or global App-grant revocation.

The Marketplace MCP resource is `/api/marketplace/mcp?account=<numeric GitHub billing account>`. OAuth uses the existing issuer and S256 flow, with the exact resource bound to the resulting tenant. The installation return page resolves the installed account server-side and provides this address. The account number is a selector only; GitHub subscription and administrator authority are independently verified before enrollment.

Each `(GitHub identity, Marketplace billing account)` owns a separate tenant. Root mapping rows bind these tenants to the subscription. Cancellation blocks all mapped tenants atomically before cleanup begins; token and MCP routes also check current subscription status. It does not uninstall the App or revoke the user's global App grant.

Signing secret and cron authorization are operator-enrolled secrets, never tool arguments/results. Provider errors and webhook bodies are never logged. Cleanup retries through a protected scheduled route; failure remains visible and must not be presented as completed deletion.

Contracts: GitHub Marketplace purchase/cancellation documentation and REST `DELETE /applications/{client_id}/token`. Free plans are included; existing direct-MCP policy remains unchanged.

Operational limits: cleanup processes at most two customers and two provider tokens per customer per invocation, with 10-second provider timeouts and durable progress after each successful revocation. Old failed customers rotate behind other pending customers. An in-flight refresh lease delays deletion until its replacement token is safely stored. The scheduled endpoint requires `CRON_SECRET`, retries hourly, and returns 503 while work fails or remains. Operator monitoring and real cancellation readback are required before publication. After cleanup, account IDs and subscriptions are removed. A keyed account digest, status/effective-date watermark and hashed delivery receipts prevent delayed purchase events from reactivating cancellation; this minimal anti-replay retention must be reflected in the approved privacy statement.

Hub compatibility reference reviewed: main `docs/HUB-CONNECTION-SPEC.md` blob `859db7e036d36c1f3f652b36218beb13f46a784a` on 2026-10-24. Existing direct `/api/mcp`, RTC1 and issuer remain independent. The additional Marketplace resource requires its own exact resource in authorization and token exchange and cannot use a direct tenant token.
