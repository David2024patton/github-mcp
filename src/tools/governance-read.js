// H-1: exact classic protection, org/repo rulesets and rule-suite diagnostics.
import {listAll} from '../github/client.js';
import {defineRead} from './define-read.js';
import {plain,readerFor} from './github-read.js';
import {missing} from './github-write.js';
const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const BRANCH={type:'string',minLength:1,maxLength:255},ID={type:'integer',minimum:1};
const MAX={type:'integer',minimum:1,maximum:100};
const project=(a)=>{if(a.scope==='org'&&a.repo)throw new TypeError('An organization ruleset has no repository.');if(a.scope!=='org'&&!a.repo)throw new TypeError('Repository rulesets require repo.');};
const loc=a=>a.scope==='org'?{org:a.owner}:{owner:a.owner,repo:a.repo};
const route=(a,what)=>{
  const prefix=a.scope==='org'?'/orgs/{org}/rulesets':'/repos/{owner}/{repo}/rulesets';
  return 'GET '+prefix+what;
};
const ruleWords=r=>r.type==='required_status_checks'
  ?`Required checks: ${(r.parameters?.required_status_checks??[]).slice(0,25).map(s=>s.context).filter(Boolean).join(', ')||'not listed'}`
  :r.type==='non_fast_forward'?'Force pushes blocked'
  :r.type==='deletion'?'Deletion blocked'
  :`Rule: ${r.type}`;
const view=r=>({id:r.id,node_id:r.node_id,name:r.name,target:r.target,source:r.source,
  source_type:r.source_type,enforcement:r.enforcement,updated_at:r.updated_at,
  conditions:r.conditions??null,bypass_actors:Array.isArray(r.bypass_actors)
    ?r.bypass_actors.slice(0,100).map(a=>({actor_id:a.actor_id,
      actor_type:a.actor_type,bypass_mode:a.bypass_mode})):null,
  bypass_actors_truncated:(r.bypass_actors?.length??0)>100,
  rules:Array.isArray(r.rules)?r.rules.slice(0,100).map(q=>({
    type:q.type,parameters:q.parameters??null,description:ruleWords(q)})):null,
  rules_truncated:(r.rules?.length??0)>100});
const suite=x=>({id:x.id,ref:x.ref,actor:x.actor_name??null,
  result:x.result,evaluation_result:x.evaluation_result??null,
  pushed_at:x.pushed_at,repository_name:x.repository_name??null,
  rules:(x.rule_evaluations??[]).slice(0,100).map(q=>({
    source:q.rule_source?.name??q.rule_source?.type??null,type:q.rule_type,
    enforcement:q.enforcement,result:q.result,details:q.details??null}))});
