import {describe,it,expect} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {handlers as prWorkflows} from '../../src/tools/workflows-pr.js';
import {handlers as mergeWorkflows} from '../../src/tools/workflows-merge.js';

const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40);
const ready=(number=4,more={})=>({
  number,state:'open',merged:false,draft:false,head_sha:A,head:'feature-a',
  base:'main',mergeable:true,review_decision:'APPROVED',
  threads:{unresolved:0},updated_at:'2026-10-15T01:00:00Z',
  checks:{green:true,basis:'required',items:[{context:'ci',state:'success',
    started_at:'2026-10-15T02:00:00Z'}]},labels:[],html_url:'https://github.com/example-org/app/pull/'+number,...more
});
function fixture({prs={4:ready()},mode='preview',profile='full',time=Date.parse('2026-10-15T03:00:00Z'),extra={}}={}){
  const calls=[];
  let clock=time;
  const outputs={
    github_repo_get:{default_branch:'main'},
    github_pr_list:{items:[],count:0},
    github_pr_list_stacks:{items:[],count:0},
    ...extra
  };
  const response=x=>({structuredContent:x,content:[{type:'text',text:JSON.stringify(x)}]});
  const ctx={
    connection:{mode,profile,accounts:['example-org'],default_account:'example-org'},
    now:()=>clock,
    callTool:async(name,args)=>{
      calls.push({name,args});
      const value=name==='github_pr_get'?prs[args.number]??null:outputs[name];
      if(typeof value==='function')return response(await value(args,prs,calls));
      return value===null?{isError:true,content:[{type:'text',text:'unreadable'}]}:response(value??{status:'preview'});
    }
  };
  return {ctx,calls,prs,outputs,advance:ms=>{clock+=ms;}};
}
const body=r=>r.structuredContent;
const writes=x=>x.calls.filter(c=>['github_pr_create','github_pr_merge','github_pr_update',
  'github_issue_set_labels'].includes(c.name));

describe('W-1 full PR status and resumable guarded open',()=>{
  it('registers both approved workflows with correct read-versus-change marks',()=>{
    for(const name of ['github_workflow_pr_status','github_workflow_open_pr',
      'github_workflow_merge_when_green','github_workflow_merge_stack'])
      expect(registry.tools.find(t=>t.name===name)).toBeDefined();
    expect(registry.tools.find(t=>t.name==='github_workflow_pr_status').annotations.readOnlyHint).toBe(true);
    expect(registry.tools.find(t=>t.name==='github_workflow_open_pr').passthrough).toBe(true);
  });
  it('reports exact CI, review decision, stack position and next action without a write',async()=>{
    const f=fixture({extra:{github_pr_list_stacks:{items:[{
      number:22,pull_requests:[{number:4},{number:5}]}],count:1}}});
    const got=await prWorkflows.github_workflow_pr_status({repo:'app',number:4},f.ctx);
    expect(got.checks.green).toBe(true);
    expect(got.stack.items[0]).toMatchObject({stack:22,position:1,number:4});
    expect(got.can_request_merge).toBe(true);
    expect(writes(f)).toEqual([]);
  });
  it('does not disguise missing review/CI evidence as safe to merge',async()=>{
    const f=fixture({prs:{4:ready(4,{threads:{unknown:'forbidden'},checks:{green:null}})}});
    const got=await prWorkflows.github_workflow_pr_status({repo:'app',number:4},f.ctx);
    expect(got.can_request_merge).toBe(false);
    expect(got.next_action).toMatch(/review threads could not be verified/i);
  });
  it('opens a PR through guarded writer with every confirmation/notification policy still delegated',async()=>{
    const f=fixture({extra:{github_pr_create:{status:'applied',number:21}}});
    const x=body(await prWorkflows.github_workflow_open_pr({
      repo:'app',head:'feature-a',title:'Real title',body:'@outsider please review',
      labels:['bug'],confirm:true,requestKey:'w1-open'},f.ctx));
    expect(x.status).toBe('pr_opened');
    expect(writes(f).map(c=>c.name)).toEqual(['github_pr_create']);
    expect(writes(f)[0].args).toMatchObject({head:'feature-a',base:'main',
      title:'Real title',confirm:true,requestKey:'w1-open:create'});
    expect(x.done).toBe(false);
  });
  it('returns an already open PR and adds only missing labels through issue guard on separate invocation',async()=>{
    const f=fixture({prs:{4:ready(4,{labels:['ready']})},extra:{
      github_pr_list:{items:[{number:4,head:{ref:'feature-a'},base:{ref:'main'}}]},
      github_issue_set_labels:{status:'applied'}
    }});
    const request={repo:'app',head:'feature-a',title:'Real title',labels:['ready','bug'],confirm:true};
    const x=body(await prWorkflows.github_workflow_open_pr(request,f.ctx));
    expect(x.status).toBe('labels_applied');
    expect(writes(f)).toHaveLength(1);
    expect(writes(f)[0]).toMatchObject({name:'github_issue_set_labels',
      args:{number:4,mode:'add',labels:['bug'],confirm:true}});
    f.prs[4].labels.push('bug');
    const done=body(await prWorkflows.github_workflow_open_pr(request,f.ctx));
    expect(done).toMatchObject({status:'existing',done:true,number:4});
    expect(writes(f)).toHaveLength(1);
  });
  it('refuses incomplete idempotence inventory, bad profile, duplicate labels and time budget',async()=>{
    const f=fixture({extra:{github_pr_list:{items:[],more_exist:true}}});
    expect(body(await prWorkflows.github_workflow_open_pr({
      repo:'app',head:'feature-a',title:'x',confirm:true},f.ctx)).status).toBe('refused');
    expect(writes(f)).toHaveLength(0);
    const narrow=fixture({profile:'read_only'});
    expect(body(await prWorkflows.github_workflow_open_pr({
      repo:'app',head:'feature-a',title:'x',confirm:true},narrow.ctx)).status).toBe('refused');
    const dup=fixture();
    expect(body(await prWorkflows.github_workflow_open_pr({
      repo:'app',head:'feature-a',title:'x',labels:['a','a'],confirm:true},dup.ctx)).status).toBe('refused');
    const timeout=fixture({extra:{github_repo_get:()=>{timeout.advance(48000);return {default_branch:'main'};}}});
    expect(body(await prWorkflows.github_workflow_open_pr({
      repo:'app',head:'feature-a',title:'x',confirm:true},timeout.ctx)).status).toBe('pending');
    expect(writes(timeout)).toHaveLength(0);
  });
});

