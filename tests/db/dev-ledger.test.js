import { beforeAll, afterAll } from 'vitest';
import { createDb } from '../../src/db.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery } from '../../test/helpers/pg-neon-adapter.js';
import { runDevLedgerContract } from '../../test/contract/dev-ledger-contract.js';
let db;
beforeAll(async()=>{
  if(!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must be disposable localhost Postgres.');
  const host=new URL(process.env.TEST_DATABASE_URL).hostname;
  if(!['localhost','127.0.0.1','::1','[::1]'].includes(host)) throw new Error('Non-local DB refused.');
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db=createDb(neonShapedQuery()); await db.initSchema();
});
afterAll(async()=>{await closeIsolatedSchema();});
runDevLedgerContract('PostgreSQL',async()=>db);
