# 2026-10-24 — sign-in failed with "This step has expired" after installing the App on an organization

- Cause (from the live refusal log): the organization was already stored as an extra place (master token) as "Robinson-AI-Systems"; connecting through the App saved it again lower-case, and the database refused the second row for the same GitHub account number (`gh_accounts_account_id_key`). The page reported it as an expired step.
- Fix: `upsertAccount` updates the existing row in place when the same account number is already stored with different capital letters (the row becomes an App connection and keeps its stored spelling). A genuinely different name for the same number is still refused (existing contract test).
- Tests: tests/db/credentials.test.js (new case), contract test unchanged and passing, pub-6 connect/approve db tests pass.
- Next: Chris signs in again from the connector; confirm the organization shows "App installed".
