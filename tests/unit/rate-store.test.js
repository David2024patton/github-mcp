import { createFakeDb } from '../../test/helpers/fake-db.js';
import { runRateContract } from '../../test/contract/rate-contract.js';

// The fake takes the same contract as real PostgreSQL. Wait times are computed, never slept.
runRateContract('in-memory fake', async () => {
  const db = createFakeDb({ clock: Date.now });
  await db.initSchema();
  return db;
});
