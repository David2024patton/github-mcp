# Vendored GitHub GraphQL schema

GitHub's public GraphQL schema (SDL) for github.com. It is data: never edit it by hand. Query it with
`node scripts/graphql-find.mjs <name>`. GraphQL has no dated versions; the commit below is the version we pinned.

| Field | Value |
|---|---|
| File | `schema.docs.graphql` |
| Upstream | https://github.com/github/docs, `src/graphql/data/fpt/schema.docs.graphql` |
| Commit | `be38ec5d78e24172587e61b3c6ff40ace1865c71` (committed 2026-10-09T07:41:29-07:00) |
| sha256 | `3ed095654b22b1a8e7a88af36af2b28cb6d9613da332e9c57303e30476958d42` |
| Fetched | 2026-10-10 |
| Size | 1,562,177 bytes |

The secret scan skips this one file (see `scripts/check-secrets.mjs`, `VENDORED_DATA`); `tests/unit/vendor.test.js`
checks the sha256.
