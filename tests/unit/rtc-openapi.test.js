import {describe,it,expect} from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import {randomBytes} from 'node:crypto';
import {rtcOpenApi} from '../../src/rtc/contract.js';
import {createRtcHttpHandler} from '../../src/rtc/http.js';
const doc=rtcOpenApi();
const resolve=ref=>ref.slice(2).split('/').reduce((v,key)=>v[key],doc);
const compile=name=>new Ajv2020({strict:false}).compile({...doc.components.schemas[name],components:doc.components});
const read={name:'github_whoami',area:'server',profiles:['read_only'],description:'Fixture read',
  annotations:{readOnlyHint:true},inputSchema:{type:'object',properties:{}},compact:true};
const pass='rtc_pass_'+randomBytes(32).toString('base64url');
async function call(route,{method='GET',query={},body={},authorized=true,limited=false}={}){
  const db={getRtcPass:async()=>({client_id:'rtc-'+'a'.repeat(24),default_account:'scratch-org',
    accounts:['scratch-org'],areas:['server','meta'],mode:'preview',profile:'read_only',listing:'compact',
    expires_at:new Date(Date.now()+60000),allow_writes:false,production_access:false,money_limit_cents:0}),
    getAccount:async()=>({login:'scratch-org',account_type:'Organization',is_scratch:true,
      production_enabled:false,installation_status:'active',repository_selection:'all'}),
    consumeRtcPassRate:async()=>!limited};
  const handler=createRtcHttpHandler({db,registry:{tools:[read]},
    dispatch:async()=>({structuredContent:{safe:true}})});
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},
    json(value){this.body=value;return this;}};
  await handler({method,query,body,headers:authorized?{authorization:'Bearer '+pass}:{}},res,route);
  return res;
}
describe('restricted RTC OpenAPI matches real wire behavior',()=>{
  it('declares every path placeholder, unique operation IDs and correct public/protected security',()=>{
    const ids=[];
    for(const [url,item] of Object.entries(doc.paths)){
      for(const method of ['get','post']){
        const op=item[method];if(!op)continue;ids.push(op.operationId);
        const params=[...(item.parameters??[]),...(op.parameters??[])];
        for(const token of url.matchAll(/\{([^}]+)\}/g))
          expect(params.find(p=>p.name===token[1]&&p.in==='path')).toMatchObject({required:true});
        expect(op.security).toEqual(['/api/contract','/api/openapi.json'].includes(url)?[]:[{rtcPass:[]}]);
        for(const r of Object.values(op.responses))if(r.$ref)expect(resolve(r.$ref)).toBeDefined();
      }
    }
    expect(new Set(ids).size).toBe(ids.length);expect(ids).toHaveLength(8);
    expect(Buffer.byteLength(JSON.stringify(doc),'utf8')).toBeLessThanOrEqual(8192);
  });
  it('documents direct tool arguments and batch shape, all bounds and no write authorization',async()=>{
    const tool=doc.paths['/api/tools/{name}'].post;
    expect(tool.requestBody.content['application/json'].schema).toMatchObject({type:'object'});
    expect(tool['x-max-utf8-bytes']).toBe(32768);
    const valid=compile('BatchRequest');
    for(const value of [{calls:[]},{calls:Array.from({length:11},()=>({name:read.name}))},
      {calls:[{name:read.name,args:null}]},{calls:[{name:read.name,args:[]}]},
      {calls:[{name:read.name,extra:true}]},{calls:[{name:read.name}],extra:true}]){
      expect(valid(value)).toBe(false);
      expect((await call('batch',{method:'POST',body:value})).code).toBe(400);
    }
    const value={calls:[{name:read.name},{name:read.name,args:{}}]};
    expect(valid(value)).toBe(true);expect((await call('batch',{method:'POST',body:value})).code).toBe(200);
  });
  it('validates actual success, authorization, malformed and rate-limit response envelopes',async()=>{
    const success=compile('Success'),error=compile('Error');
    for(const res of [await call('whoami'),await call('tools'),
      await call('tool',{method:'POST',query:{name:read.name},body:{}})])expect(success(res.body)).toBe(true);
    for(const res of [await call('whoami',{authorized:false}),await call('whoami',{limited:true}),
      await call('tools',{query:{limit:'101'}}),await call('tool',{query:{name:'github_outside_scope'}})]){
      expect(error(res.body)).toBe(true);expect(res.code).toBeGreaterThanOrEqual(400);
    }
    const rate=await call('whoami',{limited:true});
    expect(rate.headers['Retry-After']).toBe('60');
    expect(doc.components.responses.RateLimited.headers['Retry-After'].schema.const).toBe(60);
    expect(JSON.stringify(doc)).not.toContain(pass);
  });
  it('documents the exact supported numeric search and retained-result bounds',()=>{
    const search=doc.paths['/api/tools'].get.parameters;
    expect(search.find(p=>p.name==='limit').schema).toMatchObject({minimum:1,maximum:100,default:20});
    expect(search.find(p=>p.name==='page').schema.maximum).toBe(1000);
    const result=doc.paths['/api/results/{handle}'].get.parameters;
    expect(result.find(p=>p.name==='pageSize').schema.maximum).toBe(100);
    expect(result.find(p=>p.name==='offset').schema).toMatchObject({minimum:0,maximum:100000000});
    expect(result.find(p=>p.name==='fields')).toMatchObject({style:'form',explode:false,
      schema:{maxItems:20,items:{maxLength:64}}});
  });
});
