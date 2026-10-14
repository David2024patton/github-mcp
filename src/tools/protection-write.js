// H-1: classic branch protection is a complete PUT, not a patch.
// Preserve every readable setting, fail closed on incomplete membership, and verify the full readback.
import {isDeepStrictEqual} from 'node:util';
import {defineGithubWrite} from './define-github-write.js';
import {octo,ownerOf,missing,refusal,slug} from './github-write.js';

const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const BRANCH={type:'string',minLength:1,maxLength:255},BOOL={type:'boolean'};
const member={type:'array',maxItems:100,uniqueItems:true,items:{type:'string',minLength:1,maxLength:100}};
const members={type:'object',properties:{users:member,teams:member,apps:member},additionalProperties:false};
const CHECK={type:'object',properties:{context:{type:'string',minLength:1,maxLength:200},
  app_id:{type:'integer',minimum:-1}},required:['context'],additionalProperties:false};
const checkChanges={type:['object','null'],properties:{strict:BOOL,
  contexts:{type:'array',maxItems:100,uniqueItems:true,items:{type:'string',minLength:1,maxLength:200}},
  checks:{type:'array',maxItems:100,items:CHECK}},additionalProperties:false};
const reviewChanges={type:['object','null'],properties:{
  dismiss_stale_reviews:BOOL,require_code_owner_reviews:BOOL,
  required_approving_review_count:{type:'integer',minimum:0,maximum:6},
  require_last_push_approval:BOOL,
  dismissal_restrictions:members,bypass_pull_request_allowances:members},additionalProperties:false};
const FLAGS=['required_linear_history','allow_force_pushes','allow_deletions',
  'block_creations','required_conversation_resolution','lock_branch','allow_fork_syncing'];
const changesShape={type:'object',properties:{
  required_status_checks:checkChanges,enforce_admins:BOOL,
  required_pull_request_reviews:reviewChanges,restrictions:{type:['object','null'],
    properties:members.properties,additionalProperties:false},
  ...Object.fromEntries(FLAGS.map(k=>[k,BOOL]))},additionalProperties:false,minProperties:1};
const route='/repos/{owner}/{repo}/branches/{branch}/protection';
const params=(a,t)=>({owner:t.owner,repo:a.repo,branch:a.branch});
const target=(a,c)=>({owner:ownerOf(a,c),repo:a.repo,ref:a.branch,scope:'repo'});
const unique=(arr,label)=>{
  if(!Array.isArray(arr)||arr.length>100)throw refusal('Incomplete '+label+' membership; refusing to replace it.');
  if(new Set(arr).size!==arr.length)throw refusal('Duplicate '+label+' members; refusing unsafe replacement.');
  return arr;
};
const names=(value,key,label)=>{
  if(value===undefined)throw refusal('Cannot verify all '+label+' '+key+' members; update refused.');
  return unique(value.map(v=>typeof v==='string'?v:v?.[key]),label+' '+key)
    .map(v=>{if(typeof v!=='string'||!v)throw refusal('Unidentified '+label+' member.');return v;});
};
const group=(raw,label)=>raw===null?null:raw===undefined
  ?(()=>{throw refusal('Unverified '+label+' members; update refused.');})()
  :{users:names(raw.users,'login',label),teams:names(raw.teams,'slug',label),
    apps:names(raw.apps,'slug',label)};
