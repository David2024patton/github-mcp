# Changes since design

Dated entries only: contract changes (signatures, tables, guard behavior, defaults) that later cards inherit and that
are not yet in their design. A card consuming an entry says so; batch close-out (DRIFT-PROTOCOL C) retires consumed entries.

- **2026-10-10 (A-3b, #9) — for B-1 and every tool card:** tools receive the frozen **connection** `{ client_id, default_account,
  accounts, mode, profile, listing }` (snake_case). `createMcpHandler` takes `dispatch({ registry, name, args, connection, db })`;
  the default `denyAll` refuses every call, so **B-1 supplies the guarded dispatcher** (profile filter, `defineWrite`, result shaping)
  and `api/mcp.js` passes it in. `getDb()` (`src/runtime.js`) is the shared, schema-ready database. A-5 adds the setup page beside
  `api/oauth/*` and the `TOKEN_ENCRYPTION_KEY` variable. The authorize form posts accounts as `acct:<login>=on`.
