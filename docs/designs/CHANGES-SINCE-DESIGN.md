# Changes since design

Dated entries only: contract changes (signatures, tables, guard behavior, defaults) that later cards inherit and that
are not yet in their design. A card consuming an entry says so; batch close-out (DRIFT-PROTOCOL C) retires consumed entries.

- **2026-10-10 (A-3b, #9) — for B-1 and every tool card:** tools receive the frozen **connection** `{ client_id, default_account,
  accounts, mode, profile, listing }` (snake_case). `createMcpHandler` takes `dispatch({ registry, name, args, connection, db })`;
  the default `denyAll` refuses every call, so **B-1 supplies the guarded dispatcher** (profile filter, `defineWrite`, result shaping)
  and `api/mcp.js` passes it in. `getDb()` (`src/runtime.js`) is the shared, schema-ready database. A-5 adds the setup page beside
  `api/oauth/*` and the `TOKEN_ENCRYPTION_KEY` variable. The authorize form posts accounts as `acct:<login>=on`.
- **2026-10-10 (A-4, #10) — for A-5 and every tool card:** GitHub is reached only through `githubFor(ctx, { owner, cred, scope })` where
  `ctx = { connection, db, credentials, fetch?, now?, sleep?, budgetMs? }`. **A-5 supplies `ctx.credentials.token({ account, cred, scope })`**
  (returns the token string; installation tokens cached and downscoped there). Errors it raises itself are `GithubClientError` with `code`
  `outside_scope`, `no_credentials` or `rate_limited` (`details.reset_display` is Denver time); B-5 turns them into tool results. A polled read
  passes `request: { etag: true }`. A write never retries inside the client; `defineWrite` (B-1) owns the request-key lookup using `requestKey(ctx, tool, args)`.
  Tests that use the fake GitHub get validation for free and must assert `gh.invalid` is empty. Find an operation with `node scripts/openapi-find.mjs`.
