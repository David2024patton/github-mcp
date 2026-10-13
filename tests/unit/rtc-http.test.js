import {describe,it,expect} from 'vitest';
import {randomBytes} from 'node:crypto';
import {request,call,json} from '../../test/helpers/http-harness.js';
import {createRtcHttpHandler} from '../../src/rtc/http.js';
import {rtcManifest,rtcMetadata} from '../../src/rtc/contract.js';
import {rtcHttpTools} from '../../src/rtc/scope.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import * as meta from '../../src/tools/meta.js';

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
    const db={getRtcPass:async()=>token,getAccount:async()=>account,consumeRtcPassRate:async()=>true,
      // This spy-only fixture models an owned stored result before canonical dispatch.
      // The RTC boundary must not mistake a missing DB function for a 404.
      getResult:async(h,owner)=>h===handle&&owner===token.client_id?{body:{items:[]}}:null};
    const withResults={...registry,tools:[...registry.tools,{...read,name:'github_get_result',
      inputSchema:{type:'object',required:['handle'],additionalProperties:false,
        properties:{handle:{type:'string'},page:{type:'integer'},pageSize:{type:'integer'},
          fields:{type:'array',items:{type:'string'}},offset:{type:'integer'}}}}]};
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
  it('rejects ambiguous and oversized discovery queries before scanning tools',async()=>{
    for(const query of [
      {limit:['1','100']},{limit:'1.5'},{page:'NaN'},{page:'1001'},
      {limit:'101'},{q:'x'.repeat(201)},{q:['github']},{area:'a'.repeat(65)},
      {audience:['builder']},{listing:'verbose'},{listing:['compact']},
      {unknown:'value'}
    ]){
      const response=await run('tools','GET',{}, {query});
      expect(response.statusCode,JSON.stringify(query)).toBe(400);
      expect(json(response).error.code).toBe('invalid_args');
    }
    const response=await run('tools','GET',{}, {query:{limit:'1',page:'1',q:'who',listing:'catalog'}});
    expect(json(response).result.tools.map(t=>t.name)).toEqual(['github_whoami']);
  });
  it('preserves each connection-owned saved-result handle in RTC batch responses',async()=>{
    const db={getRtcPass:async()=>token,getAccount:async()=>account,
      consumeRtcPassRate:async()=>true};
    let i=0;
    const handler=createRtcHttpHandler({db,registry,dispatch:async()=>{
      i++;
      if(i===2)return {structuredContent:{items:['bounded'],
        kept_result:{handle:'res_'+'d'.repeat(22),what:'Saved items'}}};
      return {structuredContent:{items:['inline']}};
    }});
    const req=request('POST',{calls:[{name:'github_whoami',args:{}},
      {name:'github_whoami',args:{}}]},{authorization:'Bearer '+pass});
    const response=await call((a,b)=>handler(a,b,'batch'),req);
    expect(response.statusCode).toBe(200);
    const items=json(response).result.results;
    expect(items).toHaveLength(2);
    expect(items[0]).not.toHaveProperty('handle');
    expect(items[1]).toMatchObject({name:'github_whoami',ok:true,
      result:{items:['bounded']},handle:'res_'+'d'.repeat(22),summary:'Saved items'});
    expect(items[1].result).not.toHaveProperty('kept_result');
  });
  it('caps RTC POST wire size before dispatcher execution, measured in UTF-8 bytes',async()=>{
    let calls=0;
    const db={getRtcPass:async()=>token,getAccount:async()=>account,
      consumeRtcPassRate:async()=>true};
    const handler=createRtcHttpHandler({db,registry,dispatch:async()=>{
      calls++;return {structuredContent:{ok:true}};
    }});
    const invoke=async(route,body)=>{
      const req=request('POST',body,{authorization:'Bearer '+pass});
      req.query=route==='tool'?{name:'github_whoami'}:{};
      return call((a,b)=>handler(a,b,route),req);
    };
    for(const body of [
      {text:'a'.repeat(32769)},{text:'é'.repeat(18000)}
    ]){
      expect((await invoke('tool',body)).statusCode).toBe(400);
      expect((await invoke('batch',{calls:[{name:'github_whoami',args:body}]})).statusCode).toBe(400);
    }
    expect((await invoke('batch',{calls:[{name:'github_whoami',args:{}}],
      extra:{unexpected:true}})).statusCode).toBe(400);
    expect(calls).toBe(0);
    expect((await invoke('tool',{})).statusCode).toBe(200);
    expect((await invoke('batch',{calls:[{name:'github_whoami',args:{}}]})).statusCode).toBe(200);
    expect(calls).toBe(2);
  });
  it('rejects inflated declared HTTP length even when parsed JSON is tiny',async()=>{
    let dispatched=0;
    const db={getRtcPass:async()=>token,getAccount:async()=>account,
      consumeRtcPassRate:async()=>true};
    const handler=createRtcHttpHandler({db,registry,dispatch:async()=>{
      dispatched++;return {structuredContent:{safe:true}};
    }});
    for(const route of ['tool','batch']){
      const payload=route==='tool'?{}:{calls:[{name:'github_whoami',args:{}}]};
      for(const declared of ['32769','999999999999999999999','-1','1e7','2.5',
        ['10','32769'],null]){
        const req=request('POST',payload,
          {authorization:'Bearer '+pass,'content-length':declared});
        req.query=route==='tool'?{name:'github_whoami'}:{};
        const res=await call((a,b)=>handler(a,b,route),req);
        expect(res.statusCode,route+': '+String(declared)).toBe(400);
        expect(json(res).error.code).toBe('invalid_args');
      }
      const allowed=request('POST',payload,
        {authorization:'Bearer '+pass,'content-length':'32768'});
      allowed.query=route==='tool'?{name:'github_whoami'}:{};
      expect((await call((a,b)=>handler(a,b,route),allowed)).statusCode).toBe(200);
    }
    expect(dispatched).toBe(2);
  });
  it('prevents registry-driven meta wrappers from escaping the RTC pass area',async()=>{
    let foreignReads=0;
    const outside={name:'github_repo_private_read',area:'repos',description:'Outside pass area',
      inputSchema:{type:'object',properties:{},additionalProperties:false},
      annotations:{readOnlyHint:true},compact:true};
    const wrapped={tools:[...meta.tools,read,outside],handlers:{
      ...meta.handlers,github_whoami:async()=>({scope:'server'}),
      github_repo_private_read:async()=>{foreignReads++;return {scope:'repos'};}
    }};
    const db={getRtcPass:async()=>token,getAccount:async()=>account,
      consumeRtcPassRate:async()=>true};
    const handler=createRtcHttpHandler({db,registry:wrapped,dispatch:createDispatch()});
    const invoke=async(route,method,body,query={})=>{
      const req=request(method,method==='GET'?query:body,{authorization:'Bearer '+pass});
      req.query=query;
      return call((a,b)=>handler(a,b,route),req);
    };
    // Existing standalone MCP retains its complete guarded meta-tool registry.
    expect(wrapped.tools.some(t=>t.name==='github_batch')).toBe(true);
    const standalone=await createDispatch()({registry:wrapped,name:'github_batch',
      args:{calls:[{name:outside.name,args:{}}]},db,
      connection:{profile:'read_only',mode:'preview',client_id:token.client_id}});
    expect(standalone.isError).not.toBe(true);
    expect(foreignReads).toBe(1);
    foreignReads=0;
    // None of the registry-consuming wrappers may enter restricted HTTP;
    // the explicit HTTPS tools and batch routes remain available and scoped.
    expect(rtcHttpTools(wrapped).map(t=>t.name)).toEqual(['github_whoami']);
    expect(rtcManifest(wrapped).https_subset.counts.tools).toBe(1);
    const discovered=await invoke('tools','GET',{}, {listing:'catalog'});
    expect(json(discovered).result.tools.map(t=>t.name)).toEqual(['github_whoami']);
    for(const name of ['github_batch','github_search_tools','github_describe_tool',
      'github_call',outside.name]){
      const get=await invoke('tool','GET',{}, {name});
      expect(get.statusCode,name).toBe(404);
      const post=await invoke('tool','POST',{calls:[{name:outside.name,args:{}}]}, {name});
      expect(post.statusCode,name).toBe(404);
    }
    const nested=await invoke('batch','POST',{calls:[
      {name:'github_whoami',args:{}},{name:'github_batch',args:{calls:[{name:outside.name}]}}
    ]});
    expect(nested.statusCode).toBe(403);
    expect(foreignReads).toBe(0);
    expect((await invoke('tool','POST',{}, {name:'github_whoami'})).statusCode).toBe(200);
    expect((await invoke('batch','POST',{calls:[{name:'github_whoami',args:{}}]})).statusCode).toBe(200);
  });
  it('distinguishes caller validation from upstream read failures without leaking details',async()=>{
    const constrained={...read,name:'github_safe_probe',inputSchema:{type:'object',
      required:['target'],properties:{target:{type:'string',minLength:1}},
      additionalProperties:false}};
    const expected={...registry,tools:[...registry.tools,constrained]};
    let dispatches=0;
    const db={getRtcPass:async()=>token,getAccount:async()=>account,
      consumeRtcPassRate:async()=>true};
    let output={isError:true,content:[{type:'text',text:'provider secret in error'}]};
    const handler=createRtcHttpHandler({db,registry:expected,dispatch:async()=>{
      dispatches++;return output;
    }});
    const invoke=async(route,body)=>{
      const req=request('POST',body,{authorization:'Bearer '+pass});
      req.query=route==='tool'?{name:constrained.name}:{};
      return call((a,b)=>handler(a,b,route),req);
    };
    for(const body of [{},{target:''},{target:123},{target:'ok',extra:true}]){
      const response=await invoke('tool',body);
      expect(response.statusCode).toBe(400);
      expect(json(response).error.code).toBe('invalid_args');
    }
    expect(dispatches).toBe(0);
    const provider=await invoke('tool',{target:'ok'});
    expect(provider.statusCode).toBe(503);
    expect(json(provider).error.code).toBe('service_error');
    expect(provider.body).not.toContain('provider secret in error');
    expect(dispatches).toBe(1);
    // Error shape and missing results are never presented as successful null reads.
    for(const malformed of [undefined,{content:[{type:'text',text:'no structured reply'}]}]){
      output=malformed;
      const failed=await invoke('tool',{target:'ok'});
      expect(failed.statusCode).toBe(503);
      expect(json(failed).ok).toBe(false);
    }
    output={structuredContent:null};
    const legitimate=await invoke('tool',{target:'ok'});
    expect(legitimate.statusCode).toBe(200);
    expect(json(legitimate)).toMatchObject({ok:true,result:null,mode:'preview'});
    output={isError:true,content:[{type:'text',text:'private runtime text'}]};
    const batch=await invoke('batch',{calls:[{name:constrained.name,args:{target:'ok'}}]});
    expect(batch.statusCode).toBe(503);
    expect(batch.body).not.toContain('private runtime text');
  });
  it('never calls write tools and refuses write batches',async()=>{
    expect((await run('tool','POST',{}, {tool:'github_delete_repo'})).statusCode).toBe(404);
    expect((await run('batch','POST',{calls:[{name:'github_delete_repo',args:{confirm:true}}]})).statusCode).toBe(403);
    expect(json(await run('batch','POST',{calls:[{name:'github_whoami',args:{}}]})).result.results).toHaveLength(1);
  });
});
