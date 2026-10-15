// W-5: registry-only observations. Missing evidence is never a clean bill of health.
import {defineRead} from './define-read.js';
const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const MAX={type:'integer',minimum:1,maximum:20};
const now=c=>c.now();
const scope=a=>({...a.owner?{owner:a.owner}:{},...a.repo?{repo:a.repo}:{}});
const rows=x=>x?.items??[];
const incomplete=x=>!!(x?.kept_result||x?.more_exist||x?.next_page_possible||x?.complete===false);
function session(a,c){
  const owner=a.owner??c.connection.default_account;
  if(!c.connection.accounts?.some(x=>x.toLowerCase()===owner.toLowerCase()))
    throw new TypeError('This account is not enrolled in the active connection.');
  const started=now(c),evidence=[],findings=[];
  const remaining=()=>now(c)-started<46000;
  const finding=(id,status,reason,target)=>findings.push({id,status,reason,...target?{target}:{}});
  async function read(id,tool,args){
    if(!remaining()){
      evidence.push({id,tool,status:'not_attempted',reason:'Workflow time budget exhausted.'});
      return null;
    }
    let response;
    try{response=await c.callTool(tool,{owner,...args});}catch{
      evidence.push({id,tool,status:'not_readable',reason:'The wrapped read failed.'});return null;
    }
    if(response?.isError||!response?.structuredContent){
      const reason=(response?.content??[]).filter(x=>x.type==='text').map(x=>x.text).join(' ').slice(0,400);
      evidence.push({id,tool,status:/upgrade|not.available.on.plan/i.test(reason)?'not_available_on_plan':'not_readable',reason:reason||'No verified result.'});
      return null;
    }
    const value=response.structuredContent;
    const status=incomplete(value)?'incomplete':'observed';
    evidence.push({id,tool,status});
    return value;
  }
  function finish(extra={}){
    const complete=evidence.every(x=>x.status==='observed');
    const unknown=findings.some(x=>x.status==='unknown');
    return {owner,...a.repo?{repo:a.repo}:{},done:complete&&!unknown,
      status:!complete||unknown?'partial':findings.some(x=>x.status==='needs_attention')?'needs_attention':'observed',
      complete:complete&&!unknown,evidence,findings,...extra,
      observed_at:new Date(now(c)).toISOString(),
      note:'Read-only observations; no fixes, grants, activation, spending or cleanup performed.',
      ...(!remaining()?{next:'Resume this bounded review; completed sections are observations, not full coverage.'}:{})};
  }
  return {owner,read,finding,finish,remaining};
}
async function repositories(a,s){
  if(a.repo)return [{name:a.repo}];
  const list=await s.read('repositories','github_repo_list',{max:a.maxRepositories??10,detail:'full',fields:['name','full_name','private']});
  if(!list)return [];
  if(incomplete(list))s.finding('repository-coverage','unknown','Repository inventory is capped; increase maxRepositories or select an exact repo.');
  return rows(list).map(x=>({name:x.name??x.full_name?.split('/')[1]})).filter(x=>x.name);
}
async function alerts(repo,s){
  const severity={critical:0,high:0,medium:0,low:0,unknown:0};
  const inventories=[];
  for(const kind of ['dependabot','code','secret']){
    const data=await s.read(repo+':'+kind,'github_security_list_alerts',{repo,kind,...kind==='secret'?{}:{state:'open'},max:100});
    if(!data){inventories.push({kind,status:'not_readable'});continue;}
    const all=rows(data),items=kind==='secret'?all.filter(x=>x.state==='open'):all;
    for(const item of items){
      const level=Object.hasOwn(severity,item.severity)?item.severity:'unknown';severity[level]++;
    }
    const bypasses=kind==='secret'?all.filter(x=>x.push_protection_bypassed===true).map(x=>({number:x.number,html_url:x.html_url})):[];
    inventories.push({kind,count:items.length,complete:!incomplete(data),severity:kind==='secret'?null:items.reduce((o,x)=>{const k=x.severity??'unknown';o[k]=(o[k]??0)+1;return o;},{}),
      ...(kind==='secret'?{push_protection_bypasses:bypasses,bypass_coverage:incomplete(data)?'Partial open and resolved alert inventory.':'Observed open and resolved alert inventory.',unknown_bypass_fields:all.filter(x=>typeof x.push_protection_bypassed!=='boolean').length}:{})});
    if(bypasses.length)s.finding(repo+':bypasses','needs_attention',`${bypasses.length} observed push-protection bypass(es), including resolved alerts.`,repo);
    if(kind==='secret'&&all.some(x=>typeof x.push_protection_bypassed!=='boolean'))s.finding(repo+':bypass-coverage','unknown','Some alert bypass fields were not disclosed.',repo);
    if(items.length)s.finding(repo+':'+kind,'needs_attention',`${items.length} observed open ${kind} alert(s).`,repo);
  }
  return {severity,inventories};
}
async function features(repo,s){
  const data=await s.read(repo+':features','github_security_get_settings',{repo});
  const states=data?.security_and_analysis;
  if(!states)return null;
  for(const feature of ['secret_scanning','secret_scanning_push_protection','dependabot_security_updates']){
    if(states[feature]==='disabled')s.finding(repo+':'+feature,'needs_attention',`${feature} is disabled; plan eligibility and owner permission must be checked before any change.`,repo);
    else if(states[feature]===null||states[feature]===undefined)s.finding(repo+':'+feature,'unknown',`${feature} was not disclosed by GitHub.`,repo);
  }
  return states;
}
export async function repoHealth(a,c){
  const s=session(a,c),base=scope(a);
  const repo=await s.read('repository','github_repo_get',base);
  if(!repo?.default_branch){s.finding('repository','unknown','The repository default branch is not readable.');return s.finish();}
  const protection=await s.read('default-protection','github_protection_get',{repo:a.repo,branch:repo.default_branch});
  const rulesets=await s.read('rulesets','github_ruleset_list',{repo:a.repo,max:100});
  if(protection?.protected===false)s.finding('default-protection','needs_attention','GitHub reports the default branch is unprotected.',repo.default_branch);
  if(protection?.classic_protection_readable!==true)s.finding('classic-policy','unknown','Classic protection is unreadable; do not infer that effective rulesets are absent.',repo.default_branch);
  const runs=await s.read('ci-runs','github_actions_list_runs',{repo:a.repo,branch:repo.default_branch,max:100,detail:'full'});
  const completed=rows(runs).filter(x=>x.status==='completed');
  const successes=completed.filter(x=>x.conclusion==='success').length;
  const ci={observed_runs:rows(runs).length,completed:completed.length,successes,
    pass_rate:completed.length?successes/completed.length:null,coverage:runs?(incomplete(runs)?'bounded_sample':'observed_inventory'):'not_readable'};
  if(completed.some(x=>['failure','timed_out','action_required'].includes(x.conclusion)))s.finding('ci-failures','needs_attention','The observed default-branch sample includes failed CI.');
  const prs=await s.read('open-prs','github_pr_list',{repo:a.repo,state:'open',max:100,detail:'full'});
  const stale=rows(prs).filter(x=>Number.isFinite(Date.parse(x.updated_at))&&now(c)-Date.parse(x.updated_at)>(a.staleDays??30)*86400000).map(x=>({number:x.number,updated_at:x.updated_at,html_url:x.html_url}));
  if(stale.length)s.finding('stale-prs','needs_attention',`${stale.length} observed PR(s) exceed ${a.staleDays??30} days without an update.`);
  const security=await alerts(a.repo,s),securityFeatures=await features(a.repo,s);
  const actions=await s.read('actions-policy','github_actions_get_settings',{repo:a.repo});
  if(actions?.workflow?.default_workflow_permissions==='write')s.finding('actions-token','needs_attention','Default workflow tokens have write permissions.');
  if(actions?.workflow?.can_approve_pull_request_reviews===true)s.finding('actions-approval','needs_attention','Workflow tokens can approve pull requests.');
  return s.finish({default_branch:repo.default_branch,protection,rulesets,ci,
    open_prs:prs?{count:rows(prs).length,stale,complete:!incomplete(prs)}:null,security,security_features:securityFeatures,actions});
}
export async function securityReview(a,c){
  const s=session(a,c),reports=[];
  for(const repo of await repositories(a,s)){
    if(!s.remaining()){s.finding('repository-budget','unknown','Remaining repositories were not inspected because the time budget expired.');break;}
    reports.push({repo:repo.name,...await alerts(repo.name,s),features:await features(repo.name,s)});
  }
  return s.finish({repositories:reports,bypass_scope:'Open and resolved secret-alert inventories; capped or unreadable history is explicitly incomplete.'});
}
export async function accessReview(a,c){
  const s=session(a,c),base={max:100};
  const members=await s.read('members','github_org_list_members',{...base,includeOutside:true});
  const teams=await s.read('teams','github_team_list',base);
  const apps=await s.read('apps','github_app_list_installations',{...base,scope:a.accountType??'organization'});
  const tokens=await s.read('fine-grained-tokens','github_tokenpolicy_list_tokens',base);
  const requests=await s.read('token-requests','github_tokenpolicy_list_requests',base);
  const outside=members?.outside_collaborators??[];
  if(outside.length)s.finding('outside-collaborators','needs_attention',`${outside.length} observed outside collaborator(s) require owner review.`);
  for(const item of apps?.installations??[]){
    if(item.repository_selection==='all')s.finding('app:'+item.id,'needs_attention','Installed app can reach all repositories; verify that this remains intended.');
  }
  for(const item of tokens?.tokens??[]){
    if(!item.token_expires_at&&!item.expires_at)s.finding('token:'+item.id,'needs_attention','Token has no disclosed expiry; review its intended lifetime.');
  }
  const reports=[];
  for(const repo of await repositories(a,s)){
    if(!s.remaining()){s.finding('repository-budget','unknown','Remaining repository access was not inspected before the time budget.');break;}
    const collaborators=await s.read(repo.name+':collaborators','github_collab_list',{repo:repo.name,max:100});
    const keys=await s.read(repo.name+':deploykeys','github_deploykey_list',{repo:repo.name,max:100});
    const admins=(collaborators?.collaborators??[]).filter(x=>x.permissions?.admin===true||x.role_name==='admin').map(x=>x.login);
    if(admins.length>1)s.finding(repo.name+':admins','needs_attention','Multiple repository administrators; verify each admin is intended.',repo.name);
    for(const key of keys?.keys??[])if(key.read_only===false)s.finding(repo.name+':key:'+key.id,'needs_attention','Deploy key has write access.',repo.name);
    if(collaborators?.pending_invitations?.length)s.finding(repo.name+':invitations','needs_attention','Pending invitations can grant repository access.',repo.name);
    reports.push({repo:repo.name,collaborators,deploy_keys:keys,administrators:admins});
  }
  return s.finish({members,teams,apps,tokens,token_requests:requests,repositories:reports,
    note:'Review flags identify access worth checking, not a claim that a person or integration is malicious. No access was changed.'});
}
const specs=[
  {name:'github_workflow_repo_health',audience:['O','Op'],description:'Review repository protection, CI pass rate, stale PRs, security and Actions policy without changing anything.',properties:{owner:OWNER,repo:REPO,staleDays:{type:'integer',minimum:1,maximum:365}},required:['repo'],handler:repoHealth},
  {name:'github_workflow_security_review',audience:['O'],description:'Review bounded account security alerts, severity, disabled features and observed push-protection bypasses.',properties:{owner:OWNER,repo:REPO,maxRepositories:MAX},handler:securityReview},
  {name:'github_workflow_access_review',audience:['O'],description:'Review account members, outsiders, teams, apps, tokens and repository deploy keys with explicit coverage gaps.',properties:{owner:OWNER,repo:REPO,maxRepositories:MAX,accountType:{type:'string',enum:['organization','user']}},handler:accessReview}
];
const definitions=specs.map(spec=>defineRead({...spec,area:'workflow'}));
export const tools=definitions.map(d=>({...d.tool,usesRegistry:true}));
export const handlers=Object.fromEntries(definitions.map(d=>[d.tool.name,d.handler]));
