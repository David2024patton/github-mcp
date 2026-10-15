import {describe,it,expect} from 'vitest';
import {makeWorld,runWriteContract,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import * as defs from '../../src/tools/apps-tokens.js';

const apps='GET /orgs/{org}/installations';
const inst='GET /user/installations/{installation_id}/repositories';
const repo='GET /repos/{owner}/{repo}';
const add='PUT /user/installations/{installation_id}/repositories/{repository_id}';
const reqs='GET /orgs/{org}/personal-access-token-requests';
const reqRepos='GET /orgs/{org}/personal-access-token-requests/{pat_request_id}/repositories';
const review='POST /orgs/{org}/personal-access-token-requests/{pat_request_id}';
const approved='GET /orgs/{org}/personal-access-tokens';
const allowed='GET /orgs/{org}/personal-access-tokens/{pat_id}/repositories';
const revoke='POST /orgs/{org}/personal-access-tokens/{pat_id}';
const app={id:3,app_id:11,app_slug:'safe-app',
  account:{login:'example-org'},repository_selection:'selected',
  permissions:{contents:'read'},events:[],suspended_at:null};
const r={id:42,full_name:'example-org/sample',private:true,
  permissions:{admin:true}};
const request={id:7,token_id:17,owner:{login:'alice'},
  repository_selection:'selected',permissions:{repository:{contents:'read'}},
  token_name:'build-agent',token_expired:false};
const grant={...request,id:9,access_granted_at:'2026-10-14T00:00:00Z'};
const seq=(gh,path,first,second)=>gh.when(path).replySequence([
  {status:200,body:first},{status:200,body:second}]);
const appSetup=(gh,result)=>{
  gh.when(apps).reply(200,{total_count:1,installations:[app]});
  gh.when(repo).reply(200,r);
  seq(gh,inst,{total_count:0,repositories:[]},
    {total_count:result==='ok'?1:0,repositories:result==='ok'?[r]:[]});
  gh.when(add).reply(204,null);
};
const approval=(gh,result)=>{
  seq(gh,reqs,[request],result==='ok'?[]:[request]);
  gh.when(reqRepos).reply(200,[r]);
  gh.when(review).reply(204,null);
  gh.when(approved).reply(200,result==='ok'?[grant]:[]);
};
const removal=(gh,result)=>{
  seq(gh,approved,[grant],result==='ok'?[]:[grant]);
  gh.when(allowed).reply(200,[r]);
  gh.when(revoke).reply(204,null);
};
const definition=name=>({tool:defs.tools.find(x=>x.name===name),
  handler:defs.handlers[name]});
for(const t of [
  {name:'github_app_set_installation_repos',
    args:{installationId:3,repo:'sample',action:'add'},
    arrange:appSetup,accessWidening:true,production:true},
  {name:'github_tokenpolicy_review_request',
    args:{requestId:7,action:'approve'},arrange:approval,
    accessWidening:true,production:true},
  {name:'github_tokenpolicy_revoke_access',
    args:{tokenId:9},arrange:removal,production:true}
]){
  runWriteContract({label:t.name,definition:definition(t.name),args:t.args,
    arrange:t.arrange,profile:'full',needsConfirm:true,
    production:t.production,accessWidening:t.accessWidening??false});
}
async function call(w,name,args={}){
  const dispatch=createDispatch({env:w.ctx.env,credentials:w.credentials,
    fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:[]});
  const response=await dispatch({registry,name,args,connection:w.connection,db:w.db});
  return response.structuredContent??parse(response);
}
describe('O-5 safe inventory and authorization boundaries',()=>{
  it('returns selected installation metadata without any token values',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when(apps).reply(200,{total_count:1,installations:[app]});
    const out=await call(w,'github_app_list_installations');
    expect(out.installations[0]).toMatchObject({id:3,app_slug:'safe-app'});
    expect(JSON.stringify(out)).not.toMatch(/access_token|client_secret/);
    expect(w.gh.invalid).toEqual([]);
  });
  it('reports token owner, expiry, permissions and no token bytes',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when(approved).reply(200,[grant]);
    const out=await call(w,'github_tokenpolicy_list_tokens');
    expect(out.tokens[0]).toMatchObject({owner:'alice',id:9});
    expect(JSON.stringify(out)).not.toMatch(/github_pat_/);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses to change an installation with all-repository selection',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(apps).reply(200,{total_count:1,installations:[
      {...app,repository_selection:'all'}]});
    const out=await call(w,'github_app_set_installation_repos',
      {installationId:3,repo:'sample',action:'remove',confirm:true});
    expect(out.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.method!=='GET')).toHaveLength(0);
  });
  it('refuses approval when pending request inventory is not readable',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(reqs).reply(403,{message:'Forbidden'});
    const out=await call(w,'github_tokenpolicy_review_request',
      {requestId:7,action:'approve',confirm:true});
    expect(out.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.method!=='GET')).toHaveLength(0);
  });
  it('registers exactly the seven O-5 catalog capabilities',()=>{
    expect(defs.tools).toHaveLength(7);
    for(const x of defs.tools)expect(registry.tools.some(t=>t.name===x.name)).toBe(true);
  });
});
