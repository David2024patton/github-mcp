import { createFakeDb } from '../../test/helpers/fake-db.js';
import { runConnectionsContract } from '../../test/contract/connections-contract.js';

runConnectionsContract('in-memory fake', async () => {
  const db = createFakeDb();
  await db.initSchema();
  return db;
});
