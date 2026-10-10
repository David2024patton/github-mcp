import { beforeAll, afterAll, expect, it } from 'vitest';
import { openIsolatedSchema, closeIsolatedSchema, rawQuery, neonShapedQuery } from '../../test/helpers/pg-neon-adapter.js';
import { runDbContract } from '../../test/contract/db-contract.js';

let sql;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must point to disposable localhost Postgres (npm run test:db)');
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) throw new Error('Refusing non-local Postgres in tests');
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  await rawQuery('CREATE TABLE contract_items (key TEXT PRIMARY KEY, value JSONB NOT NULL)');
  sql = neonShapedQuery();
});
afterAll(async () => { await closeIsolatedSchema(); });

runDbContract('isolated PostgreSQL', async () => ({
  async put(key, value) { await sql`INSERT INTO contract_items (key, value) VALUES (${key}, ${JSON.stringify(value)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`; },
  async get(key) { const rows = await sql`SELECT value FROM contract_items WHERE key = ${key}`; return rows[0]?.value ?? null; }
}));

it('runs parameterized Neon-shaped queries inside its own throwaway schema', async () => {
  expect((await sql`SELECT ${42}::integer AS answer`)[0].answer).toBe(42);
  const [{ schema }] = await sql`SELECT current_schema() AS schema`;
  expect(schema).toMatch(/^github_mcp_test_[0-9a-f]{12}$/);
});
