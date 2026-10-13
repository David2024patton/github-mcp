import {describe,it,expect} from 'vitest';
import {randomBytes} from 'node:crypto';
import {createRtcHttpHandler} from '../../src/rtc/http.js';
import {rtcHttpTools} from '../../src/rtc/scope.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {createFakeDb} from '../../test/helpers/fake-db.js';
import {request,call,json} from '../../test/helpers/http-harness.js';
import * as server from '../../src/tools/server.js';

const owner='rtc-'+'b'.repeat(24);
const pass='rtc_pass_'+randomBytes(32).toString('base64url');
const token={client_id:owner,default_account:'scratch-org',
  accounts:['scratch-org'],areas:['server','meta'],mode:'preview',
  profile:'read_only',listing:'compact',expires_at:new Date(Date.now()+600000),
  allow_writes:false,production_access:false,money_limit_cents:0};
const tool=(i,len=850)=>({
  name:'github_discovery_fixture_'+i,description:'Search fixture '+i,
  area:'server',compact:true,audience:['B'],annotations:{readOnlyHint:true},
  inputSchema:{type:'object',properties:{query:{type:'string',
    description:'x'.repeat(len)}}}
});
async function fixture({tools=Array.from({length:35},(_,i)=>tool(i)),
  storageFailure=false}={}){
  const db=createFakeDb();await db.initSchema();let writes=0;
  db.getRtcPass=async()=>token;
  db.getAccount=async()=>({login:'scratch-org',account_type:'Organization',is_scratch:true,
    production_enabled:false,installation_status:'active',repository_selection:'all'});
  db.consumeRtcPassRate=async()=>true;
  const old=db.putResult.bind(db);
  db.putResult=async data=>{writes++;
    if(storageFailure)throw new Error('private store failure');
    return old(data);
  };
  const registry={tools:[...tools,...server.tools],handlers:{...server.handlers}};
  const handler=createRtcHttpHandler({db,registry,dispatch:createDispatch()});
  const invoke=async(route='tools',query={},authorization='Bearer '+pass)=>{
    const req=request('GET',query,{authorization});
    req.query=query;
    return call((a,b)=>handler(a,b,route),req);
  };
  return {db,invoke,writes:()=>writes};
}
describe('RTC discovery and describe HTTP budgets',()=>{
  it('retains complete catalog metadata with truthful shown/requested/next counts',async()=>{
    const f=await fixture();
    const first=await f.invoke('tools',{listing:'catalog',limit:'25',page:'1'});
    expect(first.statusCode).toBe(200);
    expect(Buffer.byteLength(first.body,'utf8')).toBeLessThanOrEqual(8192);
    const reply=json(first);
    expect(reply.handle).toMatch(/^res_/);
    expect(reply.result.count).toBe(35+rtcHttpTools({tools:server.tools}).length);
    expect(reply.result.requested).toBe(25);
    expect(reply.result.shown).toBe(reply.result.tools.length);
    expect(reply.result.shown).toBeLessThan(25);
    expect(reply.result.next).toBe(2);
    const retained=await f.db.getResult(reply.handle,owner);
    expect(retained.body.tools).toHaveLength(25);
    expect(retained.body.tools[24].name).toBe('github_discovery_fixture_24');
    expect(await f.db.getResult(reply.handle,'rtc-'+'a'.repeat(24))).toBeNull();
    const page=await f.invoke('results',{handle:reply.handle,page:'25',pageSize:'1'});
    expect(page.statusCode).toBe(200);
    expect(json(page).result.tools[0].name).toBe('github_discovery_fixture_24');
    expect(f.writes()).toBe(1);
  });
  it('keeps small catalog pages inline without retention',async()=>{
    const f=await fixture();
    const res=await f.invoke('tools',{listing:'catalog',limit:'1'});
    expect(res.statusCode).toBe(200);
    expect(json(res).result.tools).toHaveLength(1);
    expect(json(res).handle).toBeUndefined();
    expect(f.writes()).toBe(0);
  });
  it('retains oversized one-tool describe schema without losing fields',async()=>{
    const big=tool(100,16000);
    const f=await fixture({tools:[big]});
    const res=await f.invoke('tool',{name:big.name});
    expect(res.statusCode).toBe(200);
    expect(Buffer.byteLength(res.body)).toBeLessThanOrEqual(8192);
    const result=json(res);
    expect(result.handle).toMatch(/^res_/);
    expect((await f.db.getResult(result.handle,owner)).body.inputSchema)
      .toEqual(big.inputSchema);
  });
  it('returns 503 instead of truncated success on retention failure',async()=>{
    const f=await fixture({storageFailure:true});
    const res=await f.invoke('tools',{listing:'catalog',limit:'25'});
    expect(res.statusCode).toBe(503);
    expect(json(res).error.code).toBe('service_error');
    expect(res.body).not.toContain('private store failure');
    expect(f.writes()).toBe(1);
  });
  it('rejects invalid bearer and malformed query before inventory',async()=>{
    const f=await fixture();
    const denied=await f.invoke('tools',{limit:'30'},'Bearer missing');
    expect(denied.statusCode).toBe(401);
    const bad=await f.invoke('tools',{limit:'101'});
    expect(bad.statusCode).toBe(400);
    expect(f.writes()).toBe(0);
  });
});