describe('W-2 exact-head and one-step stack conveyor',()=>{
  const args={repo:'app',number:4,expectedHeadSha:A,confirm:true,requestKey:'w2-merge'};
  it('refuses stale SHA, draft, conflicts, missing CI, unreadable threads, and review rejection',async()=>{
    const cases=[
      {head_sha:B},{draft:true},{mergeable:false},{checks:{green:null}},
      {threads:{unknown:'provider denied'}},{threads:{unresolved:2}},
      {review_decision:'CHANGES_REQUESTED'},{base:'feature-parent'}
    ];
    for(const changes of cases){
      const f=fixture({prs:{4:ready(4,changes)},extra:{github_pr_merge:{status:'applied'}}});
      const x=body(await mergeWorkflows.github_workflow_merge_when_green(args,f.ctx));
      expect(x.done).toBe(false);
      expect(x.status).toBe('not_ready');
      expect(writes(f)).toHaveLength(0);
    }
  });
  it('delegates exact head, merge method and independent guarded confirm; verifies provider readback',async()=>{
    const f=fixture({extra:{github_pr_merge:(a,prs)=>{
      prs[4]={...prs[4],state:'closed',merged:true};
      return {status:'applied',number:4,merged:true,merge_commit:C};
    }}});
    const x=body(await mergeWorkflows.github_workflow_merge_when_green(args,f.ctx));
    expect(x).toMatchObject({status:'merged',done:true,number:4});
    expect(writes(f)).toHaveLength(1);
    expect(writes(f)[0].args).toMatchObject({
      expectedHeadSha:A,method:'merge',confirm:true,requestKey:'w2-merge:4'});
  });
  it('never calls a mutating writer if the requested head is green but the review is unknown',async()=>{
    const f=fixture({prs:{4:ready(4,{threads:{unknown:'graphql outage'}})}});
    const x=body(await mergeWorkflows.github_workflow_merge_when_green(args,f.ctx));
    expect(x.blockers).toEqual(expect.arrayContaining([expect.stringMatching(/threads could not/i)]));
    expect(writes(f)).toHaveLength(0);
  });
  it('retargets an ordered stack bottom-up and returns without merging the stack parent',async()=>{
    const f=fixture({prs:{
      4:ready(4,{head_sha:A,head:'feature-a',base:'main'}),
      5:ready(5,{head_sha:B,head:'feature-b',base:'feature-a'})
    },extra:{github_pr_merge:(a,prs)=>{
      prs[a.number]={...prs[a.number],state:'closed',merged:true};
      return {status:'applied'};
    },github_pr_update:(a,prs)=>{
      prs[a.number]={...prs[a.number],base:a.base,updated_at:'2026-10-15T02:59:00Z'};
      return {status:'applied'};
    }}});
    const input={repo:'app',prs:[4,5],expectedHeadShas:[A,B],confirm:true,requestKey:'stack'};
    let x=body(await mergeWorkflows.github_workflow_merge_stack(input,f.ctx));
    expect(x).toMatchObject({status:'merged_one',number:4,done:false});
    x=body(await mergeWorkflows.github_workflow_merge_stack(input,f.ctx));
    expect(x).toMatchObject({status:'retargeted',number:5});
    expect(f.prs[5].base).toBe('main');
    expect(writes(f)[1].args.expectedHeadSha).toBe(B);
    x=body(await mergeWorkflows.github_workflow_merge_stack(input,f.ctx));
    expect(x).toMatchObject({status:'pending_fresh_ci',number:5});
    expect(writes(f).map(c=>c.name)).toEqual(['github_pr_merge','github_pr_update']);
    f.prs[5].checks.items[0].started_at='2026-10-15T03:00:00Z';
    x=body(await mergeWorkflows.github_workflow_merge_stack(input,f.ctx));
    expect(x.status).toBe('merged_one');
    expect(writes(f).map(c=>c.name)).toEqual([
      'github_pr_merge','github_pr_update','github_pr_merge']);
    x=body(await mergeWorkflows.github_workflow_merge_stack(input,f.ctx));
    expect(x.status).toBe('complete');
  });
  it('rejects out-of-order chain, changed expected SHAs and missing timed check evidence',async()=>{
    const f=fixture({prs:{4:ready(4),5:ready(5,{head:'feature-b',head_sha:B,base:'other'})}});
    let x=body(await mergeWorkflows.github_workflow_merge_stack({
      repo:'app',prs:[4,5],confirm:true},f.ctx));
    expect(x.status).toBe('refused');
    x=body(await mergeWorkflows.github_workflow_merge_stack({
      repo:'app',prs:[4,5],expectedHeadShas:[B,B],confirm:true},f.ctx));
    expect(x.reason).toMatch(/advanced/i);
    expect(writes(f)).toHaveLength(0);
  });
});
