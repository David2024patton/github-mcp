import { beforeEach } from 'vitest';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { runJobStoreContract } from '../../test/contract/job-store-contract.js';

let db;
beforeEach(async () => { db = createFakeDb({}); await db.initSchema(); });
runJobStoreContract('in-memory fake', async () => db);
