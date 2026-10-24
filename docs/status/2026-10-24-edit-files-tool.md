# 2026-10-24 — fast edit tool (`github_content_edit_files`)

Chris asked why the custom tool had no fast way to change a few lines. Added `github_content_edit_files`: send
find-and-replace edits per file (text must match exactly once unless `all: true`); the server reads each file at the
branch head, applies the edits, and makes one signed commit with the head it read (or `expectedHead`). Nothing is
changed if any edit is missing or ambiguous. Same guards as `github_content_push_files` (named branch, protected/default
branch rules, preview then confirm, outside-project check).

- Tests: `tests/unit/code-write.test.js` (write contract + 4 extra tests), `tests/unit/registry.test.js`.
- Not done: standard-patch (diff) input; live try on a scratch repo after release.
- Next: open PR, CI, merge (needs Chris's click or the App on the org).
