import {beforeAll,afterAll,beforeEach} from 'vitest';
import {createDb} from '../../src/db.js';
import {openIsolatedSchema,closeIsolatedSchema,neonShapedQuery,rawQuery} from '../../test/helpers/pg-neon-adapter.js';
import {runScratchAccountContract} from '../../test/contract/scratch-account-contract.js';
let db;
beforeAll(async()=>{if(!process.env.TEST_DATABASE_URL)throw new Error('Only local throwaway Postgres is supported.');
  if(!['localhost','127.0.0.1','::1','[::1]'].includes(new URL(process.env.TEST_DATABASE_URL).hostname))
    throw new Error('Refusing non-local Postgres in tests');
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db=createDb(neonShapedQuery());await db.initSchema();
});
afterAll(async()=>{await closeIsolatedSchema();});
beforeEach(async()=>{await rawQuery('TRUNCATE gh_accounts CASCADE');});
runScratchAccountContract('isolated PostgreSQL',async()=>db);
