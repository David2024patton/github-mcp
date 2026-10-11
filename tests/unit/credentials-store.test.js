import { createFakeDb } from '../../test/helpers/fake-db.js';
import { runCredentialsContract } from '../../test/contract/credentials-contract.js';

// The fake takes the same contract as real PostgreSQL.
runCredentialsContract('in-memory fake', async () => {
  const db = createFakeDb({ clock: Date.now });
  await db.initSchema();
  return db;
});
