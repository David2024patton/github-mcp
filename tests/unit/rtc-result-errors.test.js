import {describe,it,expect} from 'vitest';
import {randomBytes} from 'node:crypto';
import {createRtcHttpHandler} from '../../src/rtc/http.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import * as server from '../../src/tools/server.js';
import {createFakeDb} from '../../test/helpers/fake-db.js';
import {request,call,json} from '../../test/helpers/http-harness.js';

const pass='rtc_pass_'+randomBytes(32).toString('base64url');
const handle='res_'+randomBytes(16).toString('base64url');
const row={client_id:'rtc-'+'a'.repeat(24),default_account:'scratch-org',
  accounts:['scratch-org'],areas:['server','meta'],mode:'preview',profile:'read_only',
  listing:'compact',expires_at:new Date(Date.now()+3600000),
  allow_writes:false,production_access:false,money_limit_cents:0};
const account={login:'scratch-org',account_type:'Organization',is_scratch:true,
  production_enabled:false,installation_status:'active',repository_selection:'all'};

async function fixture({dispatch=createDispatch(),stored=true,owner=row.client_id}={}){
  const db=createFakeDb();await db.initSchema();
  let lookups=0,rates=0;
  db.getRtcPass=async()=>row;
  db.getAccount=async()=>account;
  db.consumeRtcPassRate=async()=>{rates++;return true;};
  if(stored)await db.putResult({handle,connection:owner,summary:'safe fixture',
    body:{items:[{safe:'owned'}]}});
  const getResult=db.getResult.bind(db);
  db.getResult=async(...args)=>{lookups++;return getResult(...args);};
  const handler=createRtcHttpHandler({db,registry:{tools:server.tools,handlers:server.handlers},dispatch});
  const invoke=async(query={handle},authorization='Bearer '+pass)=>{
    const req=request('GET',{}, {authorization});
    req.query=query;
    return call((a,b)=>handler(a,b,'results'),req);
  };
  return {db,invoke,lookups:()=>lookups,rates:()=>rates};
}
describe('RTC retained-result error taxonomy and ownership',()=>{
  it('returns a real owned page without changing standalone result shaping',async()=>{
    const f=await fixture();
    const res=await f.invoke({handle,page:'1',pageSize:'1'});
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ok:true,result:{items:[{safe:'owned'}]}});
    expect(f.lookups()).toBe(1); // one canonical owner-scoped read
    expect(f.rates()).toBe(1);
  });
  it('does not disclose absent, expired or foreign handles to another pass',async()=>{
    for(const setup of [{stored:false},{owner:'rtc-'+'b'.repeat(24)}]){
      const f=await fixture(setup);
      const res=await f.invoke();
      expect(res.statusCode).toBe(404);
      expect(json(res).error.code).toBe('not_found');
      expect(res.body).not.toContain('scratch-org');
      expect(f.lookups()).toBe(1);
    }
  });
  it('treats scoped storage outage as 503 without leaking internals',async()=>{
    const f=await fixture();
    f.db.getResult=async()=>{throw new Error('private database details');};
    const res=await f.invoke();
    expect(res.statusCode).toBe(503);
    expect(json(res).error.code).toBe('service_error');
    expect(res.body).not.toContain('private database details');
  });
  it('never relabels a canonical dispatcher failure as a missing handle',async()=>{
    for(const dispatch of [
      async()=>{throw new Error('private provider detail');},
      async()=>({isError:true,content:[{type:'text',text:'private provider detail'}]}),
      async()=>({content:[{type:'text',text:'missing result value'}]})
    ]){
      const f=await fixture({dispatch});
      const res=await f.invoke();
      expect(res.statusCode).toBe(503);
      expect(json(res).error.code).toBe('service_error');
      expect(res.body).not.toContain('private provider detail');
    }
  });
  it('avoids two-read disappearance races without changing owner scope',async()=>{
    const f=await fixture();
    const getResult=f.db.getResult.bind(f.db);
    let reads=0;
    f.db.getResult=async(...args)=>{reads++;return reads===1?getResult(...args):null;};
    const res=await f.invoke();
    expect(res.statusCode).toBe(200);
    expect(json(res).result.items).toEqual([{safe:'owned'}]);
    expect(reads).toBe(1);
  });
  it('classifies only trusted canonical absent-handle errors as 404',async()=>{
    const f=await fixture({stored:false});
    const absent=await f.invoke();
    expect(absent.statusCode).toBe(404);
    expect(json(absent).error.code).toBe('not_found');
    const out=await createDispatch()({registry:{tools:server.tools,handlers:server.handlers},
      name:'github_get_result',args:{handle},connection:{...row},db:f.db});
    expect(out).toMatchObject({isError:true,failureCode:'retained_result_not_found'});
    expect(JSON.stringify(out)).not.toContain('scratch-org');
    const unrelated=await fixture({dispatch:async()=>({isError:true,
      content:[{type:'text',text:'That result was not found.'}]})});
    const failure=await unrelated.invoke();
    expect(failure.statusCode).toBe(503);
    expect(json(failure).error.code).toBe('service_error');
  });
  it('keeps argument and authorization denials before scoped lookup',async()=>{
    const f=await fixture();
    const invalid=await f.invoke({handle,pageSize:'0'});
    expect(invalid.statusCode).toBe(400);
    expect(json(invalid).error.code).toBe('invalid_args');
    expect(f.lookups()).toBe(0);
    const denied=await f.invoke({handle},'Bearer invalid');
    expect(denied.statusCode).toBe(401);
    expect(json(denied).error.code).toBe('permission');
    expect(f.lookups()).toBe(0);
  });
});
