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
  expires_at:new Date(Date.now()+3600000),revoked_at:null};
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
  });
  it('supports whoami, search, describe and guarded read call',async()=>{
    expect(json(await run('whoami')).result.profile).toBe('read_only');
    const list=json(await run('tools','GET',{}, {query:{listing:'catalog'}}));
    expect(list.result.tools.map(t=>t.name)).toEqual(['github_whoami']);
    expect(json(await run('tool')).result.name).toBe('github_whoami');
    expect(json(await run('tool','POST',{})).result.name).toBe('github_whoami');
  });
  it('never calls write tools and refuses write batches',async()=>{
    expect((await run('tool','POST',{}, {tool:'github_delete_repo'})).statusCode).toBe(404);
    expect((await run('batch','POST',{calls:[{name:'github_delete_repo',args:{confirm:true}}]})).statusCode).toBe(403);
    expect(json(await run('batch','POST',{calls:[{name:'github_whoami',args:{}}]})).result.results).toHaveLength(1);
  });
});
