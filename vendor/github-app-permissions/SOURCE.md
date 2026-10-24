# Vendored GitHub token-type lists

GitHub's own published lists of which REST operations each kind of token can call, at the pinned API version. It is data: never edit it by
hand; regenerate it with `node scripts/vendor-app-permissions.mjs` (instructions at the top of that script) and move it only in its own card.
Query it through `src/github/credential-derivation.js`; never read this JSON whole.

| Field | Value |
|---|---|
| File | `fpt-2026-03-10.json` |
| Upstream | https://github.com/github/docs, `src/github-apps/data/fpt-2026-03-10/` (the same data that builds GitHub's "Endpoints available for ..." pages) |
| Commit | `02c25d16369fe27f9bdb28d1201f6b452f0d21dd` (committed 2026-10-23T13:35:27-07:00) |
| Operations | 1,123 (those in at least one of the three lists) |

Meaning: an operation listed under `i`, `u` or `f` is documented by GitHub for installation tokens, App user tokens or fine-grained personal access
tokens, with the permissions GitHub lists. An operation missing from a list is not in GitHub's list for that token type. The file says nothing about
classic tokens or OAuth apps; those come from each operation's own text in the pinned REST description.
