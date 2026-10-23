# 2026-10-23: Enterprise trial results (scratch organization)

Merged: nothing new. This is a docs-only note.

Verified live on robinson-ai-scratch (Enterprise trial), all with cleanup and readback:
- Plan reads `enterprise`; budgets list returns four $0 budgets with usage blocked.
- Ruleset created with enforcement `evaluate`, accepted, then deleted (absence confirmed).
- Classic branch protection set on a private organization repo, read back, then removed.

Not working, and not a plan limit: new budget create (404 for copilot and models) and Codespaces org access (404). Chris decided this is sufficient (2026-10-23).

Waiting on a release (main is ahead of live with #301, #302, #303): retest protection with required checks (christcr2012 Pro fixture), confirm webhook ping/redeliver report confirmed, then delete the fixture repo christcr2012/rtc-pro-accept-oct23.

Next: after the daily release, run the retests above.
