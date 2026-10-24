# Owner-approved Marketplace lifecycle

Approved 2026-10-24; scope is the existing owner launch checklist's Marketplace submission.
Outcome and acceptance: `docs/marketplace/IMPLEMENTATION.md`.

Source outcome: one customer workflow covering signed purchase, provider subscription/admin verification, dedicated connection, cancellation blocking, scoped token revocation and isolated data removal with durable retries. Activation remains separate from implementation and requires honest provider acceptance and completed legal inputs.

Validation: focused unit/resource and integrated disposable-Postgres purchase/cancellation tests; existing public connect regression suite; full check, unit, shapes and CI at the final head. Do not claim real-account acceptance from fake-provider tests.
