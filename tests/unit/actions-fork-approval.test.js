import { describe,expect,it } from 'vitest';
import { runWriteContract,makeWorld,parse } from '../../test/helpers/write-contract.js';
import { protectionGate } from '../../test/helpers/fixture-gates.js';
import * as api from '../../src/tools/actions-fork-approval.js';
const H='a'.repeat(40), R={repo:'hello',prNumber:23,runId:9,expectedHeadSha:H};
const PR='GET /repos/{owner}/{repo}/pulls/{pull_number}';
const FILES='GET /repos/{owner}/{repo}/pulls/{pull_number}/files';
const RUN='GET /repos/{owner}/{repo}/actions/runs/{run_id}';
const POST='POST /repos/{owner}/{repo}/actions/runs/{run_id}/approve';
const pull=()=>({number:23,state:'open',changed_files:2,user:{login:'contrib'},
  head:{sha:H,repo:{full_name:'contrib/hello',fork:true}},
  base:{ref:'main',repo:{full_name:'example-org/hello'}}});
const run=(x={})=>({id:9,event:'pull_request',status:'completed',conclusion:'action_required',
  path:'.github/workflows/ci.yml',head_sha:H,actor:{login:'contrib'},
  head_repository:{full_name:'contrib/hello'},pull_requests:[{number:23}],...x});
function seed(gh,outcome='ok',opts={}){
  const pr=opts.pr??pull(), first=opts.first??run();
  gh.when('GET /repos/{owner}/{repo}').reply(200,opts.repo??{private:false,visibility:'public',default_branch:'main'});
  gh.when(PR).reply(200,pr);
  if(opts.pages)gh.when(FILES).replySequence([...opts.pages,...opts.pages].map(body=>({status:200,body})));
  else gh.when(FILES).reply(200,opts.files??[{filename:'src/x.js'},{filename:'tests/unit/x.test.js'}]);
  gh.when('GET /repos/{owner}/{repo}/git/commits/{commit_sha}').reply(200,
    opts.mergeCommit??{sha:first.head_sha,parents:[{sha:'c'.repeat(40)},{sha:'d'.repeat(40)}]});
  const wf=opts.workflow??'jobs:\n  test:\n    runs-on: ubuntu-latest\n';
  gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200,{encoding:'base64',content:Buffer.from(wf).toString('base64')});
  gh.when(RUN).replySequence([first,first,outcome==='ok'?run({...first,status:'queued',conclusion:null}):first]
    .map(body=>({status:200,body})));
  gh.when(POST).reply(201,{});
}
const definition={tool:api.tools[0],handler:api.handlers.github_actions_approve_fork_run};
runWriteContract({label:'github_actions_approve_fork_run',definition,args:R,needsConfirm:true,
  profile:'full',conveyor:true,
  gatesFor:({protectedLevel})=>protectedLevel==='locked'?[protectionGate('locked')]:[],
  arrange:seed});
describe('fork run identity and safety',()=>{
  async function invoke(opts={},args=R,profile='full',mode='preview'){
    const w=await makeWorld({profile,mode});seed(w.gh,'ok',opts);
    const result=parse(await api.handlers.github_actions_approve_fork_run({...args,confirm:true},w.ctx));
    return {result,post:w.gh.calls.filter(x=>x.route===POST),invalid:w.gh.invalid};
  }
  it('approves a genuine synthetic PR merge SHA with the reviewed head as a parent',async()=>{
    const merged='b'.repeat(40);
    const x=await invoke({first:run({head_sha:merged}),mergeCommit:{
      sha:merged,parents:[{sha:'c'.repeat(40)},{sha:H}]}});
    expect(x.result.done).toBe(true);
    expect(x.post).toHaveLength(1);
    expect(x.invalid).toEqual([]);
  });
  it('supports a PR with more than 100 changed files when every file is verifiable',async()=>{
    const first=Array.from({length:100},(_,i)=>({filename:'src/f'+i+'.js'}));
    const x=await invoke({pr:{...pull(),changed_files:101},pages:[first,[{filename:'src/last.js'}]]});
    expect(x.result.done).toBe(true);
    expect(x.post).toHaveLength(1);
    expect(x.invalid).toEqual([]);
  });
  it('rejects stale or internal PRs without an approval request',async()=>{
    for(const pr of [{...pull(),head:{...pull().head,sha:'b'.repeat(40)}},
                     {...pull(),state:'closed'},
                     {...pull(),head:{...pull().head,repo:{full_name:'example-org/hello',fork:false}}}]){
      const x=await invoke({pr});expect(x.result.done).toBe(false);expect(x.post).toHaveLength(0);
    }
  });
  it('refuses synthetic merge commits that do not contain the current reviewed head',async()=>{
    const x=await invoke({first:run({head_sha:'b'.repeat(40)}),
      mergeCommit:{sha:'b'.repeat(40),parents:[{sha:'c'.repeat(40)},{sha:'d'.repeat(40)}]}});
    expect(x.result.done).toBe(false);
    expect(x.post).toHaveLength(0);
  });
  it('rejects unrelated, already approved and non-pull_request runs',async()=>{
    for(const first of [run({event:'workflow_dispatch'}),run({head_sha:'b'.repeat(40)}),
                       run({conclusion:'success'}),run({id:10}),run({pull_requests:[{number:24}]})]){
      const x=await invoke({first});expect(x.result.done).toBe(false);expect(x.post).toHaveLength(0);
    }
  });
  it('rejects private repos, incomplete lists, workflow changes and read-only clients',async()=>{
    for(const opts of [{repo:{private:true,visibility:'private'}},{files:[{filename:'x.js'}]},
      {files:[{filename:'.github/workflows/ci.yml'},{filename:'x.js'}]}]){
      const x=await invoke(opts);expect(x.result.done).toBe(false);expect(x.post).toHaveLength(0);
    }
    const x=await invoke({},R,'read_only');expect(x.result.done).toBe(false);expect(x.post).toHaveLength(0);
  });
  it('refuses a workflow that declares production deployment',async()=>{
    const x=await invoke({workflow:'jobs:\n  deploy:\n    runs-on: ubuntu-latest\n    environment: production\n'});
    expect(x.result.done).toBe(false);expect(x.post).toHaveLength(0);
  });
});
