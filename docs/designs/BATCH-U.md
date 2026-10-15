# Design — Batch U: Universal tools (every other REST operation and GraphQL)

Status: **APPROVED** (Chris, 2026-10-10). Written 2026-10-10. Scope and acceptance: `docs/PLAN.md` →
Batch U. Cards U-1, U-2. Depends on Batches B and C (and A-4's vendored descriptions).

Hand-built tools cover the common jobs; six universal tools reach **all 1,232 REST operations** of API 2026-03-10 and the
whole GraphQL schema (246 mutations) with the same safety rules — runners, hosted runners, Copilot agents and Spaces,
attestations, migrations, interaction limits, autolinks, issue types, merge queue, anything GitHub adds. In compact mode
they cost nothing until used.

## 0. Verify before starting

| # | Assumption | How to check |
|---|---|---|
| U1 | `vendor/github-openapi/` and `vendor/github-graphql/` match `GITHUB_API_VERSION` and their `SOURCE.md` | `cat vendor/github-openapi/SOURCE.md`; compare with `src/github/client.js` |
| U2 | `octokit.request('VERB /path', params)` sends the pinned version header and goes through throttling, write slots and rate state | `tests/unit/client.test.js` |
| U3 | Every operation in the description has `x-github.category` and `triggersNotification` where relevant | `node -e` count over the vendored file (research §1.1 counted 25 notifying operations) |

## 1. Decisions

**U1. Tools:** `github_api_search(query)` (method, path, summary, and the classification: reads / writes / production /
access-widening / notifies / spends / which credential), `github_api_describe(op)` (parameters trimmed from the description),
`github_api_read(op, params)` (GET; Batch C result rules), `github_api_write(op, params)` (POST/PUT/PATCH/DELETE; `full` profile only;
passes need `allow_writes`), `github_graphql_read(query, variables)`, `github_graphql_write(mutation, variables)` (`full` only).

**U2. Only what GitHub describes.** Every REST request is checked against the vendored description (operation, path and
query parameters, body against the request schema with `ajv`); every GraphQL document is parsed and validated against
the vendored schema, and must contain only queries (`github_graphql_read`) or exactly one mutation field (`github_graphql_write`).
Unknown → refused in words. No guessing.

**U3. `github_api_write` and `github_graphql_write` always need `confirm`** and support `dryRun`; the preview shows the operation in plain
words, the parameters, and the object as it is now when the path or input names one.

**U4. Classification table** (`src/github/operation-classes.js`, generated once from the description then reviewed by
hand in U-1's PR): for every write operation — production (B-2 rules applied to the path: anything under
`/orgs/{org}` except reads, repo settings, tags/releases, protection, rulesets, hooks, keys, environments, Pages, Actions
permissions, runners), access-widening (collaborators, members, memberships, invitations, teams, roles, outside
collaborators, keys, installation repositories, token approvals, secret repository access, visibility, bypass actors),
notifies (`x-github.triggersNotification`), spend (Copilot seats, Codespaces create/start/machine changes, hosted runners
create/update, budgets raise/delete, paid security features, larger runners). **An operation not in the table whose
summary says create, delete, transfer, invite, enable, assign, add, set, update settings, or whose path is under
`/orgs/{org}` or `/enterprises/` is treated as production + access-widening until classified** — the safe default.
GraphQL mutations get the same treatment from a mutation table (`src/github/mutation-classes.js`), unknown mutations
treated as production + access-widening.

**U5. Hand-built tools win.** If a hand-built tool covers the operation or mutation (`src/github/hand-built-map.js`), the
universal tool refuses and names it, so curated checks (merge on green, protection read-merge-write, secret sealing,
spend estimate) are never bypassed.

**U6. Hard refusals:** any request containing `bypass_rules: true`; any secret write (`…/secrets/{name}` PUT) — use
`github_secret_set`; any request whose body contains a token- or key-shaped string; enterprise endpoints unless the account is an
enterprise (not today); App-management endpoints that need the App JWT (`/app/…`) except the reads B-8 uses.

**U7. Guards apply:** production guard, self-protection, project ownership (when the path names a repo/ref), people and
spend guards, change log, request-key replay, read-back when the response has an `id`/`node_id`/`number` (otherwise
`confirmed: null`), undo for labels, topics, archive and simple settings where the before-state was read.

**U8. GraphQL cost.** `github_graphql_read` estimates the query's point cost from the connection `first`/`last` arguments (GitHub's
documented formula) and refuses queries above 500 points or 500,000 nodes, suggesting smaller pages.

## 4. Work units

### U-1 — REST universal tools (L, medium effort)
Files: `src/tools/universal.js`, `src/github/openapi-index.js` (compact index built from the vendored file at build time),
`src/github/operation-classes.js`, `src/github/hand-built-map.js`.
Tests: unknown operation and unknown parameter refused; body validated against the schema; no-confirm changes nothing;
`PUT …/pulls/{n}/merge` refused naming `github_pr_merge`; `merge-async` with `bypass_rules` refused; an unlisted "create"
operation treated as production + access-widening; Copilot seat add counted as spend; production and protection guards
via `github_api_write` (write-contract); request shapes valid for 25 random GET and 10 write operations; `github_api_search "hosted
runner"` and `"interaction limit"` find the right operations.
### U-2 — GraphQL universal tools (M, medium effort)
Files: `src/tools/universal-graphql.js`, `src/github/mutation-classes.js`.
Tests: invalid document refused with GraphQL's message; a mutation in `github_graphql_read` refused; two mutations in one
`github_graphql_write` refused; `mergePullRequest` refused naming `github_pr_merge`; cost estimate refuses a 1,000-point query;
`enqueuePullRequest` (merge queue) treated as production; guards via write-contract.

## 5. Stop-and-ask points

1. U2 false (some route bypasses throttling or the version header): stop; fix the client first.

## 6. Acceptance mapping

| PLAN Batch U line | Evidence |
|---|---|
| Every request validated against GitHub's description/schema | `tests/unit/universal.test.js`, `tests/unit/universal-graphql.test.js` |
| Safe default for unclassified operations | same |
| Same guards as hand-built tools; hand-built tools win | write-contract through `github_api_write`/`github_graphql_write` |

## Amendments

(Dated entries only.)

### 2026-10-15 batch-entry verification

At W source closeout the pinned description still contains 1,232 operations and all have x-github.category. The current triggersNotification count is 24; the U3 research reference to 25 is historical, not an assertion to copy into code. SOURCE commit `58b1e0c00b39b9e46c24dc4a0ba6a2669c90e9c1`, hash and client API version remain pinned. Official API versions and the March 12 release notice corroborate 2026-03-10 support: https://docs.github.com/en/rest/about-the-rest-api/api-versions and https://github.blog/changelog/2026-03-12-rest-api-version-2026-03-10-is-now-available/ . No U tool is implemented or accepted merely by this verification; see U-1's prepared card.
