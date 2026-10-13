import {describe,it,expect} from 'vitest';
import {randomBytes} from 'node:crypto';
import {probeRtcAuthenticated,TRUSTED_RTC_LIVE_ORIGIN} from '../../scripts/rtc-auth-evidence.mjs';

const sha='a'.repeat(40);
const pass='rtc_pass_'+randomBytes(32).toString('base64url');
const manifest={rtc:0,server:'robinson-github-mcp',prefix:'github',
  service_identity:{reported_revision:sha,independently_verified:false},
  https_subset:{authentication:'service_issued_pass',production_access:false,
    allow_writes:false,money_limit_cents:0}};
const identity={mode:'preview',profile:'read_only',areas:['server','meta'],
  allow_writes:false,production_access:false,money_limit_cents:0,
  service_identity:{reported_revision:sha}};
const listing={count:1,next:null,tools:[{name:'github_whoami',area:'server',writes:false,money:false}]};
function mock({revoked=false,override={}}={}){
  const seen=[];
  const fetchImpl=async(url,options)=>{
    seen.push({url,options});
    const path=new URL(url).pathname;
    const key=path==='/api/tools'?'list':path;
    let payload=(path==='/api/whoami'&&options.headers.authorization
      ? override.authenticatedWhoami : undefined)??override[key];
    if(!payload){
      if(path==='/api/contract')payload={status:200,value:manifest};
      else if(path==='/api/openapi.json')payload={status:200,
        value:{openapi:'3.1.0',paths:{'/api/whoami':{get:{}}}}};
      else if(path==='/api/whoami'){
        payload=options.headers.authorization
          ? revoked?{status:401,value:{ok:false,error:{code:'pass_revoked'}}}
            :{status:200,value:{ok:true,result:identity}}
          :{status:401,value:{ok:false,error:{code:'permission'}}};
      }else if(path==='/api/tools')payload={status:200,value:{ok:true,result:listing}};
      else if(path==='/api/tools/github_whoami')payload={status:200,
        value:{ok:true,result:{mode:'PREVIEW',accounts:[]},mode:'preview'}};
      else if(path==='/api/tools/github_batch'||path==='/api/tools/github_enable_production')
        payload={status:404,value:{ok:false,error:{code:'not_found'}}};
      else throw Error('Unexpected fixture route');
    }
    return {status:payload.status,json:async()=>payload.value};
  };
  return {fetchImpl,seen};
}
const params=fetchImpl=>({origin:TRUSTED_RTC_LIVE_ORIGIN,providerRevision:sha,pass,
  phase:'read',fetchImpl});
describe('explicit protected service-owned RTC connected probe',()=>{
  it('checks real wire shapes with secret only on approved non-mutating routes',async()=>{
    const f=mock();
    const result=await probeRtcAuthenticated(params(f.fetchImpl));
    expect(result.ok).toBe(true);
    expect(result.authenticated_oauth_mcp).toBe(false);
    expect(result.hub_acceptance).toBe(false);
    expect(result.full_rtc1_conformance).toBe(false);
    expect(result.cleanup_acceptance).toBe(false);
    expect(result.provider_revision_independently_retrieved_by_script).toBe(false);
    expect(JSON.stringify(result)).not.toContain(pass);
    const names=f.seen.map(x=>new URL(x.url).pathname);
    expect(names).toEqual(['/api/contract','/api/openapi.json','/api/whoami',
      '/api/whoami','/api/tools','/api/tools/github_enable_production',
      '/api/tools/github_batch','/api/tools/github_whoami']);
    for(const [i,{options,url}] of f.seen.entries()){
      expect(options.redirect).toBe('error');
      expect(url).toMatch(/^https:\/\/github-mcp-xi\.vercel\.app\/api\//);
      if(i<3)expect(options.headers).not.toHaveProperty('authorization');
      else expect(options.headers.authorization).toBe('Bearer '+pass);
      if(options.method==='POST')expect(new URL(url).pathname).toBe('/api/tools/github_whoami');
    }
  });
  it('checks remote revocation in a distinct non-mutating phase',async()=>{
    const revoked=mock({revoked:true});
    const result=await probeRtcAuthenticated({...params(revoked.fetchImpl),phase:'revoked'});
    expect(result.ok).toBe(true);
    expect(result.checks.find(x=>x.name==='remote_pass_revoked').passed).toBe(true);
    expect(revoked.seen).toHaveLength(4);
    expect(revoked.seen.at(-1).options.headers.authorization).toBe('Bearer '+pass);
    const active=mock();
    expect((await probeRtcAuthenticated({...params(active.fetchImpl),phase:'revoked'})).ok).toBe(false);
  });
  it('refuses wrong origin, wrong revision, pass, phase before sending a secret',async()=>{
    for(const invalid of [{origin:'https://github-mcp-git-main-chris-projects-de6cd1bf.vercel.app'},
      {origin:'https://evil.example.com'},{providerRevision:'b'.repeat(40)},
      {pass:'not-a-real-pass'},{phase:'write'},{phase:undefined}]){
      const f=mock();
      const result=await probeRtcAuthenticated({...params(f.fetchImpl),...invalid});
      expect(result.ok).toBe(false);
      expect(f.seen.every(x=>!x.options.headers.authorization)).toBe(true);
    }
    const f=mock({override:{'/api/contract':{status:200,value:{
      ...manifest,service_identity:{reported_revision:'b'.repeat(40)}}}}});
    const result=await probeRtcAuthenticated(params(f.fetchImpl));
    expect(result.ok).toBe(false);
    expect(f.seen).toHaveLength(3);
    expect(f.seen.every(x=>!x.options.headers.authorization)).toBe(true);
  });
  it('fails closed on narrowed/expired scopes, unsafe catalog, absent denial or read failure',async()=>{
    const variants=[
      {authenticatedWhoami:{status:200,value:{ok:true,result:{
        ...identity,allow_writes:true}}}},
      {list:{status:200,value:{ok:true,result:{count:1,next:null,tools:[
        {name:'github_whoami',area:'repos',writes:false,money:false}]}}}},
      {list:{status:200,value:{ok:true,result:{count:2,next:2,tools:[
        {name:'github_whoami',area:'server',writes:false,money:false}]}}}},
      {'/api/tools/github_enable_production':{status:200,value:{ok:true}}},
      {'/api/tools/github_batch':{status:200,value:{ok:true}}},
      {'/api/tools/github_whoami':{status:503,value:{ok:false,error:{code:'service_error'}}}},
    ];
    for(const override of variants){
      const f=mock({override});
      const result=await probeRtcAuthenticated(params(f.fetchImpl));
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(pass);
    }
    const network=await probeRtcAuthenticated({...params(async()=>{throw Error('private body');})});
    expect(network.ok).toBe(false);
    expect(JSON.stringify(network)).not.toContain('private body');
  });
});
