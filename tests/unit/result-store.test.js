import { createFakeDb } from '../../test/helpers/fake-db.js';
import { runResultStoreContract } from '../../test/contract/result-store-contract.js';

runResultStoreContract('in-memory fake', async () => {
  const db = createFakeDb();
  await db.initSchema();
  return db;
});
