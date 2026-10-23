Owner-authorized early manual release (2026-10-22, authorization valid until 06:00 MST 2026-10-23), used once because 98 commits of finished work (App JWT, SCIM, private
sign-in, org governance) could not be tested on the deployed server otherwise.
- Candidate: main 31f490e24d36ea51cceb659d861de6d2beb0afaa, all required checks green at that exact head (ci, unit, db, shapes, rtc, check, release-policy).
- Method: fast-forward of `live` (473aa9b -> 31f490e, ancestry checked, no force). Vercel production deployment dpl_EhY4EaoZUcZHkApLaYmNX51YNVMn built from that SHA and reached READY.
- Daily job: it will see live already at main and publish nothing new unless more is merged.
Observations on the new deployment, scratch organization, reads only (no queue row closed by this note): App owner identity (app 5281951), App installation list (1, all
repositories, no suspension, permissions listed), installation grants (cached permissions match GitHub's), pending installation requests (none), App webhook configuration
(host and TLS only, no secret), App webhook deliveries (none). All through the owner's connected server in PRODUCTION mode; no writes.
