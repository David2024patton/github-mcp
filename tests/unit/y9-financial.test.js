import { describe, it, expect } from 'vitest';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import * as copilot from '../../src/tools/y9-copilot.js';
import * as sponsor from '../../src/tools/y9-sponsorship.js';
import * as hosted from '../../src/tools/y9-hosted-runners.js';
import * as agent from '../../src/tools/y9-agent-tasks.js';
import { registry } from '../../src/tools/index.js';

const defs=[...copilot.tools,...sponsor.tools,...hosted.tools,...agent.tools];
const call=async (module,name,w,args)=>{ const reply=await module.handlers[name](args,w.ctx); return module.tools.find(x=>x.name===name)?.readContract?reply:parse(reply); };
describe('Y-9d financial and Copilot integration',()=>{
  it('registers every named capability exactly once with its advertised permission profile',()=>{
    const names=defs.map(x=>x.name);
    expect(new Set(names).size).toBe(14);
    for(const name of names){
      expect(registry.tools.some(x=>x.name===name)).toBe(true);
      const def=defs.find(x=>x.name===name);
      expect(def.name.startsWith('github_')).toBe(true);
      if(def.writes){expect(def.declarations.confirm).toBe('always');expect(def.profiles).toContain('full');}
    }
  });
  it('prevents any hosted-runner update from a PREVIEW connection',async()=>{
    const w=await makeWorld({mode:'preview',profile:'full'});
    w.gh.when('GET /orgs/{org}/actions/hosted-runners/{hosted_runner_id}')
      .reply(200,{id:18,name:'linux-large',maximum_runners:10,status:'ready'});
    const r=await call(hosted,'github_hosted_runner_manage',w,{runnerId:18,action:'update',name:'safer'});
    expect(r.status).toBe('refused_by_guard');
    expect(r.refusedBy).toBe('mode');
    expect(w.gh.calls.some(x=>x.method==='PATCH'||x.method==='DELETE')).toBe(false);
  });
  it('supports read-only hosted-runner inventory without a write',async()=>{
    const w=await makeWorld({mode:'preview',profile:'read_only'});
    w.gh.when('GET /orgs/{org}/actions/hosted-runners').reply(200,{
      total_count:1,runners:[{id:18,name:'linux-large',maximum_runners:5}]});
    const r=await call(hosted,'github_hosted_runner_list',w,{});
    expect(r.complete).toBe(true);
    expect(r.runners[0]).toMatchObject({name:'linux-large',maximum_runners:5});
    expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
  });
  it('Cloud agent expansion never starts in PREVIEW',async()=>{
    const w=await makeWorld({mode:'preview',profile:'full'});
    w.gh.when('GET /orgs/{org}/copilot/coding-agent/permissions')
      .reply(200,{enabled_repositories:'none'});
    const result=await call(copilot,'github_copilot_agent_policy_set',w,
      {enabledRepositories:'all',confirm:true});
    expect(result.status).toBe('refused_by_guard');
    expect(w.gh.calls.filter(x=>x.method==='PUT')).toHaveLength(0);
  });
  it('requires a real user principal for paid Sponsorship changes',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when('GET /user').reply(403,{message:'no user authorization'});
    const result=await call(sponsor,'github_sponsor_set',w,
      {recipient:'example-maintainer',action:'start',tierId:'tier001',confirm:true});
    expect(result.done).toBe(false);
    expect(w.gh.calls.every(x=>x.method!=='POST'||x.route!=='POST /graphql')).toBe(true);
  });
  it('agent task plan never starts billable work, even for a valid repository',async()=>{
    const w=await makeWorld({mode:'preview',profile:'read_only'});
    w.gh.when('GET /user').reply(200,{id:10,login:'example-owner'});
    w.gh.when('GET /repos/{owner}/{repo}').reply(200,{
      full_name:'example-org/test-repo',default_branch:'main',archived:false,disabled:false});
    const result=await call(agent,'github_copilot_agent_task_plan',w,
      {repo:'test-repo',prompt:'Review the pull request and add a test'});
    expect(result.status).toBe('guided');
    expect(result.completed).toBe(false);
    expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
  });
});
