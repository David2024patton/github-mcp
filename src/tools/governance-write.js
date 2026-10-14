// H-1: production-gated, confirmation-required governance changes.
// Ruleset PUT is whole-document: read, merge named changes only, verify every field.
import {isDeepStrictEqual} from 'node:util';
import {listAll} from '../github/client.js';
import {defineGithubWrite} from './define-github-write.js';
import {octo,ownerOf,missing,refusal,slug} from './github-write.js';
const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const ID={type:'integer',minimum:1},NAME={type:'string',minLength:1,maxLength:100};
const RULE={type:'object',properties:{type:{type:'string',minLength:1,maxLength:80},
  parameters:{type:'object',additionalProperties:true}},
  required:['type'],additionalProperties:false};
const ACTOR={type:'object',properties:{actor_id:ID,
  actor_type:{type:'string',enum:['Team','Role','Integration','OrganizationAdmin']},
  bypass_mode:{type:'string',enum:['always','pull_request','exempt']}},
  required:['actor_id','actor_type','bypass_mode'],additionalProperties:false};
const target=(a,c)=>{
  if(a.scope==='org'&&a.repo)throw new TypeError('Organization rulesets cannot target a repository.');
  if(a.scope!=='org'&&!a.repo)throw new TypeError('A repository ruleset needs the repository name.');
  return {owner:ownerOf(a,c),...(a.scope==='org'?{}:{repo:a.repo}),
    scope:a.scope==='org'?'org':'repo'};
};
const p=t=>t.repo?{owner:t.owner,repo:t.repo}:{org:t.owner};
const r=(t,s)=>t.repo?`${s} /repos/{owner}/{repo}/rulesets`:`${s} /orgs/{org}/rulesets`;
const normalizeRuleset=x=>({
  name:x.name,target:x.target,enforcement:x.enforcement,
  conditions:x.conditions??null,rules:x.rules??null,bypass_actors:x.bypass_actors??null
});
const own=(t,x)=>{
  const expected=t.repo?slug(t.owner,t.repo):t.owner;
  return !x.source||String(x.source).toLowerCase()===expected.toLowerCase();
};
const get=async(ctx,t,id)=>missing(async()=>{
  const x=(await(await octo(ctx,t.owner)).request(
    r(t,'GET')+'/{ruleset_id}',{...p(t),ruleset_id:id})).data;
  if(x&&(!Number.isSafeInteger(x.id)||x.id!==id||!own(t,x)))
    throw refusal('Ruleset ownership or numeric identity cannot be confirmed.');
  return x;
});
const eq=(x,y)=>isDeepStrictEqual(x,y);
const word=r=>r.type==='non_fast_forward'?'Block force pushes':
  r.type==='required_status_checks'
  ?`Require ${(r.parameters?.required_status_checks??[]).map(s=>s.context).join(', ')} checks`
  :`Enforce ${r.type}`;
