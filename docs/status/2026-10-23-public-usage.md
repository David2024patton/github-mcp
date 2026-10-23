# 2026-10-23 — owner sees public usage (counts only)

Built: read-only "Public usage" section on the owner setup page, summed from each person's existing per-hour call counts. No names or content, no charging.
Verified: real-PostgreSQL test with two people's counts (old hours excluded, no identity leakage) and a setup-page render test; check and CI at the PR.
Next: time-limit check on slow tools; then safety/load-test and data-deletion work before opening to the public.
