// H-4: guarded repository feature switches and complete Actions policy changes.
// The selected section is read first, merged without inventing defaults, written
// once behind production/confirmation guards, then independently read back.
import {defineGithubWrite} from './define-github-write.js';
import {octo,ownerOf,refusal,slug} from './github-write.js';
import {readActionSections,readRepoSecurity} from './security-settings-read.js';

const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const t=(a,c)=>({owner:ownerOf(a,c),repo:a.repo,scope:'repo',kind:'repo-settings'});
const p=t=>({owner:t.owner,repo:t.repo});
const featureNames=['advanced_security','code_security','secret_scanning',
  'secret_scanning_push_protection','dependabot_security_updates','private_vulnerability_reporting'];
const premium=new Set(['advanced_security','code_security','secret_scanning',
  'secret_scanning_push_protection']);
const feature=(a,b)=>b.security_and_analysis?.[a.feature];
const initialSecurity=(a,ctx,target)=>octo(ctx,target.owner).then(gh=>readRepoSecurity(gh,p(target)));
const safeFeature=(a,b)=>{
  const old=feature(a,b);
  if(!['enabled','disabled'].includes(old))
    throw refusal('The requested GitHub security-feature status cannot be independently read.');
  // Private paid activation is available with the end user's actual GitHub
  // entitlement, production consent and chosen spend policy. The unknown
  // number of future active committers is a warning, not a builder ban.
};
export const securitySetFeature=defineGithubWrite({
  name:'github_security_set_feature',area:'security',audience:['O'],
  description:'Turn a readable GitHub security feature on/off while preserving others; paid private activation warns about uncapped future charges.',
  properties:{owner:OWNER,repo:REPO,feature:{type:'string',enum:featureNames},
    enabled:{type:'boolean'}},required:['repo','feature','enabled'],
  declarations:{production:'always',confirm:'always',spend:true,profiles:['full']},target:t,
  read:(a,ctx,target)=>initialSecurity(a,ctx,target),
  price:({args:a,before:b})=>b?.private&&a.enabled&&premium.has(a.feature)&&feature(a,b)!=='enabled'?null:0,
  classify:({args:a,before:b})=>{
    safeFeature(a,b);
    return {production:'changes repository security features, including private paid products when legitimately delegated'};
  },
  summarize:({args:a,target,before:b})=>{
    safeFeature(a,b);
    const newStatus=a.enabled?'enabled':'disabled';
    return 'Change '+a.feature+' on '+slug(target.owner,target.repo)+
      ' from '+feature(a,b)+' to '+newStatus+
      (a.enabled?(b.private&&premium.has(a.feature)?' (PAID private security, potentially uncapped active-committer charges)':''):' (reduces this repository protection if previously on)');
  },
  apply:({args:a,ctx,target,before:b})=>{
    safeFeature(a,b);
    // Private vulnerability reporting has its own endpoint (PUT enables, DELETE disables); the rest are one PATCH field.
    if(a.feature==='private_vulnerability_reporting')return octo(ctx,target.owner).then(gh=>gh.request(
      (a.enabled?'PUT':'DELETE')+' /repos/{owner}/{repo}/private-vulnerability-reporting',p(target)));
    return octo(ctx,target.owner).then(gh=>gh.request(
      'PATCH /repos/{owner}/{repo}',{...p(target),
        security_and_analysis:{[a.feature]:{status:a.enabled?'enabled':'disabled'}}}));
  },
  readAfter:({args:a,ctx,target})=>initialSecurity(a,ctx,target),
  verify:({args:a,before:b,after:x})=>!!x&&
    x.security_and_analysis[a.feature]===(a.enabled?'enabled':'disabled')&&
    featureNames.every(k=>k===a.feature||
      b.security_and_analysis[k]===x.security_and_analysis[k]),
  inverse:()=>null,present:({args:a,after:x})=>({feature:a.feature,
    enabled:x?.security_and_analysis[a.feature]==='enabled',
    other_security_features_preserved:true})
});

