# 2026-10-23 — Sixth/seventh defect from real-account runs: very large GitHub numbers

Found by creating a real webhook on the public scratch repository and pinging it:
- GitHub's webhook delivery IDs are now larger than JavaScript can hold exactly. The GitHub library hands them back as BigInt, which cannot be saved to the change journal or sent as JSON. `github_webhook_ping` was refused ("The change could not be recorded") and `github_webhook_list_deliveries` failed ("Do not know how to serialize a BigInt").
- Fix: `src/github/client.js` turns every BigInt in a GitHub response into its exact digits (`exactIntegers`). Webhook delivery tools accept `deliveryId` as a number or an exact digit string and compare as text.
- Tests: tests/unit/github-exact-integers.test.js (new), existing H-2 suites still pass.
- Connect screen: now always shows an "add an account" link. Only `robinson-ai-scratch` is enrolled, which is why only it was offered. Steps for adding more accounts are on the owner checklist.
- A test webhook (id 702088174) exists on the public scratch fixture until the lifecycle run finishes and deletes it.
