# 2026-10-23 — Universal delete of a single setting

- Found live: after DELETE /orgs/{org}/interaction-limits GitHub answers an empty object (not 404); the tool reported "unconfirmed" although the setting was gone. Now an empty read-back confirms the removal only when the setting was configured before. Tests in tests/unit/universal.test.js (fail without the fix).
- Live record: unknown-cost write previewed with the billing warning, applied on the scratch org (read-back honestly unconfirmed because GitHub reports expires_at, not the expiry we sent), then removed.