const rulesPreview=x=>(x.rules??[]).slice(0,20).map(word).join('; ')||'No specific rules';
const widening=(old,next)=>{
  if(!Array.isArray(next))return false;
  const seen=old??[];
  return next.some(a=>!seen.some(b=>b.actor_id===a.actor_id&&
    b.actor_type===a.actor_type&&b.bypass_mode===a.bypass_mode));
};
const normalizeInput=a=>({
  ...(a.name!==undefined?{name:a.name}:{}),
  ...(a.target!==undefined?{target:a.target}:{}),
  ...(a.enforcement!==undefined?{enforcement:a.enforcement}:{}),
  ...(a.conditions!==undefined?{conditions:a.conditions}:{}),
  ...(a.rules!==undefined?{rules:a.rules}:{}),
  ...(a.bypassActors!==undefined?{bypass_actors:a.bypassActors}:{})
});
export const rulesetSave=defineGithubWrite({
  name:'github_ruleset_save',area:'ruleset',audience:['O'],
  description:'Create a ruleset or safely merge only supplied changes into an existing ruleset.',
  properties:{owner:OWNER,repo:REPO,scope:{type:'string',enum:['repo','org']},
    rulesetId:ID,name:NAME,target:{type:'string',enum:['branch','tag','push','repository']},
    enforcement:{type:'string',enum:['active','evaluate','disabled']},
    conditions:{type:'object',additionalProperties:true},
    rules:{type:'array',maxItems:50,items:RULE},
    bypassActors:{type:'array',maxItems:50,items:ACTOR}},
  declarations:{production:'always',confirm:'always',accessWidening:true},
  target:(a,c)=>{
    const t=target(a,c);
    if(a.rulesetId===undefined&&(!a.name||!a.target||!a.enforcement||
      !Array.isArray(a.rules)||!a.conditions))
      throw new TypeError('New rulesets require name, target, enforcement, rules and conditions.');
    if(a.rulesetId!==undefined&&
      !['name','target','enforcement','rules','conditions','bypassActors'].some(k=>Object.hasOwn(a,k)))
      throw new TypeError('Specify the ruleset fields that should change.');
    return t;
  },
  read:async(a,ctx,t)=>{
    const existing=a.rulesetId===undefined?null:await get(ctx,t,a.rulesetId);
    if(a.rulesetId!==undefined&&!existing)throw refusal('Ruleset was not found.');
    if(existing&&(!Array.isArray(existing.rules)||!Array.isArray(existing.bypass_actors)||
      !existing.conditions||!existing.name||!existing.target||!existing.enforcement))
      throw refusal('The complete current ruleset (including bypass actors) is not readable; update refused to preserve settings.');
    if(a.rulesetId===undefined){
      const scan=await listAll(await octo(ctx,t.owner),r(t,'GET'),{...p(t),per_page:100},{max:500});
      if(scan.capped)throw refusal('Cannot verify no duplicate name in an incomplete ruleset inventory.');
      if(scan.items.some(x=>String(x.name).toLowerCase()===a.name.toLowerCase()))
        throw refusal('An existing ruleset already has this name.');
    }
    const merged={...(existing?normalizeRuleset(existing):{}),...normalizeInput(a)};
    if(!Array.isArray(merged.rules)||!Array.isArray(merged.bypass_actors??[]))
      throw refusal('Ruleset rules or bypass actor membership is incomplete.');
    merged.bypass_actors=merged.bypass_actors??[];
    return {existing,merged};
  },
  classify:({args:a,before:b})=>({
    production:'modifies effective branch or tag governance',
    ...(widening(b?.existing?.bypass_actors,a.bypassActors)?{
      accessWidening:'adds or expands bypass actors'}:{})
  }),
  summarize:({args:a,target:t,before:b})=>{
    const after=b?.merged,old=b?.existing,changes=['name','target','enforcement',
      'conditions','rules','bypass_actors'].filter(k=>!eq(old?.[k],after?.[k]));
    const beforeRules=old?rulesPreview(old):'(none)';
    return `${old?'Update':'Create'} ${t.repo?slug(t.owner,t.repo):t.owner} ruleset "${after?.name??a.name}": ${changes.join(', ')}; ${beforeRules} → ${rulesPreview(after??{})}; enforcement ${old?.enforcement??'none'} → ${after?.enforcement??a.enforcement}; bypass actors ${old?.bypass_actors?.length??0} → ${after?.bypass_actors?.length??0}`;
  },
  apply:async({args:a,ctx,target:t,before:b})=>{
    const gh=await octo(ctx,t.owner),update=!!a.rulesetId;
    return gh.request(r(t,update?'PUT':'POST')+(update?'/{ruleset_id}':''),
      {...p(t),...(update?{ruleset_id:a.rulesetId}:{}),...b.merged});
  },
  readAfter:({args:a,ctx,target:t,response:q})=>
    get(ctx,t,a.rulesetId??q?.data?.id),
  verify:({args:a,before:b,after:x,response:q})=>!!x&&
    x.id===(a.rulesetId??q?.data?.id)&&own(null??{},x)!==null&&
    eq(normalizeRuleset(x),b.merged),
  inverse:()=>null,
  present:({after:x})=>({id:x?.id,name:x?.name,enforcement:x?.enforcement,
    target:x?.target,rule_count:x?.rules?.length??0,bypass_count:x?.bypass_actors?.length??0})
});
export const rulesetDelete=defineGithubWrite({
  name:'github_ruleset_delete',area:'ruleset',audience:['O'],
  description:'Permanently delete an exact ruleset only after confirmation and independent absence readback.',
  properties:{owner:OWNER,repo:REPO,scope:{type:'string',enum:['repo','org']},
    rulesetId:ID},required:['rulesetId'],
  declarations:{production:'always',confirm:'always'},target,
  read:async(a,ctx,t)=>({current:await get(ctx,t,a.rulesetId)}),
  classify:()=>({production:'removes governance and may allow previously blocked changes'}),
  summarize:({args:a,target:t,before:b})=>
    `DELETE ruleset #${a.rulesetId} "${b?.current?.name??'already absent'}" from ${t.repo?slug(t.owner,t.repo):t.owner}; protections will be lost`,
  apply:({args:a,ctx,target:t,before:b})=>{
    if(!b.current)throw refusal('Ruleset is already absent; no deletion was sent.');
    return octo(ctx,t.owner).then(gh=>gh.request(r(t,'DELETE')+'/{ruleset_id}',
      {...p(t),ruleset_id:a.rulesetId}));
  },
  readAfter:({args:a,ctx,target:t})=>get(ctx,t,a.rulesetId),
  verify:({after})=>after===null,inverse:()=>null,
  present:({args:a})=>({deleted_ruleset_id:a.rulesetId,irreversible:true})
});
const CHECK={type:'string',minLength:1,maxLength:200};
const checksParams=(a,t)=>({owner:t.owner,repo:a.repo,branch:a.branch});
const requiredRoute=(suffix='')=>`/repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks${suffix}`;
const getChecks=(ctx,t,a)=>octo(ctx,t.owner).then(gh=>gh.request(
  'GET '+requiredRoute(),checksParams(a,t)).then(x=>x.data));
