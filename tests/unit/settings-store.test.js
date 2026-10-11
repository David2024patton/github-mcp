import { createFakeDb } from '../../test/helpers/fake-db.js';
import { runSettingsContract } from '../../test/contract/settings-contract.js';

runSettingsContract('in-memory fake', async () => {
  const db = createFakeDb();
  await db.initSchema();
  return db;
});