const SECTIONS={
  actions:['enabled','allowed_actions','sha_pinning_required'],
  workflow:['default_workflow_permissions','can_approve_pull_request_reviews'],
  selected:['github_owned_allowed','verified_allowed','patterns_allowed'],
  fork:['approval_policy'],
  retention:['days']
};
const PATCH_SCHEMAS={
  enabled:{type:'boolean'},
  allowed_actions:{type:'string',enum:['all','local_only','selected']},
  sha_pinning_required:{type:'boolean'},
  default_workflow_permissions:{type:'string',enum:['read','write']},
  can_approve_pull_request_reviews:{type:'boolean'},
  github_owned_allowed:{type:'boolean'},verified_allowed:{type:'boolean'},
  patterns_allowed:{type:'array',maxItems:50,uniqueItems:true,
    items:{type:'string',minLength:1,maxLength:250}},
  approval_policy:{type:['string','integer']},
  days:{type:'integer',minimum:1,maximum:400}
};
const ROUTE={
  actions:'/actions/permissions',
  workflow:'/actions/permissions/workflow',
  selected:'/actions/permissions/selected-actions',
  fork:'/actions/permissions/fork-pr-contributor-approval',
  retention:'/actions/permissions/artifact-and-log-retention'
};
const targetChanges=(a,b)=>{
  const changes=a.changes;
  if(!changes||typeof changes!=='object'||Array.isArray(changes))
    throw refusal('A nonempty settings change object is required.');
  const keys=Object.keys(changes),allowed=SECTIONS[a.section];
  if(!keys.length||keys.some(k=>!allowed.includes(k)))
    throw refusal('Only properties of the one chosen Actions settings section may be changed.');
  const previous=b?.[a.section];
  if(!previous)throw refusal('This GitHub Actions policy section is not readable; refusing to guess.');
  if(keys.some(k=>previous[k]===undefined||previous[k]===null))
    throw refusal('A named Actions policy field was not readable; no policy may be overwritten.');
  const merged={...previous,...changes};
  if(a.section==='fork'&&'approval_policy' in changes){
    const allowed=['first_time_contributors_new_to_github',
      'first_time_contributors','all_external_contributors'];
    const input=changes.approval_policy;
    if(typeof input==='number'){
      if(!Number.isInteger(input)||input<0||input>2)
        throw refusal('Fork approval policy must be one of the three provider-supported values.');
      merged.approval_policy=allowed[input];
    }else if(!allowed.includes(input))
      throw refusal('Fork approval policy must be an explicit GitHub-approved value.');
  }
  if(a.section==='selected'&&b.actions.allowed_actions!=='selected')
    throw refusal('First explicitly enable selected-actions policy; do not modify a dormant or unreadable allowlist.');
  if(a.section==='selected'&&!Array.isArray(merged.patterns_allowed))
    throw refusal('Selected actions patterns are not a readable complete allowlist.');
  if(a.section==='retention'&&Number.isInteger(previous.maximum_allowed_days)&&
    changes.days>previous.maximum_allowed_days)
    throw refusal('Retention exceeds GitHub organization maximum.');
  return {keys,merged};
};
const beforeAfter=(a,b)=>{
  const {keys}=targetChanges(a,b);
  return keys.map(k=>k+': '+JSON.stringify(b[a.section][k])+
    ' → '+JSON.stringify(a.changes[k])).join('; ');
};
export const actionsSetSettings=defineGithubWrite({
  name:'github_actions_set_settings',area:'actions',audience:['O'],
  description:'Update one Actions permissions, workflow token, allowlist, fork approval or retention setting with complete readback.',
  properties:{owner:OWNER,repo:REPO,section:{type:'string',enum:Object.keys(SECTIONS)},
    changes:{type:'object',properties:PATCH_SCHEMAS,
      minProperties:1,additionalProperties:false}},
  required:['repo','section','changes'],
  declarations:{production:'always',confirm:'always',accessWidening:true,profiles:['full']},
  target:t,
  read:async(a,ctx,target)=>readActionSections(await octo(ctx,target.owner),p(target)),
  classify:({args:a,before:b})=>{
    targetChanges(a,b);
    return {production:'changes GitHub Actions execution permissions, retention or fork policy',
      accessWidening:a.section!=='retention'};
  },
  summarize:({args:a,target,before:b})=>
    'Change '+a.section+' Actions policy in '+slug(target.owner,target.repo)+
      ': '+beforeAfter(a,b)+'; all other policy sections must remain identical',
  apply:async({args:a,ctx,target,before:b})=>{
    const {merged}=targetChanges(a,b);
    const fields=SECTIONS[a.section];
    const body=Object.fromEntries(fields.filter(k=>merged[k]!==null&&
      merged[k]!==undefined).map(k=>[k,merged[k]]));
    // No read-only max-retention field is sent back to GitHub.
    return (await octo(ctx,target.owner)).request(
      'PUT /repos/{owner}/{repo}'+ROUTE[a.section],{...p(target),...body});
  },
  readAfter:async({ctx,target})=>readActionSections(await octo(ctx,target.owner),p(target)),
  verify:({args:a,before:b,after:x})=>!!x&&
    Object.keys(SECTIONS).every(s=>{
      const prior=b[s],next=x[s];
      if(prior===null)return next===null;
      if(!next)return false;
      return Object.keys(prior).every(k=>s!==a.section||
        !(k in a.changes)?
          JSON.stringify(prior[k])===JSON.stringify(next[k]):
          JSON.stringify(s==='fork'&&k==='approval_policy'?
            ['first_time_contributors_new_to_github','first_time_contributors',
              'all_external_contributors'][a.changes[k]]??a.changes[k]:a.changes[k])===
            JSON.stringify(next[k]));
    }),
  inverse:()=>null,present:({args:a,after:x})=>({
    section:a.section,updated:x?.[a.section]??null,
    other_policy_sections_preserved:true})
});
export const tools=[securitySetFeature.tool,actionsSetSettings.tool];
export const handlers=Object.fromEntries([
  [securitySetFeature.tool,securitySetFeature.handler],
  [actionsSetSettings.tool,actionsSetSettings.handler]
].map(([t,h])=>[t.name,h]));
