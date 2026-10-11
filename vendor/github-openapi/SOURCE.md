# Vendored GitHub REST description

GitHub's own OpenAPI 3.0 description of the REST API at the pinned API version. It is data: never edit it by hand;
move the version only in its own card (BATCH-A A7). Query it with `node scripts/openapi-find.mjs "<words>"`.

| Field | Value |
|---|---|
| File | `api.github.com.2026-03-10.json` |
| Upstream | https://github.com/github/rest-api-description, `descriptions/api.github.com/api.github.com.2026-03-10.json` |
| Commit | `58b1e0c00b39b9e46c24dc4a0ba6a2669c90e9c1` (committed 2026-10-10T04:40:59Z) |
| API version | `2026-03-10` (`info.version` 1.1.4, OpenAPI 3.0.3) |
| sha256 | `2b61199d1392557ed8eef0d5dd1a2047ae488b9c8a2562bb214f2fb66c72b376` |
| Fetched | 2026-10-10 |
| Size | 12,905,003 bytes, 816 paths, 1,232 operations |

The response examples in this file contain example token- and key-shaped strings written by GitHub. The secret scan
skips this one file (see `scripts/check-secrets.mjs`, `VENDORED_DATA`); `tests/unit/vendor.test.js` checks the sha256.