const reads=(raw)=>{
  if(!raw||typeof raw!=='object')throw refusal('Protection configuration is missing.');
  const checks=raw.required_status_checks===null?null:(()=>{
    const c=raw.required_status_checks;
    if(!c||typeof c.strict!=='boolean'||!Array.isArray(c.contexts)||!Array.isArray(c.checks))
      throw refusal('Required checks or app identity are incomplete.');
    const list=c.checks.map(q=>{
      if(!q?.context||!c.contexts.includes(q.context)||
        !(q.app_id===null||Number.isSafeInteger(q.app_id)))
        throw refusal('Required-check provider identity cannot be preserved.');
      return {context:q.context,...(q.app_id===null?{}:{app_id:q.app_id})};
    });
    if(new Set(list.map(q=>q.context)).size!==list.length||
      new Set(c.contexts).size!==list.length)
      throw refusal('Incomplete required-check contexts; refusing whole-object replacement.');
    return {strict:c.strict,contexts:[...c.contexts],checks:list};
  })();
  const pr=raw.required_pull_request_reviews===null?null:(()=>{
    const r=raw.required_pull_request_reviews;
    if(!r||typeof r.dismiss_stale_reviews!=='boolean'||
      typeof r.require_code_owner_reviews!=='boolean'||
      !Number.isInteger(r.required_approving_review_count)||
      typeof r.require_last_push_approval!=='boolean')
      throw refusal('Review protections cannot be completely verified.');
    return {dismiss_stale_reviews:r.dismiss_stale_reviews,
      require_code_owner_reviews:r.require_code_owner_reviews,
      required_approving_review_count:r.required_approving_review_count,
      require_last_push_approval:r.require_last_push_approval,
      ...(r.dismissal_restrictions!==undefined?
        {dismissal_restrictions:group(r.dismissal_restrictions,'dismissal')}:{}),
      ...(r.bypass_pull_request_allowances!==undefined?
        {bypass_pull_request_allowances:group(r.bypass_pull_request_allowances,'bypass')}:{})};
  })();
  if(typeof raw.enforce_admins?.enabled!=='boolean')
    throw refusal('Administrator enforcement cannot be read in full.');
  const result={required_status_checks:checks,enforce_admins:raw.enforce_admins.enabled,
    required_pull_request_reviews:pr,restrictions:group(raw.restrictions,'push')};
  for(const k of FLAGS){
    if(raw[k]!==undefined){
      if(typeof raw[k]?.enabled!=='boolean')throw refusal('Cannot verify protection '+k+'.');
      result[k]=raw[k].enabled;
    }
  }
  return result;
};
const mergeChanges=(base,changes)=>{
  const next={...base};
  for(const [key,value] of Object.entries(changes)){
    if(value!==null&&typeof value==='object'&&
      ['required_status_checks','required_pull_request_reviews','restrictions'].includes(key)){
      next[key]={...(base?.[key]??{}),...value};
      for(const [name,obj] of Object.entries(value)){
        if(obj!==null&&typeof obj==='object'&&
          ['dismissal_restrictions','bypass_pull_request_allowances'].includes(name))
          next[key][name]={...(base?.[key]?.[name]??{}),...obj};
      }
    }else next[key]=value;
  }
  for(const k of ['required_status_checks','enforce_admins','required_pull_request_reviews','restrictions'])
    if(next[k]===undefined)throw refusal('A new branch protection requires explicit '+k+'; no defaults are invented.');
  const checks=next.required_status_checks;
  if(checks!==null&&(!Array.isArray(checks.checks)||!Array.isArray(checks.contexts)||
    typeof checks.strict!=='boolean'||checks.checks.length!==checks.contexts.length||
    new Set(checks.contexts).size!==checks.contexts.length||
    !checks.checks.every(q=>checks.contexts.includes(q.context))))
    throw refusal('Required-check settings must include strict, contexts and the complete app-bound check list.');
  if(next.required_pull_request_reviews!==null){
    const r=next.required_pull_request_reviews;
    if(typeof r.dismiss_stale_reviews!=='boolean'||typeof r.require_code_owner_reviews!=='boolean'||
      !Number.isInteger(r.required_approving_review_count)||
      typeof r.require_last_push_approval!=='boolean')
      throw refusal('Review protections must include every review requirement.');
  }
  for(const [key,val] of Object.entries(next)){
    if(['restrictions','required_pull_request_reviews'].includes(key)&&val){
      const groups=key==='restrictions'?[val]:[val.dismissal_restrictions,val.bypass_pull_request_allowances].filter(Boolean);
      for(const g of groups)for(const type of ['users','teams','apps'])
        if(!Array.isArray(g[type]))throw refusal('Incomplete '+key+' '+type+' membership.');
    }
  }
  return next;
};
const read=async(a,ctx,t)=>{
  const gh=await octo(ctx,t.owner),p=params(a,t);
  const b=(await gh.request('GET /repos/{owner}/{repo}/branches/{branch}',p)).data;
  if(b?.name!==a.branch||!b.commit?.sha)throw refusal('Exact branch and SHA could not be verified.');
  const raw=await missing(async()=>(await gh.request('GET '+route,p)).data);
  return {classic:raw,current:raw?reads(raw):null,sha:b.commit.sha,
    signatures:raw?.required_signatures?.enabled??null};
};
const verifySnapshot=(expected,actual)=>actual&&isDeepStrictEqual(expected,reads(actual));
export const protectionSet=defineGithubWrite({
  name:'github_protection_set',area:'protection',audience:['O'],
  description:'Safely merge named branch protection changes into a complete guarded PUT, preserving other controls.',
  properties:{owner:OWNER,repo:REPO,branch:BRANCH,changes:changesShape},
  required:['repo','branch','changes'],
  declarations:{production:'always',confirm:'always',profiles:['full'],accessWidening:true},
  target,
  read:async(a,ctx,t)=>{
    const before=await read(a,ctx,t);
    return {...before,next:mergeChanges(before.current,a.changes)};
  },
  classify:()=>({production:'changes effective branch protection, merge or access controls',
    accessWidening:'may reduce branch restrictions; compare every before/after control'}),
  summarize:({args:a,before:b,target:t})=>{
    const diffs=Object.keys(a.changes).map(k=>
      k+': '+JSON.stringify(b.current?.[k]??null)+' → '+JSON.stringify(b.next[k]));
    return 'Change '+slug(t.owner,t.repo)+' '+a.branch+
      ' (existing settings retained; required checks and reviews preserved unless explicitly changed): '+diffs.join('; ');
  },
  apply:({args:a,ctx,target:t,before:b})=>{
    if(isDeepStrictEqual(b.current,b.next))
      throw refusal('Protection already has the requested values; no PUT was sent.');
    return octo(ctx,t.owner).then(gh=>gh.request('PUT '+route,
      {...params(a,t),...b.next}));
  },
  readAfter:({args:a,ctx,target:t})=>read(a,ctx,t),
  verify:({before:b,after:x})=>x?.classic&&x.sha===b.sha&&
    x.signatures===b.signatures&&verifySnapshot(b.next,x.classic),
  inverse:()=>null,
  present:({args:a,after:x})=>({branch:a.branch,classic_protection:!!x?.classic,
    retained_checks:x?.current?.required_status_checks?.checks?.length??0,
    retained_reviews:x?.current?.required_pull_request_reviews?.required_approving_review_count??0})
});
export const protectionRemove=defineGithubWrite({
  name:'github_protection_remove',area:'protection',audience:['O'],
  description:'Permanently remove exact classic branch protection after explicit confirmation and absence readback.',
  properties:{owner:OWNER,repo:REPO,branch:BRANCH},required:['repo','branch'],
  declarations:{production:'always',confirm:'always',profiles:['full'],accessWidening:true},target,
  read,
  classify:()=>({production:'deletes all classic branch protections',
    accessWidening:'removes required checks, required reviews and push protections'}),
  summarize:({args:a,target:t,before:b})=>
    'DELETE all classic protection on '+slug(t.owner,t.repo)+' '+a.branch+
    '; required checks: '+(b?.current?.required_status_checks?.checks?.length??0)+
    ', required approvals: '+(b?.current?.required_pull_request_reviews?.required_approving_review_count??0)+
    '; organization and repository rulesets may remain effective.',
  apply:({args:a,ctx,target:t,before:b})=>{
    if(!b.classic)throw refusal('No readable classic protection to remove.');
    return octo(ctx,t.owner).then(gh=>gh.request('DELETE '+route,params(a,t)));
  },
  readAfter:({args:a,ctx,target:t})=>read(a,ctx,t),
  verify:({before:b,after:x})=>x&&x.sha===b.sha&&x.classic===null,
  inverse:()=>null,present:({args:a})=>({branch:a.branch,classic_protection_removed:true,
    warning:'Rulesets may still restrict this branch.'})
});
export const tools=[protectionSet.tool,protectionRemove.tool];
export const handlers=Object.fromEntries([
  [protectionSet.tool,protectionSet.handler],[protectionRemove.tool,protectionRemove.handler]
].map(([tool,handler])=>[tool.name,handler]));
