import { createFakeDb } from '../../test/helpers/fake-db.js';
import { runProtectedContract, runSettingsContract, runSpendContract } from '../../test/contract/settings-contract.js';

runSettingsContract('in-memory fake', async () => {
  const db = createFakeDb();
  await db.initSchema();
  return db;
});

runProtectedContract('in-memory fake', async () => {
  const db = createFakeDb();
  await db.initSchema();
  return db;
});

runSpendContract('in-memory fake', async () => {
  const db = createFakeDb();
  await db.initSchema();
  return db;
});
