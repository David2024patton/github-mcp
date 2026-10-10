# Designs

One file per batch. A design is the semantic contract: decisions (made, not "consider"), schema, shared primitives,
work units, stop-and-ask points and acceptance mapping. Cards implement from it; cards may fix mechanical details but
never silently change a decision. Changes are dated entries under "Amendments". Contract changes later batches inherit
go in `CHANGES-SINCE-DESIGN.md`. New designs start from `TEMPLATE.md`.

| Batch | File | Status |
|---|---|---|
| A Foundation (login, GitHub App credentials, client) | [BATCH-A](BATCH-A.md) | Draft 2026-10-10 — awaiting IN-00 |
| B Trust layer (writes, production guard, self-protection, people and spend guards) | [BATCH-B](BATCH-B.md) | Draft 2026-10-10 — awaiting IN-00 |
| C Cheap on context | [BATCH-C](BATCH-C.md) | Draft 2026-10-10 — awaiting IN-00 |
| D Repositories, code, branches and tags | [BATCH-D](BATCH-D.md) | Draft 2026-10-10 — awaiting IN-00 |
| E Pull requests, merges, stacks, reviews | [BATCH-E](BATCH-E.md) | Draft 2026-10-10 — awaiting IN-00 |
| G CI and delivery (Actions, checks, secrets, environments, releases, Pages) | [BATCH-G](BATCH-G.md) | Draft 2026-10-10 — awaiting IN-00 |
| V Developer tools (preview only) | [BATCH-V](BATCH-V.md) | Draft 2026-10-10 — awaiting IN-00 |
| F Issues, labels, discussions, projects, search | [BATCH-F](BATCH-F.md) | Draft 2026-10-10 — awaiting IN-00 |
| H Governance and security (protection, rulesets, webhooks, access, alerts) | [BATCH-H](BATCH-H.md) | Draft 2026-10-10 — awaiting IN-00 |
| O Owner and administration | [BATCH-O](BATCH-O.md) | Draft 2026-10-10 — awaiting IN-00 |
| P Project profiles | [BATCH-P](BATCH-P.md) | Draft 2026-10-10 — awaiting IN-00 |
| W Workflows | [BATCH-W](BATCH-W.md) | Draft 2026-10-10 — awaiting IN-00 |
| U Universal tools (REST + GraphQL) | [BATCH-U](BATCH-U.md) | Draft 2026-10-10 — awaiting IN-00 |
| R Hub-ready doors (RTC 1) | [BATCH-R](BATCH-R.md) | Draft 2026-10-10 — awaiting IN-00 |
| X Undo, smoke test, toolkit decision | [BATCH-X](BATCH-X.md) | Draft 2026-10-10 — awaiting IN-00 |

Letters follow the Stripe MCP where the meaning is the same (A, B, C, V, P, W, U, R, X); D–H and O are this server's
area and owner batches. There is no Batch I–N.
