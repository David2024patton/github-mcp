import {afterEach,describe,expect,it,vi} from 'vitest';
import {neonConfig} from '@neondatabase/serverless';
import {createTenantSql,tenantSchemaName} from '../../src/tenancy/directory.js';

const tenant='5ca85cbb-2222-4222-8222-333333333333';
const originalFetch=neonConfig.fetchFunction;
afterEach(()=>{neonConfig.fetchFunction=originalFetch;});

describe('tenant production Neon HTTP adapter',()=>{
  it('batches local namespace and parameterized query in every request, without startup options',async()=>{
    const requests=[];
    neonConfig.fetchFunction=vi.fn(async(_url,init)=>{
      requests.push({body:JSON.parse(init.body),connection:new URL(init.headers['Neon-Connection-String'])});
      return {ok:true,json:async()=>({results:[
        {fields:[],rows:[]},
        {fields:[{name:'value',dataTypeID:25}],rows:[['safe']]}
      ]})};
    });
    const sql=createTenantSql('postgresql://fixture:fictional@example.com/fixture',tenant);
    expect(await sql`SELECT ${'first'} AS value`).toEqual([{value:'safe'}]);
    await sql`SELECT ${'second'} AS value`;
    expect(requests).toHaveLength(2);
    for(const [index,{body,connection}] of requests.entries()){
      expect(connection.searchParams.has('options')).toBe(false);
      expect(body.queries).toEqual([
        {query:"SELECT set_config('search_path', $1, true)",params:[tenantSchemaName(tenant)]},
        {query:'SELECT $1 AS value',params:[index===0?'first':'second']}
      ]);
    }
  });
  it('does not retry a failed transaction under an owner/default namespace',async()=>{
    const send=vi.fn(async()=>({ok:false,status:400,json:async()=>({message:'fixture namespace refused'})}));
    neonConfig.fetchFunction=send;
    const sql=createTenantSql('postgresql://fixture:fictional@example.com/fixture',tenant);
    await expect(sql`SELECT 1`).rejects.toThrow('fixture namespace refused');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
