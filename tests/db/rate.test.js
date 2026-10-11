import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery } from '../../test/helpers/pg-neon-adapter.js';
import { runRateContract } from '../../test/contract/rate-contract.js';

let db;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must point to disposable localhost Postgres (npm run test:db)');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(process.env.TEST_DATABASE_URL).hostname)) throw new Error('Refusing non-local Postgres in tests');
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db = createDb(neonShapedQuery());
  await db.initSchema();
});
afterAll(async () => { await closeIsolatedSchema(); });
beforeEach(async () => { await rawQuery('TRUNCATE gh_write_slots, gh_rate_state, gh_etag_cache'); });

runRateContract('isolated PostgreSQL', async () => db);

describe('GitHub rate store on throwaway Postgres only', () => {
  it('two separate database handles (two server instances) share one write queue', async () => {
    const instanceA = createDb(neonShapedQuery());
    const instanceB = createDb(neonShapedQuery());
    const [a, b] = await Promise.all([
      instanceA.claimWriteSlot('inst-two-instances', { spacingMs: 1000, maxWaitMs: 5000 }),
      instanceB.claimWriteSlot('inst-two-instances', { spacingMs: 1000, maxWaitMs: 5000 })
    ]);
    expect(Math.abs(a.waitMs - b.waitMs)).toBeGreaterThanOrEqual(900);
  });

  it('a rate block recorded by one instance is seen by another', async () => {
    await createDb(neonShapedQuery()).recordRateState({ account: 'example-org', resource: 'core', remaining: 0, resetAt: new Date(Date.now() + 120_000), blockedUntil: new Date(Date.now() + 120_000) });
    const seen = await createDb(neonShapedQuery()).getRateState('example-org', 'core');
    expect(new Date(seen.blocked_until).getTime()).toBeGreaterThan(Date.now());
  });

  it('putEtag deletes at most 100 expired rows per call', async () => {
    for (let i = 0; i < 150; i++) {
      await rawQuery(`INSERT INTO gh_etag_cache (account, url_key, etag, body, stored_at) VALUES ('example-org', $1, 'e', '{}', now() - interval '2 days')`, [`/old/${i}`]);
    }
    await db.putEtag('example-org', '/fresh', 'e', { ok: true });
    const [{ count }] = await rawQuery(`SELECT count(*)::int AS count FROM gh_etag_cache WHERE url_key LIKE '/old/%'`);
    expect(count).toBe(50);
  });
});
