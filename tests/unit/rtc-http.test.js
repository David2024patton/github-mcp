import {describe,it,expect} from 'vitest';
import {randomBytes} from 'node:crypto';
import {request,call,json} from '../../test/helpers/http-harness.js';
import {createRtcHttpHandler} from '../../src/rtc/http.js';
import {rtcManifest,rtcMetadata} from '../../src/rtc/contract.js';
const pass='rtc_pass_'+randomBytes(32).toString('base64url');
const read={name:'github_whoami',description:'Read safe scope',area:'server',audience:['B'],compact:true,
  inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}};
const write={name:'github_delete_repo',description:'Delete repo',area:'server',writes:true,
  inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:false}};
const registry={tools:[read,write],handlers:{}};
const account={login:'scratch-org',is_scratch:true,production_enabled:false,
  account_type:'Organization',installation_status:'active',repository_selection:'all'};
const token={client_id:'rtc-'+'a'.repeat(24),default_account:'scratch-org',
  accounts:['scratch-org'],mode:'preview',profile:'read_only',listing:'compact',
  expires_at:new Date(Date.now()+3600000),revoked_at:null,
  areas:['server','meta'],allow_writes:false,production_access:false,money_limit_cents:0};
async function run(route,method='GET',payload={},options={}){
  const db={getRtcPass:async()=>({...token,...options.token}),
    getAccount:async()=>({...account,...options.account}),
    consumeRtcPassRate:async()=>options.limited!==true};
  const dispatch=async({name})=>({structuredContent:{name,scope:'scratch-org'}});
  const handler=createRtcHttpHandler({db,registry,dispatch});
  const req=request(method,method==='GET'?options.query??{}:payload,
    {authorization:options.authorization??'Bearer '+pass});
  req.query={...(options.query??{}),...(route==='tool'?{name:options.tool??'github_whoami'}:{})};
  return call((q,res)=>handler(q,res,route),req);
}
describe('RTC gated, pass-only HTTPS boundary',()=>{
  it('does not falsely advertise conformance before it is proven',()=>{
    expect(rtcManifest(registry).rtc).toBe(0);
    expect(rtcMetadata(read)).toMatchObject({writes:false,destructive:false});
  });
  it('denies OAuth bearer, expired and revoked passes',async()=>{
    expect(json(await run('whoami','GET',{}, {authorization:'Bearer oauth-not-pass'})).error.code).toBe('permission');
    expect(json(await run('whoami','GET',{}, {token:{expires_at:new Date(0)}})).error.code).toBe('pass_expired');
    expect(json(await run('whoami','GET',{}, {token:{revoked_at:new Date()}})).error.code).toBe('pass_revoked');
  });
  it('checks scratch status and the shared rate budget every request',async()=>{
    for(const bad of [{is_scratch:false},{production_enabled:true},{repository_selection:'selected'}])
      expect((await run('whoami','GET',{}, {account:bad})).statusCode).toBe(403);
    const limited=await run('whoami','GET',{}, {limited:true});
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['Retry-After']).toBe('60');
    for(const bad of [{allow_writes:true},{production_access:true},{money_limit_cents:1},
      {areas:['server']},{areas:['server','foreign']}]){
      const refused=await run('whoami','GET',{}, {token:bad});
      expect(refused.statusCode).toBe(403);
    }
  });
  it('supports whoami, search, describe and guarded read call',async()=>{
    expect(json(await run('whoami')).result.profile).toBe('read_only');
    const list=json(await run('tools','GET',{}, {query:{listing:'catalog'}}));
    expect(list.result.tools.map(t=>t.name)).toEqual(['github_whoami']);
    expect(json(await run('tool')).result.name).toBe('github_whoami');
    expect(json(await run('tool','POST',{})).result.name).toBe('github_whoami');
  });
  it('promotes only connection-owned retained handles to the RTC result envelope',async()=>{
    const db={getRtcPass:async()=>token,getAccount:async()=>account,
      consumeRtcPassRate:async()=>true};
    const existing=createRtcHttpHandler({db,registry,dispatch:async()=>({
      structuredContent:{items:[1],kept_result:{handle:'res_'+'a'.repeat(22),what:'fixture'}}
    })});
    const req=request('POST',{}, {authorization:'Bearer '+pass});
    req.query={name:'github_whoami'};
    const response=await call((a,b)=>existing(a,b,'tool'),req);
    expect(json(response)).toMatchObject({ok:true,handle:'res_'+'a'.repeat(22),
      result:{items:[1]},mode:'preview'});
    expect(json(response).result).not.toHaveProperty('kept_result');
  });
  it('forwards result pagination and selected fields through the existing guarded handler',async()=>{
    const handle='res_'+'b'.repeat(22);
    const seen=[];
    const db={getRtcPass:async()=>token,getAccount:async()=>account,consumeRtcPassRate:async()=>true};
    const withResults={...registry,tools:[...registry.tools,{...read,name:'github_get_result'}]};
    const handler=createRtcHttpHandler({db,registry:withResults,dispatch:async({name,args,connection})=>{
      seen.push({name,args,client:connection.client_id});
      return {structuredContent:{page_info:{page:args.page},items:[{summary:'owned'}]}};
    }});
    const req=request('GET',{}, {authorization:'Bearer '+pass});
    req.query={handle,page:'3',pageSize:'5',fields:'summary,created_at',offset:'120'};
    const response=await call((a,b)=>handler(a,b,'results'),req);
    expect(response.statusCode).toBe(200);
    expect(json(response)).toMatchObject({ok:true,result:{page_info:{page:3}}});
    expect(seen).toEqual([{name:'github_get_result',args:{handle,page:3,pageSize:5,
      fields:['summary','created_at'],offset:120},client:token.client_id}]);
  });
  it('rejects malformed saved-result query before dispatch',async()=>{
    const handle='res_'+'c'.repeat(22);
    let calls=0;
    const db={getRtcPass:async()=>token,getAccount:async()=>account,consumeRtcPassRate:async()=>true};
    const handler=createRtcHttpHandler({db,registry,dispatch:async()=>{
      calls++;return {structuredContent:{safe:true}};
    }});
    for(const query of [
      {page:'0'},{page:'1.5'},{page:'100001'},{page:['1','2']},
      {pageSize:'101'},{offset:'-1'},{offset:'100000001'},
      {fields:''},{fields:'one,,two'},{fields:Array.from({length:21},()=> 'x')},
      {fields:'a'.repeat(65)},{unexpected:'ignored'}
    ]){
      const req=request('GET',{}, {authorization:'Bearer '+pass});
      req.query={handle,...query};
      const response=await call((a,b)=>handler(a,b,'results'),req);
      expect(response.statusCode,JSON.stringify(query)).toBe(400);
      expect(json(response).error.code).toBe('invalid_args');
    }
    expect(calls).toBe(0);
  });
  it('refuses the complete malformed batch before any dispatch',async()=>{
    let dispatched=0;
    const db={getRtcPass:async()=>token,getAccount:async()=>account,consumeRtcPassRate:async()=>true};
    const handler=createRtcHttpHandler({db,registry,dispatch:async()=>{
      dispatched++;return {structuredContent:{ok:true}};
    }});
    for(const calls of [
      [{name:'github_whoami',args:{}},{name:'github_whoami',args:[]}],
      [{name:'github_whoami',args:{}},{name:'github_whoami',args:null}],
      [{name:'github_whoami',args:{}},{name:'github_whoami',args:{},extra:true}],
      [{name:'github_whoami',args:{}},null]
    ]){
      const req=request('POST',{calls},{authorization:'Bearer '+pass});
      expect((await call((a,b)=>handler(a,b,'batch'),req)).statusCode).toBe(400);
    }
    expect(dispatched).toBe(0);
  });
  it('rechecks revocation, expiry, scratch designation and rate between reads',async()=>{
    for(const failure of ['revoked','expired','scratch','rate']){
      let reads=0,checks=0,lookups=0;
      const db={
        getRtcPass:async()=>{lookups++;return {...token,
          ...(reads&&failure==='revoked'?{revoked_at:new Date()}:{}),
          ...(reads&&failure==='expired'?{expires_at:new Date(0)}:{})};},
        getAccount:async()=>({...account,...(reads&&failure==='scratch'?{is_scratch:false}:{})}),
        consumeRtcPassRate:async()=>{checks++;return !(reads&&failure==='rate');}
      };
      const handler=createRtcHttpHandler({db,registry,dispatch:async()=>{
        reads++;return {structuredContent:{read:reads}};
      }});
      const req=request('POST',{calls:[{name:'github_whoami',args:{}},
        {name:'github_whoami',args:{}}]},{authorization:'Bearer '+pass});
      const response=await call((a,b)=>handler(a,b,'batch'),req);
      expect(reads,failure).toBe(1);
      expect(lookups,failure).toBe(2);
      expect(checks,failure).toBe(failure==='rate'?2:1);
      expect(response.statusCode,failure).toBe(failure==='rate'?429:failure==='scratch'?403:401);
      expect(json(response).error.code,failure).toBe({revoked:'pass_revoked',expired:'pass_expired',
        scratch:'refused_by_guard',rate:'rate_limited'}[failure]);
    }
  });
  it('charges one shared rate unit per tool in a successful batch',async()=>{
    let calls=0,rate=0;
    const db={getRtcPass:async()=>token,getAccount:async()=>account,
      consumeRtcPassRate:async()=>{rate++;return true;}};
    const handler=createRtcHttpHandler({db,registry,dispatch:async()=>{
      calls++;return {structuredContent:{calls}};
    }});
    const req=request('POST',{calls:Array.from({length:3},()=>({name:'github_whoami',args:{}}))},
      {authorization:'Bearer '+pass});
    const response=await call((a,b)=>handler(a,b,'batch'),req);
    expect(response.statusCode).toBe(200);
    expect(json(response).result.results).toHaveLength(3);
    expect(rate).toBe(3);
  });
  it('never calls write tools and refuses write batches',async()=>{
    expect((await run('tool','POST',{}, {tool:'github_delete_repo'})).statusCode).toBe(404);
    expect((await run('batch','POST',{calls:[{name:'github_delete_repo',args:{confirm:true}}]})).statusCode).toBe(403);
    expect(json(await run('batch','POST',{calls:[{name:'github_whoami',args:{}}]})).result.results).toHaveLength(1);
  });
});
