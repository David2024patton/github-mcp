import {describe,it,expect} from 'vitest';
import {randomBytes} from 'node:crypto';
import {createRtcHttpHandler} from '../../src/rtc/http.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import * as server from '../../src/tools/server.js';
import {createFakeDb} from '../../test/helpers/fake-db.js';
import {request,call,json} from '../../test/helpers/http-harness.js';

const pass='rtc_pass_'+randomBytes(32).toString('base64url');
const row={client_id:'rtc-'+'a'.repeat(24),default_account:'scratch-org',accounts:['scratch-org'],
  areas:['server','meta'],mode:'preview',profile:'read_only',listing:'compact',
  expires_at:new Date(Date.now()+60000),allow_writes:false,production_access:false,money_limit_cents:0};
const read={name:'github_fixture_read',description:'Read fixture',area:'server',
  annotations:{readOnlyHint:true},inputSchema:{type:'object',required:['n'],
    properties:{n:{type:'integer',minimum:1,maximum:10}}}};
async function fixture({text='small',storageFailure=false}={}){
  const db=createFakeDb();await db.initSchema();
  let rate=0;const reads=[];
  db.getRtcPass=async()=>row;
  db.getAccount=async()=>({login:'scratch-org',account_type:'Organization',
    is_scratch:true,production_enabled:false,installation_status:'active',repository_selection:'all'});
  db.consumeRtcPassRate=async()=>{rate++;return true;};
  if(storageFailure)db.putResult=async()=>{throw Error('private storage failure');};
  const registry={tools:[read,...server.tools],handlers:{...server.handlers,
    [read.name]:async args=>{reads.push(args.n);return {n:args.n,text};}}};
  const handler=createRtcHttpHandler({db,registry,dispatch:createDispatch()});
  const invoke=async(route,body={},query={})=>{
    const req=request(route==='batch'?'POST':'GET',body,{authorization:'Bearer '+pass});
    req.query=query;return call((a,b)=>handler(a,b,route),req);
  };
  return {db,invoke,reads,rate:()=>rate};
}
describe('complete RTC batch validation and ordered retained responses',()=>{
  it('schema-validates every item before any canonical handler executes',async()=>{
    for(const bad of [{n:0},{n:'2'},{unexpected:1},{}]){
      const f=await fixture();
      const res=await f.invoke('batch',{calls:[{name:read.name,args:{n:1}},
        {name:read.name,args:bad}]});
      expect(res.statusCode).toBe(400);expect(json(res).error.code).toBe('invalid_args');
      expect(f.reads).toEqual([]);expect(f.rate()).toBe(1);
    }
  });
  it('retains a UTF-8 oversized aggregate, preserving all ordered reads and exact connection ownership',async()=>{
    const f=await fixture({text:'é'.repeat(1500)});
    const res=await f.invoke('batch',{calls:Array.from({length:10},(_,i)=>({name:read.name,args:{n:i+1}}))});
    expect(res.statusCode).toBe(200);
    expect(Buffer.byteLength(res.body)).toBeLessThanOrEqual(8192);
    const value=json(res);expect(value.result.count).toBe(10);
    expect(value.result.shown).toBe(value.result.results.length);
    expect(value.result.shown).toBeLessThan(10);
    expect(value.result.next).toEqual({page:1,pageSize:1});
    const kept=await f.db.getResult(value.handle,row.client_id);
    expect(kept.body.results.map(r=>r.result.n)).toEqual([1,2,3,4,5,6,7,8,9,10]);
    expect(await f.db.getResult(value.handle,'other-connection')).toBeNull();
    for(let page=1;page<=10;page++){
      const fetched=await f.invoke('results',{}, {handle:value.handle,page:String(page),pageSize:'1'});
      expect(fetched.statusCode).toBe(200);
      expect(json(fetched).result.results[0].result).toEqual({n:page,text:'é'.repeat(1500)});
    }
    expect(f.reads).toHaveLength(10); // Paging never repeats the reads.
  });
  it('keeps child handles in the full aggregate and supports a zero-item preview',async()=>{
    const f=await fixture({text:'x'.repeat(20000)});
    const res=await f.invoke('batch',{calls:Array.from({length:10},(_,i)=>({name:read.name,args:{n:i+1}}))});
    const value=json(res);expect(value.handle).toMatch(/^res_/);
    const kept=await f.db.getResult(value.handle,row.client_id);
    for(const item of kept.body.results){
      expect(item.handle).toMatch(/^res_/);
      expect((await f.db.getResult(item.handle,row.client_id)).body.text).toHaveLength(20000);
    }
  });
  it('never returns truncated success if aggregate retention fails; small batches need no retention',async()=>{
    const failed=await fixture({text:'é'.repeat(1500),storageFailure:true});
    const calls=Array.from({length:10},(_,i)=>({name:read.name,args:{n:i+1}}));
    const res=await failed.invoke('batch',{calls});
    expect(res.statusCode).toBe(503);expect(json(res).error.code).toBe('service_error');
    expect(res.body).not.toContain('private storage failure');
    const small=await fixture({storageFailure:true});
    const ok=json(await small.invoke('batch',{calls}));
    expect(ok.ok).toBe(true);expect(ok.result.results).toHaveLength(10);
    expect(ok.handle).toBeUndefined();
  });
});