const maxScan=async(gh,r,p,max)=>{
  const o=await listAll(gh,r,{...p,per_page:100},{max});
  return {count:o.items.length,items:o.items,complete:!o.capped,
    ...(o.capped?{warning:'At the requested cap; inventory may be incomplete.'}:{})};
};
export const protectionGet=defineRead({
  name:'github_protection_get',area:'protection',audience:['B','O'],
  description:'Inspect exact branch classic protections without confusing them with inherited rulesets.',
  properties:{owner:OWNER,repo:REPO,branch:BRANCH},required:['repo','branch'],
  handler:(a,ctx)=>plain(async()=>{
    const {owner,octokit:gh}=await readerFor(a,ctx),p={owner,repo:a.repo,branch:a.branch};
    const b=(await gh.request('GET /repos/{owner}/{repo}/branches/{branch}',p)).data;
    if(!b?.name||b.name!==a.branch)throw new TypeError('Could not verify the exact branch.');
    const d=await missing(async()=>(await gh.request(
      'GET /repos/{owner}/{repo}/branches/{branch}/protection',p)).data);
    return {owner,repo:a.repo,branch:b.name,sha:b.commit?.sha??null,
      protected:b.protected===true,
      classic_protection_readable:!!d,
      ...(d?{classic:{
        required_status_checks:d.required_status_checks?{
          strict:d.required_status_checks.strict,
          contexts:d.required_status_checks.contexts??[],
          checks:d.required_status_checks.checks??[]}:null,
        required_pull_request_reviews:d.required_pull_request_reviews??null,
        enforce_admins:d.enforce_admins?.enabled??null,
        restrictions:d.restrictions??null,
        required_conversation_resolution:d.required_conversation_resolution?.enabled??null,
        allow_force_pushes:d.allow_force_pushes?.enabled??null,
        allow_deletions:d.allow_deletions?.enabled??null
      }}:{warning:'Classic protection was not readable; do not infer absence of effective repository/organization rulesets.'})};
  })
});
const base={owner:OWNER,repo:REPO,scope:{type:'string',enum:['repo','org']}};
export const rulesetList=defineRead({
  name:'github_ruleset_list',area:'ruleset',audience:['B','O'],
  description:'List bounded repository or organization rulesets with source and enforcement.',
  properties:{...base,max:MAX},
  handler:(a,ctx)=>plain(async()=>{
    const {owner,octokit:gh}=await readerFor(a,ctx),p={...a,owner};project(p);
    const result=await maxScan(gh,route(p,''),loc(p),a.max??100);
    return {owner,scope:a.scope??'repo',...(a.repo?{repo:a.repo}:{}),
      ...result,items:result.items.map(view)};
  })
});
export const rulesetGet=defineRead({
  name:'github_ruleset_get',area:'ruleset',audience:['B','O'],
  description:'Read one exact organization or repository ruleset, rules, bypasses and optional history.',
  properties:{...base,rulesetId:ID,history:{type:'boolean'},max:MAX},
  required:['rulesetId'],
  handler:(a,ctx)=>plain(async()=>{
    const {owner,octokit:gh}=await readerFor(a,ctx),p={...a,owner};project(p);
    const params={...loc(p),ruleset_id:a.rulesetId};
    const d=(await gh.request(route(p,'/{ruleset_id}'),params)).data;
    if(!d||d.id!==a.rulesetId)throw new TypeError('Ruleset identity did not match the requested numeric ID.');
    let history;
    if(a.history){const h=await maxScan(gh,route(p,'/{ruleset_id}/history'),params,a.max??50);
      history={...h,items:h.items.map(y=>({version_id:y.version_id,
        updated_at:y.updated_at,actor_id:y.actor?.id??null}))};}
    return {owner,scope:p.scope??'repo',...(p.repo?{repo:p.repo}:{}),...view(d),
      ...(history?{history}:{})};
  })
});
export const rulesetSuites=defineRead({
  name:'github_ruleset_list_rule_suites',area:'ruleset',audience:['B','O'],
  description:'Find recent ruleset evaluation results and the exact rules that rejected a push.',
  properties:{...base,ruleSuiteId:ID,max:MAX,ref:{type:'string',maxLength:255}},
  handler:(a,ctx)=>plain(async()=>{
    const {owner,octokit:gh}=await readerFor(a,ctx),p={...a,owner};project(p);
    if(a.ruleSuiteId){
      const x=(await gh.request(route(p,'/rule-suites/{rule_suite_id}'),
        {...loc(p),rule_suite_id:a.ruleSuiteId})).data;
      if(!x||x.id!==a.ruleSuiteId)throw new TypeError('Rule suite ID mismatch.');
      return {scope:p.scope??'repo',owner,item:suite(x)};
    }
    const r=await maxScan(gh,route(p,'/rule-suites'),{
      ...loc(p),...(a.ref?{ref:a.ref}:{})},a.max??50);
    return {scope:p.scope??'repo',owner,count:r.count,
      complete:r.complete,...(!r.complete?{warning:r.warning}:{}),
      items:r.items.map(suite)};
  })
});
export const tools=[protectionGet.tool,rulesetList.tool,rulesetGet.tool,rulesetSuites.tool];
export const handlers=Object.fromEntries([
  [protectionGet.tool,protectionGet.handler],[rulesetList.tool,rulesetList.handler],
  [rulesetGet.tool,rulesetGet.handler],[rulesetSuites.tool,rulesetSuites.handler]
].map(([t,h])=>[t.name,h]));
