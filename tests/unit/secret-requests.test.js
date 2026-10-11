import { createFakeDb } from '../../test/helpers/fake-db.js';
import { runSecretRequestContract } from '../../test/contract/secret-requests-contract.js';

runSecretRequestContract('in-memory fake', async () => {
  const db = createFakeDb();
  await db.initSchema();
  return db;
});
