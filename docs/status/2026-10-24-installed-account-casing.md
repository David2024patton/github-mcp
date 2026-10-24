# Installed organization reconciliation — 2026-10-24

Owner reported App installation complete and authorized finishing launch. PRs #383 and #387 are now merged. Independently verified Vercel production READY, canonical alias assigned, and live at main 9372a4f.

Live My connection sign-in failed with duplicate key on gh_accounts_account_id_key. A master-token extra place retained mixed capitalization; installation enrollment lowercased the name and tried inserting a second row with the same immutable GitHub account ID. Fix: reuse the existing case-insensitive account's exact row key after checking its immutable ID, then upgrade its credentials/installation in place. Existing connector scopes and keys are preserved. A name with a different account ID fails closed.

Acceptance: disposable database regression starts with a personal connection, adds a mixed-case organization extra place, installs the fake App, signs in to My connection, and verifies one installed organization row, preserved key, no duplicate extra place and the original connector still valid. Real sign-in must be repeated after checked release. No real credential is used in tests.

Marketplace still awaits private webhook/cron secrets, actual free-plan ID, publisher verification, trader classification and legal agreement. No activation or submission is claimed. Publication hold is lifted.
