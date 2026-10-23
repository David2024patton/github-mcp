# 2026-10-23 — Sign-in refused when Claude asked for the advertised permission

Chris's first real sign-in from Claude ended on "Could not connect". Cause (found by reading the code, not yet re-tested live): Claude asks for the permission name the server lists in its discovery document (`github.notifications.read`), and the public sign-in refused any permission name. Fix: the public sign-in now accepts that advertised name (and none), and still refuses anything else. It gives no extra power.
Next: release to `live`, then Chris retries the connector.
