import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {neonConfig} from '@neondatabase/serverless';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {createTenantSql,assertTenantSearchPath,initializeProvisionedTenant,
  tenantSchemaName} from '../../src/tenancy/directory.js';

const ids=[randomUUID(),randomUUID(),randomUUID()];
const originalFetch=neonConfig.fetchFunction;
let client,url;
beforeAll(async()=>{
  url=process.env.TEST_DATABASE_URL;
  if(!url || !['localhost','127.0.0.1','[::1]','::1'].includes(new URL(url).hostname))
    throw Error('Only disposable localhost PostgreSQL is allowed.');
  client=new pg.Client({connectionString:url});await client.connect();
  for(const id of ids.slice(0,2))await client.query('CREATE SCHEMA "'+tenantSchemaName(id)+'"');
  // Exercise the actual pinned Neon HTTP serializer against PostgreSQL, starting
  // each HTTP request from the same default session. No URL options are applied.
  neonConfig.fetchFunction=async(_endpoint,init)=>{
    const body=JSON.parse(init.body);
    expect(new URL(init.headers['Neon-Connection-String']).searchParams.has('options')).toBe(false);
    await client.query('BEGIN');
    try{
      const results=[];
      for(const q of body.queries){
        const result=await client.query({text:q.query,values:q.params,rowMode:'array'});
        results.push({fields:result.fields.map(f=>({name:f.name,dataTypeID:f.dataTypeID})),
          rows:result.rows.map(row=>row.map(v=>v===null?null:String(v))),
          command:result.command,rowCount:result.rowCount});
      }
      await client.query('COMMIT');
      return {ok:true,json:async()=>({results})};
    }catch(error){await client.query('ROLLBACK');throw error;}
  };
});
afterAll(async()=>{
  neonConfig.fetchFunction=originalFetch;
  if(client){
    for(const id of ids)await client.query('DROP SCHEMA IF EXISTS "'+tenantSchemaName(id)+'" CASCADE');
    await client.end();
  }
});

describe('transaction-local tenant namespace through Neon HTTP and real PostgreSQL',()=>{
  it('initializes, interleaves tenants, and resets the pooled session after every request',async()=>{
    const initial=(await client.query('SHOW search_path')).rows[0].search_path;
    for(const id of ids.slice(0,2)){
      await initializeProvisionedTenant({tenantId:id,connectionString:url});
      const sql=createTenantSql(url,id);
      await sql`CREATE TABLE namespace_probe (value TEXT)`;
      await sql`INSERT INTO namespace_probe VALUES (${id})`;
    }
    for(const id of [ids[0],ids[1],ids[0]]){
      const sql=createTenantSql(url,id);
      expect(await assertTenantSearchPath(sql,id)).toBe(tenantSchemaName(id));
      expect(await sql`SELECT value FROM namespace_probe`).toEqual([{value:id}]);
      expect((await client.query('SHOW search_path')).rows[0].search_path).toBe(initial);
    }
  });
  it('refuses a missing schema before initialization and never falls back',async()=>{
    await expect(initializeProvisionedTenant({tenantId:ids[2],connectionString:url}))
      .rejects.toThrow(/namespace unavailable/);
    const sql=createTenantSql(url,ids[2]);
    await expect(sql`SELECT * FROM namespace_probe`).rejects.toThrow(/does not exist/);
    expect((await client.query('SELECT current_schema() AS s')).rows[0].s).toBe('public');
  });
});
