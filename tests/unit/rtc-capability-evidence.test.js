import {describe,it,expect,vi,afterEach} from 'vitest';
import {randomBytes} from 'node:crypto';
import {rtcManifest} from '../../src/rtc/contract.js';
import {rtcHttpTools,rtcIdentity} from '../../src/rtc/scope.js';
import {createRtcHttpHandler} from '../../src/rtc/http.js';
const read=(name,area,extra={})=>({name,area,description:'Fixture read',profiles:['read_only'],
  inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true},...extra});
const tools=[read('github_whoami','server'),read('github_search_tools','meta'),
  read('github_repo_get','repos'),read('github_unsafe_write','server',{writes:true}),
  read('github_passthrough','meta',{passthrough:true}),
  read('github_unannotated','server',{annotations:{}})];
const registry={tools};
afterEach(()=>vi.unstubAllEnvs());
describe('truthful standalone and restricted HTTP capability evidence',()=>{
  it('keeps total provider catalog separate from exactly callable HTTP reads',()=>{
    const manifest=rtcManifest(registry);
    expect(manifest).toMatchObject({rtc:0,adoption:'in_progress',counts:{tools:6,writes:1},
      modes:['preview','production'],standalone_mcp:{authentication:'oauth',independent:true},
      https_subset:{modes:['preview'],profiles:['read_only'],areas:['server','meta'],
        counts:{tools:2,writes:0,money:0},allow_writes:false,production_access:false,
        full_conformance_verified:false,authenticated_acceptance_verified:false}});
    expect(rtcHttpTools(registry).map(t=>t.name)).toEqual(['github_whoami','github_search_tools']);
  });
  it('reports only canonical build hashes and labels them as unverified self-report',()=>{
    const sha='a'.repeat(40);expect(rtcIdentity(sha)).toMatchObject({reported_revision:sha,
      revision_source:'vercel_git_commit_sha',independently_verified:false});
    for(const value of ['',null,'b'.repeat(39),'a'.repeat(41),'A'.repeat(40),
      'https://example.test/path?token=ghp_FAKE_VALUE',{}])
      expect(rtcIdentity(value)).toMatchObject({reported_revision:null,revision_source:null});
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA',sha);
    expect(rtcManifest(registry).service_identity.reported_revision).toBe(sha);
  });
  it('uses the same allowlist for evidence and dispatch without expanding permission',async()=>{
    const pass='rtc_pass_'+randomBytes(32).toString('base64url'),calls=[];
    const db={getRtcPass:async()=>({client_id:'rtc-'+'a'.repeat(24),default_account:'scratch-org',
      accounts:['scratch-org'],areas:['server','meta'],mode:'preview',profile:'read_only',listing:'compact',
      expires_at:new Date(Date.now()+60000),allow_writes:false,production_access:false,money_limit_cents:0}),
      getAccount:async()=>({login:'scratch-org',is_scratch:true,production_enabled:false,account_type:'Organization',
        installation_status:'active',repository_selection:'all'}),consumeRtcPassRate:async()=>true};
    const handler=createRtcHttpHandler({db,registry,dispatch:async({name})=>{
      calls.push(name);return {structuredContent:{name}};}});
    for(const tool of tools){
      const res={setHeader(){},status(code){this.code=code;return this;},json(value){this.body=value;return this;}};
      await handler({method:'POST',headers:{authorization:'Bearer '+pass},query:{name:tool.name},body:{}},res,'tool');
      expect(res.code).toBe(rtcHttpTools(registry).includes(tool)?200:404);
    }
    expect(calls).toEqual(['github_whoami','github_search_tools']);
  });
});
