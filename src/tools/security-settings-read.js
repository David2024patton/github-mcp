// H-4: per-repository security-feature and GitHub Actions settings status.
// Values are explicit and bounded. Unknown/non-readable settings remain unknown,
// never silently treated as disabled in a later write.
import {defineRead} from './define-read.js';
import {readerFor,plain} from './github-read.js';

const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const FEATURES=['advanced_security','code_security','secret_scanning',
  'secret_scanning_push_protection','dependabot_security_updates'];
const root=p=>({owner:p.owner,repo:p.repo});
const securityStatus=r=>Object.fromEntries(FEATURES.map(k=>[
  k,typeof r?.[k]?.status==='string'?r[k].status:null]));
const selection=x=>({
  github_owned_allowed:x?.github_owned_allowed??null,
  verified_allowed:x?.verified_allowed??null,
  patterns_allowed:Array.isArray(x?.patterns_allowed)?x.patterns_allowed.slice(0,100):null});
const get=async(gh,r,p)=>{const result=await gh.request('GET '+r,p);return result.data;};
const actionsRoutes={
  actions:'/actions/permissions',
  workflow:'/actions/permissions/workflow',
  selected:'/actions/permissions/selected-actions',
  fork:'/actions/permissions/fork-pr-contributor-approval',
  retention:'/actions/permissions/artifact-and-log-retention'
};
export async function readActionSections(gh,p){
  const pre='/repos/{owner}/{repo}',base=root(p);
  const main=await get(gh,pre+actionsRoutes.actions,base);
  const workflow=await get(gh,pre+actionsRoutes.workflow,base);
  const fork=await get(gh,pre+actionsRoutes.fork,base);
  const retention=await get(gh,pre+actionsRoutes.retention,base);
  let selected=null;
  if(main?.allowed_actions==='selected')selected=await get(gh,
    pre+actionsRoutes.selected,base);
  if(typeof main?.enabled!=='boolean'||!main?.allowed_actions||
    !workflow?.default_workflow_permissions||
    !(['all_external_contributors','first_time_contributors',
      'first_time_contributors_new_to_github'].includes(fork?.approval_policy)||
      Number.isInteger(fork?.approval_policy))||!Number.isInteger(retention?.days))
    throw new TypeError('GitHub Actions policy returned incomplete required fields.');
  return {
    actions:{enabled:main.enabled,allowed_actions:main.allowed_actions,
      sha_pinning_required:main.sha_pinning_required??null},
    workflow:{default_workflow_permissions:workflow.default_workflow_permissions,
      can_approve_pull_request_reviews:workflow.can_approve_pull_request_reviews??null},
    selected:main.allowed_actions==='selected'?selection(selected):null,
    fork:{approval_policy:fork.approval_policy},
    retention:{days:retention.days,maximum_allowed_days:retention.maximum_allowed_days??null}
  };
}
// Private vulnerability reporting is a separate GitHub endpoint, not part of security_and_analysis. A read that fails stays
// unknown (null); a later write then refuses rather than guessing.
const reportingStatus=async(gh,p)=>{
  try{
    const r=await get(gh,'/repos/{owner}/{repo}/private-vulnerability-reporting',root(p));
    return typeof r?.enabled==='boolean'?(r.enabled?'enabled':'disabled'):null;
  }catch{return null;}
};
export async function readRepoSecurity(gh,p){
  const r=await get(gh,'/repos/{owner}/{repo}',root(p));
  if(!r?.full_name||r.full_name.toLowerCase()!==`${p.owner}/${p.repo}`.toLowerCase())
    throw new TypeError('Security settings repository identity mismatch.');
  if(!r.security_and_analysis||typeof r.private!=='boolean')
    throw new TypeError('GitHub did not disclose complete security feature settings.');
  return {owner:p.owner,repo:p.repo,private:r.private,
    security_and_analysis:{...securityStatus(r.security_and_analysis),
      private_vulnerability_reporting:await reportingStatus(gh,p)}};
}
export const securitySettings=defineRead({
  name:'github_security_get_settings',area:'security',audience:['B','O'],
  description:'Read verified repository security features and paid/private eligibility without guessing missing settings.',
  properties:{owner:OWNER,repo:REPO},required:['repo'],
  handler:(a,ctx)=>plain(async()=>{
    const {owner,octokit:gh}=await readerFor(a,ctx);
    return readRepoSecurity(gh,{owner,repo:a.repo});
  })
});
export const actionsSettings=defineRead({
  name:'github_actions_get_settings',area:'actions',audience:['B','O'],
  description:'Read complete Actions policy, workflow token, selected action, fork-approval and retention settings.',
  properties:{owner:OWNER,repo:REPO},required:['repo'],
  handler:(a,ctx)=>plain(async()=>{
    const {owner,octokit:gh}=await readerFor(a,ctx);
    return {owner,repo:a.repo,...await readActionSections(gh,{owner,repo:a.repo})};
  })
});
export const tools=[securitySettings.tool,actionsSettings.tool];
export const handlers=Object.fromEntries([
  [securitySettings.tool,securitySettings.handler],
  [actionsSettings.tool,actionsSettings.handler]
].map(([t,h])=>[t.name,h]));
