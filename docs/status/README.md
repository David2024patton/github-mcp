# Status notes (one file per PR)

`docs/STATUS.md` is a long running ledger; every PR that edited its top line caused a merge conflict with the next one.
From 2026-10-22 a PR records its status as its **own file** here instead:

`docs/status/YYYY-MM-DD-<short-topic>.md` — a few lines: what merged or changed, branch/PR/head SHA if in progress,
what is blocked, what is next. The docs-drift check accepts any file in this folder in place of an edit to `docs/STATUS.md`.
Newest first when read with `ls -r docs/status`. Fold old notes into STATUS.md occasionally in a dedicated tidy-up only.
