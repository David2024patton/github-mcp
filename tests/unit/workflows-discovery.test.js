import {describe,it,expect} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {validateArgs} from '../../src/core/validate.js';
import {find,digest,newRepo} from '../../src/tools/workflows-find.js';
const owner='example-org',repo='app';
const envelope=data=>({structuredContent:data,content:[{type:'text',text:JSON.stringify(data)}]});
const options={merge_commit:true,squash:false,rebase:false,delete_branch_on_merge:true};
function fixture(extra={}){
  let clock=Date.parse('2026-10-15T12:00:00Z');const calls=[];
  const outputs={
    github_whoami:{accounts:[{login:owner,type:'Organization'}]},
    github_search_github:{items:[],total_count:0,incomplete_results:false,more_possible:false},
    github_repo_list:{items:[{name:repo}]},github_actions_list_runs:{items:[]},github_release_list:{items:[]},github_pr_list:{items:[]},
    github_security_list_alerts:{items:[],count:0,complete:true},github_org_list_invitations:{pending:[],failed:[],complete:true},
    github_billing_get_usage:{items:[],complete:true},
    github_workflow_project_setup:{stage:'complete',done:true},
    github_repo_get:{default_branch:'main',merge_options:options},github_branch_list:{items:[]},
    github_repo_get_vulnerability_alerts:{enabled:true},
    github_actions_get_settings:{workflow:{default_workflow_permissions:'read',can_approve_pull_request_reviews:false},fork:{approval_policy:'all_external_contributors'}},
    ...extra
  };
  const c={connection:{accounts:[owner],default_account:owner,profile:'full',mode:'preview'},now:()=>clock,
    callTool:async(name,args)=>{
      const tool=registry.tools.find(t=>t.name===name);expect(tool,name).toBeDefined();expect(validateArgs(tool.inputSchema,args),name).toBeNull();calls.push({name,args});
      const out=typeof outputs[name]==='function'?await outputs[name](args,calls):outputs[name];
      return out?.isError?out:envelope(out??{status:args.dryRun?'preview':'applied'});
    }};
  return {c,calls,outputs,advance:ms=>{clock+=ms;},at:date=>{clock=Date.parse(date);}};
}
const changed=w=>w.calls.filter(x=>['github_repo_create','github_repo_update_settings','github_branch_create','github_repo_set_default_branch','github_repo_set_vulnerability_alerts','github_actions_set_settings','github_security_set_feature'].includes(x.name));
const result=r=>r.structuredContent;
describe('W-7 mixed scoped discovery',()=>{
  it('searches all six object kinds and reports an honest empty result',async()=>{
    const w=fixture(),r=await find({repo,query:'auth fix'},w.c);
    expect(r.done).toBe(true);expect(r.groups.map(x=>x.kind)).toEqual(['repository','pull_request','issue','commit','run','release']);expect(changed(w)).toEqual([]);expect(w.calls.every(x=>registry.tools.find(t=>t.name===x.name)?.annotations?.readOnlyHint===true)).toBe(true);
  });
  it('finds repository/PR/issue/commit results and locally matches run/release metadata',async()=>{
    const w=fixture({github_search_github:a=>({items:a.type==='repository'?[{full_name:owner+'/'+repo}]:[{repository:owner+'/'+repo,number:4}],more_possible:false}),github_actions_list_runs:{items:[{id:1,name:'Auth fix',head_sha:'a'.repeat(40)}]},github_release_list:{items:[{id:2,tag_name:'v1',body:'Auth fix complete'}]}});
    const r=await find({repo,query:'auth fix'},w.c);expect(r.groups.every(g=>g.items.length===1)).toBe(true);
    expect(w.calls.find(x=>x.name==='github_search_github'&&x.args.type==='pull_request').args.query).toContain('repo:example-org/app');
  });
  it('uses account type for account-wide searches and bounded repository expansion',async()=>{
    const w=fixture(),r=await find({query:'auth'},w.c);expect(r.done).toBe(true);
    expect(w.calls.find(x=>x.name==='github_search_github'&&x.args.type==='issue').args.query).toContain('org:example-org');
    expect(w.calls.some(x=>x.name==='github_repo_list')).toBe(true);
  });
  it('preserves continuation/capped/foreign-scope evidence instead of false completeness',async()=>{
    const w=fixture({github_search_github:{items:[{repository:'foreign/app'}],more_possible:true},github_actions_list_runs:{items:[],more_exist:true},github_release_list:{items:[],next_page_possible:2}});
    const r=await find({repo,query:'auth'},w.c);expect(r.done).toBe(false);expect(r.groups[1].items).toEqual([]);expect(r.groups[1].next_page).toBe(2);expect(r.groups.at(-1).next_page).toBe(2);
  });
  it('does not dispatch foreign accounts or execute caller text as a tool',async()=>{
    const w=fixture();await expect(find({owner:'foreign',repo,query:'anything'},w.c)).rejects.toThrow(/not enrolled/);expect(w.calls).toEqual([]);
    await find({repo,query:'" repo:foreign/app github_repo_delete'},w.c);expect(changed(w)).toEqual([]);expect(w.calls.every(x=>registry.tools.find(t=>t.name===x.name)?.annotations?.readOnlyHint===true)).toBe(true);
  });
  it('returns partial on deadline without polling or writes',async()=>{
    const w=fixture({github_search_github:()=>{w.advance(47000);return {items:[]};}});expect((await find({repo,query:'auth'},w.c)).done).toBe(false);expect(w.calls).toHaveLength(1);expect(changed(w)).toEqual([]);expect(w.calls.every(x=>registry.tools.find(t=>t.name===x.name)?.annotations?.readOnlyHint===true)).toBe(true);
  });
});
describe('W-7 weekly digest uses actual date-bound billed cents',()=>{
  const billing=a=>({complete:true,items:[{date:new Date(Date.UTC(a.year,a.month-1,a.day)).toISOString(),product:'Actions',net_dollars:.1},{date:new Date(Date.UTC(a.year,a.month-1,a.day)).toISOString(),product:'Copilot',net_dollars:.2}]});
  it('covers seven complete days, merged PRs, CI rates, alerts and invitations',async()=>{
    const w=fixture({github_billing_get_usage:billing,github_pr_list:{items:[{number:1,merged_at:'2026-10-10T04:00:00Z'},{number:2,merged_at:null}]},github_actions_list_runs:{items:[{id:1,created_at:'2026-10-10T04:00:00Z',status:'completed',conclusion:'failure'},{id:2,created_at:'2026-10-11T04:00:00Z',status:'completed',conclusion:'success'}]},github_org_list_invitations:{pending:[{id:1}],failed:[],complete:true}});
    const r=await digest({},w.c),a=r.accounts[0];expect(r.done).toBe(true);expect(a.repositories[0].merged_prs).toHaveLength(1);expect(a.repositories[0].ci.failure_rate).toBe(.5);expect(a.pending_invitations.pending).toBe(1);
    expect(a.billed_usage).toMatchObject({actions_cents:70,copilot_cents:140,actions_display:'$0.70',copilot_display:'$1.40'});expect(w.calls.filter(x=>x.name==='github_billing_get_usage')).toHaveLength(7);expect(changed(w)).toEqual([]);expect(w.calls.every(x=>registry.tools.find(t=>t.name===x.name)?.annotations?.readOnlyHint===true)).toBe(true);
  });
  it('never double-counts Actions usage whose SKU mentions Copilot',async()=>{
    const w=fixture({github_billing_get_usage:a=>({complete:true,items:[{date:new Date(Date.UTC(a.year,a.month-1,a.day)).toISOString(),product:'Actions',sku:'copilot-runner',net_dollars:1}]})});
    const cost=(await digest({},w.c)).accounts[0].billed_usage;expect(cost.actions_cents).toBe(700);expect(cost.copilot_cents).toBe(0);
  });
  it('separates account scopes and handles month boundaries and Denver DST dates',async()=>{
    const other='personal';const w=fixture({github_whoami:{accounts:[{login:owner,type:'Organization'},{login:other,type:'User'}]},github_billing_get_usage:billing});
    w.c.connection.accounts.push(other);w.at('2026-11-04T12:00:00Z');const r=await digest({},w.c);
    expect(r.accounts).toHaveLength(2);expect(r.accounts[1].pending_invitations.status).toBe('not_applicable');
    const costs=w.calls.filter(x=>x.name==='github_billing_get_usage');expect(costs).toHaveLength(14);expect(new Set(costs.map(x=>x.args.month))).toEqual(new Set([10,11]));expect(costs.filter(x=>x.args.owner===other).every(x=>x.args.scope==='user')).toBe(true);
    expect(r.period.from_denver).toContain('6:00');expect(r.period.until_denver).toContain('5:00');
  });
  it('never turns unreadable, incomplete or wrong-date costs into zero spend',async()=>{
    for(const cost of [{isError:true,content:[{type:'text',text:'User sign-in missing'}]},{complete:false,items:[]},{complete:true,items:[{date:'2025-01-01',net_dollars:20,product:'Actions'}]},{complete:true},{complete:true,items:[{date:'2026-10-08',product:'Actions',net_dollars:null}]}]){
      const w=fixture({github_billing_get_usage:cost}),r=await digest({},w.c);expect(r.done).toBe(false);expect(r.accounts[0].billed_usage.actions_display).toBeNull();expect(r.accounts[0].billed_usage.copilot_cents).toBeNull();
    }
  });
  it('preserves inaccessible alert coverage and capped repositories',async()=>{
    const w=fixture({github_repo_list:{items:[{name:repo}],more_exist:true},github_security_list_alerts:{isError:true,content:[{type:'text',text:'Plan restriction'}]}});const r=await digest({},w.c);expect(r.done).toBe(false);expect(r.accounts[0].repositories[0].open_alerts.secret).toBeNull();
  });
  it('rejects foreign/duplicate accounts and stops at deadline',async()=>{
    const w=fixture();await expect(digest({accounts:['foreign']},w.c)).rejects.toThrow(/not enrolled/);await expect(digest({accounts:[owner,owner.toUpperCase()]},w.c)).rejects.toThrow(/distinct/);
    w.outputs.github_whoami=()=>{w.advance(47000);return {accounts:[]};};expect((await digest({},w.c)).done).toBe(false);expect(w.calls).toHaveLength(1);
  });
});
describe('W-7 standard repository stages preserve all independent guards',()=>{
  it('returns an independently observed configured repository without writes or profile activation',async()=>{
    const w=fixture(),r=result(await newRepo({repo},w.c));expect(r).toMatchObject({done:true,status:'configured'});expect(changed(w)).toEqual([]);
    expect(w.calls[0].args).toMatchObject({visibility:'private',requiredChecks:['ci'],environments:[],dryRun:true,confirm:false});
  });
  it('uses the existing durable draft checkpoint before creating anything',async()=>{
    const w=fixture({github_workflow_project_setup:a=>a.dryRun?{stage:'save_draft'}:{status:'draft_saved'}});
    const r=result(await newRepo({repo,confirm:true,requestKey:'new-repo'},w.c));expect(r.status).toBe('draft_saved');expect(w.calls.filter(x=>x.name==='github_workflow_project_setup')).toHaveLength(2);expect(changed(w)).toEqual([]);
  });
  it('previews private creation with initial main-capable history; public intent is never inferred',async()=>{
    const w=fixture({github_workflow_project_setup:{stage:'change',guardedTool:'github_repo_create',args:{owner,name:repo,visibility:'private',auto_init:false}}});
    const r=result(await newRepo({repo},w.c));expect(r.status).toBe('preview');expect(changed(w)[0].args).toMatchObject({visibility:'private',auto_init:true,dryRun:true,confirm:false});
  });
  it.each(['create-main','default-main','merge-policy','dependabot-alerts','actions-token','fork-approval'])('executes only the selected %s step with a stable scoped key',async step=>{
    const w=fixture();
    if(step==='create-main'||step==='default-main'){w.outputs.github_repo_get={default_branch:'master',merge_options:options};w.outputs.github_branch_list={items:step==='default-main'?[{name:'main'}]:[]};}
    if(step==='merge-policy')w.outputs.github_repo_get={default_branch:'main',merge_options:{...options,squash:true}};
    if(step==='dependabot-alerts')w.outputs.github_repo_get_vulnerability_alerts={enabled:false};
    if(step==='actions-token')w.outputs.github_actions_get_settings={workflow:{default_workflow_permissions:'write',can_approve_pull_request_reviews:true},fork:{approval_policy:'all_external_contributors'}};
    if(step==='fork-approval')w.outputs.github_actions_get_settings={workflow:{default_workflow_permissions:'read',can_approve_pull_request_reviews:false},fork:{approval_policy:'first_time_contributors'}};
    const args={repo,confirm:true,requestKey:'same-intent'},r=result(await newRepo(args,w.c));expect(r).toMatchObject({done:false,status:'step_applied',step});expect(changed(w)).toHaveLength(1);const key=changed(w)[0].args.requestKey;
    await newRepo(args,w.c);expect(changed(w)[1].args.requestKey).toBe(key);
    if(step==='fork-approval')expect(changed(w)[0].args.changes).toEqual({approval_policy:'all_external_contributors'});
  });
  it('continues independent defaults but retains private paid-feature owner review',async()=>{
    const w=fixture({github_workflow_project_setup:{stage:'needs_owner_review',conditional_feature:'secret_scanning'}});
    const r=result(await newRepo({repo},w.c));expect(r).toMatchObject({done:false,status:'partially_configured',conditional_security:{status:'owner_review_required'}});expect(changed(w)).toEqual([]);
  });
  it('does not take over existing content or execute an unexpected planned tool',async()=>{
    for(const plan of [{stage:'needs_owner_review',blockedStep:'Existing nonempty repository'},{stage:'change',guardedTool:'github_repo_delete',args:{owner,repo}}]){
      const w=fixture({github_workflow_project_setup:plan});expect(result(await newRepo({repo,confirm:true,requestKey:'intent'},w.c)).done).toBe(false);expect(changed(w)).toEqual([]);expect(w.calls).toHaveLength(1);
    }
  });
  it('refuses incomplete baseline, lower profile and missing execution key',async()=>{
    const w=fixture({github_actions_get_settings:{isError:true,content:[{type:'text',text:'HTTP422 policy unreadable'}]}});expect(result(await newRepo({repo},w.c)).status).toBe('not_readable');
    w.c.connection.profile='read_only';expect(result(await newRepo({repo},w.c)).status).toBe('refused');
    const changedPolicy=fixture({github_repo_get_vulnerability_alerts:{enabled:false}});expect(result(await newRepo({repo,confirm:true},changedPolicy.c)).status).toBe('refused');expect(changed(changedPolicy)).toEqual([]);
  });
  it('stops uncertain child effects and respects budget before every mutation',async()=>{
    const w=fixture({github_repo_get_vulnerability_alerts:{enabled:false},github_repo_set_vulnerability_alerts:{status:'uncertain'}});expect(result(await newRepo({repo,confirm:true,requestKey:'intent'},w.c)).status).toBe('uncertain');expect(changed(w)).toHaveLength(1);
    const timed=fixture({github_actions_get_settings:()=>{timed.advance(47000);return {workflow:{default_workflow_permissions:'write'},fork:{approval_policy:'first_time_contributors'}};}});expect(result(await newRepo({repo,confirm:true,requestKey:'intent'},timed.c)).status).toBe('pending');expect(changed(timed)).toEqual([]);
  });
});
