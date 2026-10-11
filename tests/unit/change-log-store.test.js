import { runChangeLogContract } from '../../test/contract/change-log-contract.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';

runChangeLogContract('in-memory fake', async () => {
  const db = createFakeDb();
  await db.initSchema();
  return db;
});
