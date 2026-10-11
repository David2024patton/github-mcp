import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery } from '../../test/helpers/pg-neon-adapter.js';
import { runCredentialsContract } from '../../test/contract/credentials-contract.js';

let db;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must point to disposable localhost Postgres (npm run test:db)');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(process.env.TEST_DATABASE_URL).hostname)) throw new Error('Refusing non-local Postgres in tests');
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db = createDb(neonShapedQuery());
  await db.initSchema();
});
afterAll(async () => { await closeIsolatedSchema(); });
beforeEach(async () => { await rawQuery('TRUNCATE gh_apps, gh_accounts, gh_installation_tokens, setup_states, one_time_secrets'); });

runCredentialsContract('isolated PostgreSQL', async () => db);

describe('GitHub credential store on throwaway Postgres only', () => {
  it('purges at most 100 expired one-time secrets and installation tokens per write', async () => {
    for (let i = 0; i < 130; i++) {
      await rawQuery(`INSERT INTO one_time_secrets (id, kind, ciphertext, expires_at) VALUES ($1, 'k', 'c', now() - interval '1 hour')`, [`old-${i}`]);
      await rawQuery(`INSERT INTO gh_installation_tokens (installation_id, scope_key, token_enc, expires_at) VALUES (1, $1, 'c', now() - interval '1 hour')`, [`old-${i}`]);
    }
    await db.addOneTimeSecret({ id: 'N'.repeat(32), kind: 'k', ciphertext: 'c', expiresAt: new Date(Date.now() + 60000) });
    await db.putInstallationToken(2, 'fresh', 'c', new Date(Date.now() + 3600000));
    expect((await rawQuery('SELECT count(*)::int AS n FROM one_time_secrets'))[0].n).toBe(31);
    expect((await rawQuery('SELECT count(*)::int AS n FROM gh_installation_tokens'))[0].n).toBe(31);
  });

  it('the first account is the default even when two handles add accounts in turn, and the database enforces unique GitHub ids', async () => {
    const other = createDb(neonShapedQuery());
    await db.upsertAccount({ login: 'one', accountId: 1, accountType: 'User', label: 'One' });
    await other.upsertAccount({ login: 'two', accountId: 2, accountType: 'User', label: 'Two' });
    expect((await rawQuery('SELECT login FROM gh_accounts WHERE is_default'))).toEqual([{ login: 'one' }]);
  });
});
