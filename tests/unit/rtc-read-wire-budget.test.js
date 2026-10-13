import {describe,it,expect} from 'vitest';
import {randomBytes} from 'node:crypto';
import {createRtcHttpHandler} from '../../src/rtc/http.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {createFakeDb} from '../../test/helpers/fake-db.js';
import {request,call,json} from '../../test/helpers/http-harness.js';
import * as server from '../../src/tools/server.js';

const pass='rtc_pass_'+randomBytes(32).toString('base64url');
const owner='rtc-'+'a'.repeat(24);
const token={client_id:owner,default_account:'scratch-org',accounts:['scratch-org'],
  areas:['server','meta'],mode:'preview',profile:'read_only',listing:'compact',
  expires_at:new Date(Date.now()+3600000),allow_writes:false,
  production_access:false,money_limit_cents:0};
const read={name:'github_rtc_budget_fixture',description:'Read a harmless fixture',area:'server',
  annotations:{readOnlyHint:true},inputSchema:{type:'object',properties:{},
    additionalProperties:false}};
const large={items:Array.from({length:4},(_,i)=>({i,text:'é'.repeat(1010)}))};
const savedHandle='res_'+randomBytes(16).toString('base64url');

async function fixture({value=large,storageFailure=false,dispatchOverride}={}){
  const db=createFakeDb();await db.initSchema();
  let writes=0,reads=0;
  const store=db.putResult.bind(db);
  db.putResult=async data=>{
    writes++;
    if(storageFailure)throw Error('private result storage details');
    return store(data);
  };
  db.getRtcPass=async()=>token;
  db.getAccount=async()=>({login:'scratch-org',account_type:'Organization',
    is_scratch:true,production_enabled:false,installation_status:'active',repository_selection:'all'});
  db.consumeRtcPassRate=async()=>true;
  const canonical=createDispatch();
  const dispatch=async input=>{
    reads++;
    if(dispatchOverride)return dispatchOverride(input);
    return input.name==='github_get_result'?canonical(input):{structuredContent:value};
  };
  const registry={tools:[read,...server.tools],handlers:{...server.handlers,
    [read.name]:async()=>value}};
  const handler=createRtcHttpHandler({db,registry,dispatch});
  const invoke=async(route='tool',body={},query={})=>{
    const req=request(route==='results'?'GET':'POST',body,{authorization:'Bearer '+pass});
    req.query=route==='tool'?{name:read.name}:query;
    return call((a,b)=>handler(a,b,route),req);
  };
  return {db,invoke,writes:()=>writes,reads:()=>reads};
}

describe('RTC read envelopes have a truthful complete-data wire budget',()=>{
  it('retains an oversized shaped read instead of sending a >8 KiB 200 response',async()=>{
    const f=await fixture();
    const response=await f.invoke();
    expect(response.statusCode).toBe(200);
    expect(Buffer.byteLength(response.body,'utf8')).toBeLessThanOrEqual(8192);
    const out=json(response);
    expect(out).toMatchObject({ok:true,result:{},mode:'preview'});
    expect(out.handle).toMatch(/^res_[A-Za-z0-9_-]{20,64}$/);
    expect(f.writes()).toBe(1);
    expect((await f.db.getResult(out.handle,owner)).body).toEqual(large);
    expect(await f.db.getResult(out.handle,'rtc-'+'b'.repeat(24))).toBeNull();
    const page=await f.invoke('results',{}, {handle:out.handle,page:'2',pageSize:'1'});
    expect(page.statusCode).toBe(200);
    expect(json(page).result.items[0]).toEqual(large.items[1]);
  });
  it('keeps small reads inline and explicit null valid without a store write',async()=>{
    for(const value of [{items:[{safe:true}]},null]){
      const f=await fixture({value});
      const response=await f.invoke();
      expect(response.statusCode).toBe(200);
      expect(json(response)).toEqual({ok:true,result:value,mode:'preview'});
      expect(f.writes()).toBe(0);
    }
  });
  it('does not report a missing structured value as a successful reply',async()=>{
    const f=await fixture({dispatchOverride:async()=>({structuredContent:undefined})});
    const response=await f.invoke();
    expect(response.statusCode).toBe(503);
    expect(json(response).error.code).toBe('service_error');
    expect(f.writes()).toBe(0);
  });
  it('reuses an existing canonical retained handle when its wrapper is too large',async()=>{
    const original={kept_result:{handle:savedHandle,what:'x'.repeat(1000)},
      summary:'y'.repeat(7800)};
    const f=await fixture({value:original});
    const response=await f.invoke();
    expect(response.statusCode).toBe(200);
    expect(Buffer.byteLength(response.body)).toBeLessThanOrEqual(8192);
    expect(json(response).handle).toBe(savedHandle);
    expect(json(response).result.note).toContain('smaller pages');
    expect(f.writes()).toBe(0);
  });
  it('reuses the requested retained handle rather than creating endlessly recursive pages',async()=>{
    const f=await fixture({dispatchOverride:async()=>({structuredContent:large})});
    await f.db.putResult({handle:savedHandle,connection:owner,summary:'first',
      body:{items:[{safe:true}]}});
    const before=f.writes();
    const response=await f.invoke('results',{}, {handle:savedHandle});
    expect(response.statusCode).toBe(200);
    expect(json(response).handle).toBe(savedHandle);
    expect(json(response).result.note).toContain('smaller pageSize');
    expect(f.writes()).toBe(before);
  });
  it('reports storage failures as sanitized 503 instead of losing oversized data',async()=>{
    const f=await fixture({storageFailure:true});
    const response=await f.invoke();
    expect(response.statusCode).toBe(503);
    expect(json(response).error.code).toBe('service_error');
    expect(response.body).not.toContain('private result storage details');
    expect(f.writes()).toBe(1);
  });
  it('retains each large batch child and preserves their individual handles',async()=>{
    const f=await fixture();
    const response=await f.invoke('batch',{calls:[{name:read.name,args:{}},{name:read.name,args:{}}]});
    expect(response.statusCode).toBe(200);
    expect(Buffer.byteLength(response.body)).toBeLessThanOrEqual(8192);
    const results=json(response).result.results;
    expect(results).toHaveLength(2);
    for(const item of results){
      expect((await f.db.getResult(item.handle,owner)).body).toEqual(large);
    }
    expect(results[0].handle).not.toBe(results[1].handle);
    expect(f.writes()).toBe(2);
  });
});
