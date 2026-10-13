import {describe,it,expect} from 'vitest';
import {probeRtcPublic} from '../../scripts/rtc-public-evidence.mjs';
const sha='a'.repeat(40);
const manifest={rtc:0,server:'robinson-github-mcp',prefix:'github',
  service_identity:{reported_revision:sha,independently_verified:false},
  https_subset:{authentication:'service_issued_pass',allow_writes:false,
    production_access:false,money_limit_cents:0}};
const documents={'/api/contract':{status:200,value:manifest},
  '/api/openapi.json':{status:200,value:{openapi:'3.1.0',paths:{
    '/api/whoami':{get:{operationId:'who'}}}}},
  '/api/whoami':{status:401,value:{ok:false,error:{code:'permission'}}}};
function mockFetch(overrides={}){
  const seen=[];
  const fetchImpl=async(url,options)=>{
    seen.push({url,options});
    const key=new URL(url).pathname;
    const response=overrides[key]??documents[key];
    if(!response)throw Error('Missing fixture');
    return {status:response.status,json:async()=>response.value};
  };
  return {seen,fetchImpl};
}
describe('credential-free RTC deployment evidence',()=>{
  it('checks exact supplied provider SHA, public contract, OpenAPI and missing pass refusal',async()=>{
    const mock=mockFetch();
    const result=await probeRtcPublic({origin:'https://github-mcp-xi.vercel.app',
      providerRevision:sha,fetchImpl:mock.fetchImpl});
    expect(result.ok).toBe(true);
    expect(result.advertised_rtc).toBe(0);
    expect(result.claimed_rtc1).toBe(false);
    expect(result.authenticated_acceptance).toBe(false);
    expect(result.hub_route_acceptance).toBe(false);
    expect(result.provider_revision_comparison).toBe('caller_supplied_not_retrieved');
    expect(mock.seen.map(x=>new URL(x.url).pathname)).toEqual([
      '/api/contract','/api/openapi.json','/api/whoami']);
    for(const {options} of mock.seen){
      expect(options.method).toBe('GET');
      expect(options.redirect).toBe('error');
      expect(options.headers).not.toHaveProperty('authorization');
      expect(options).not.toHaveProperty('body');
    }
  });
  it('refuses invalid targets before contacting the network',async()=>{
    for(const origin of ['http://github-mcp-xi.vercel.app','https://localhost',
      'https://127.0.0.1','https://host.test/path','https://host.test/?token=foo',
      'https://user:secret@host.test','not-a-url']){
      const mock=mockFetch();
      expect((await probeRtcPublic({origin,providerRevision:sha,
        fetchImpl:mock.fetchImpl})).ok,origin).toBe(false);
      expect(mock.seen).toHaveLength(0);
    }
    const mock=mockFetch();
    expect((await probeRtcPublic({origin:'https://host.test',providerRevision:'not-sha',
      fetchImpl:mock.fetchImpl})).ok).toBe(false);
    expect(mock.seen).toHaveLength(0);
  });
  it('rejects stale or unproved revision even when public routes respond',async()=>{
    for(const identity of [null,{reported_revision:sha,independently_verified:true},
      {reported_revision:'b'.repeat(40),independently_verified:false}]){
      const mock=mockFetch({'/api/contract':{status:200,value:{
        ...manifest,service_identity:identity}}});
      const result=await probeRtcPublic({origin:'https://host.test',
        providerRevision:sha,fetchImpl:mock.fetchImpl});
      expect(result.ok).toBe(false);
      expect(result.checks.find(c=>c.name==='exact_reported_revision').passed).toBe(false);
    }
  });
  it('fails closed for unexpected auth status, scope, OpenAPI and network errors',async()=>{
    for(const overrides of [
      {'/api/whoami':{status:200,value:{ok:true}}},
      {'/api/whoami':{status:403,value:{ok:false,error:{code:'permission'}}}},
      {'/api/contract':{status:200,value:{...manifest,https_subset:{
        ...manifest.https_subset,production_access:true}}}},
      {'/api/openapi.json':{status:200,value:{openapi:'2.0'}}},
      {'/api/contract':{status:503,value:{}}},
    ]){
      const mock=mockFetch(overrides);
      expect((await probeRtcPublic({origin:'https://host.test',providerRevision:sha,
        fetchImpl:mock.fetchImpl})).ok).toBe(false);
    }
    const result=await probeRtcPublic({origin:'https://host.test',providerRevision:sha,
      fetchImpl:async()=>{throw Error('secret remote detail');}});
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret remote detail');
  });
});