export const requiredChecks=defineGithubWrite({
  name:'github_protection_set_required_checks',area:'protection',audience:['B','O'],
  description:'Add or remove a required status-check context without replacing other branch protections.',
  properties:{owner:OWNER,repo:REPO,branch:{type:'string',minLength:1,maxLength:255},
    action:{type:'string',enum:['add','remove']},context:CHECK},
  required:['repo','branch','action','context'],
  declarations:{production:'always',confirm:'always'},
  target:(a,c)=>({owner:ownerOf(a,c),repo:a.repo,ref:a.branch,scope:'repo'}),
  read:async(a,ctx,t)=>{
    const d=await getChecks(ctx,t,a);
    if(!d||!Array.isArray(d.contexts)||typeof d.strict!=='boolean')
      throw refusal('Current required status checks could not be completely verified.');
    return {current:d,already:d.contexts.includes(a.context)};
  },
  classify:()=>({production:'changes merge protections'}),
  summarize:({args:a,before:b,target:t})=>
    `${a.action==='add'?'Require':'Stop requiring'} check "${a.context}" on ${slug(t.owner,a.repo)} ${a.branch}; existing checks: ${(b?.current?.contexts??[]).join(', ')}; strict: ${b?.current?.strict}`,
  apply:({args:a,ctx,target:t,before:b})=>{
    if((a.action==='add')===b.already)
      throw refusal('Required-check set already has the requested membership; no change sent.');
    return octo(ctx,t.owner).then(gh=>gh.request(
      (a.action==='add'?'POST ':'DELETE ')+requiredRoute('/contexts'),
      {...checksParams(a,t),contexts:[a.context]}));
  },
  readAfter:({args:a,ctx,target:t})=>getChecks(ctx,t,a),
  verify:({args:a,before:b,after:d})=>!!d&&
    d.strict===b.current.strict&&Array.isArray(d.contexts)&&
    d.contexts.includes(a.context)===(a.action==='add')&&
    b.current.contexts.filter(x=>x!==a.context).every(x=>d.contexts.includes(x))&&
    d.contexts.every(x=>x===a.context||b.current.contexts.includes(x))&&
    eq(d.checks??[],b.current.checks??[]),
  inverse:()=>null,present:({args:a,after:d})=>({branch:a.branch,
    strict:d.strict,contexts:d.contexts})
});
export const tools=[rulesetSave.tool,rulesetDelete.tool,requiredChecks.tool];
export const handlers=Object.fromEntries([
  [rulesetSave.tool,rulesetSave.handler],[rulesetDelete.tool,rulesetDelete.handler],
  [requiredChecks.tool,requiredChecks.handler]
].map(([t,h])=>[t.name,h]));
