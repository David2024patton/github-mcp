import { createFakeDb } from '../../test/helpers/fake-db.js';
import { runChangeLogContract } from '../../test/contract/change-log-contract.js';

runChangeLogContract('in-memory fake', async () => {
  const db = createFakeDb();
  await db.initSchema();
  return db;
});
