import { beforeAll, afterAll, it, expect } from 'vitest';
import pg from 'pg';
import { createDb } from '../../src/db.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery } from '../../test/helpers/pg-neon-adapter.js';
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
it('arbitrates cleanup executors across separate PostgreSQL connections',async()=>{
  const [{schema}]=await rawQuery('SELECT current_schema() AS schema');
  if(!/^github_mcp_test_[a-f0-9]+$/.test(schema))throw new Error('Only an isolated test schema is allowed.');
  const clients=[new pg.Client({connectionString:process.env.TEST_DATABASE_URL}),
    new pg.Client({connectionString:process.env.TEST_DATABASE_URL})];
  try{
    await Promise.all(clients.map(c=>c.connect()));
    await Promise.all(clients.map(c=>c.query(`SET search_path TO "${schema}"`)));
    const stores=clients.map(client=>createDb(async(strings,...values)=>{
      let statement=strings[0];
      for(let i=0;i<values.length;i++)statement+=`$${i+1}${strings[i+1]}`;
      return (await client.query(statement,values)).rows;
    }));
    const scope={runId:'run-db-executors',account:'example-org',connection:'client-one'};
    await db.createDevRun({id:scope.runId,account:scope.account,connection:scope.connection});
    const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
    const outcomes=await Promise.all(stores.map((store,i)=>store.claimDevCleanupExecution({...scope,executorId:ids[i]})));
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const winner=outcomes.findIndex(Boolean),loser=1-winner;
    expect(await stores[loser].releaseDevCleanupExecution({...scope,executorId:ids[loser]})).toBe(false);
    expect(await stores[winner].releaseDevCleanupExecution({...scope,executorId:ids[winner]})).toBe(true);
  }finally{await Promise.all(clients.map(c=>c.end()));}
});
