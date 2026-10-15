// P-2 authoritative G1-G20 observations. Never confuse an unreadable provider
// setting with a healthy setting, or a local policy with remote verification.
import {githubFor,listAll} from '../github/client.js';
import {readRepoSecurity,readActionSections} from './security-settings-read.js';

const steps={
  G5:'1. Check the current PR head. 2. Require the ci status for exactly that SHA. 3. Use the guarded merge_when_green tool.',
  G6:'1. Inspect the whole PR stack. 2. Retarget bottom-up to main. 3. Check fresh CI per PR before each merge.',
  G7:'1. List review threads. 2. Address each finding at the current SHA. 3. Resolve only after verification.',
  G9:'1. Review sandbox-publish.yml and transfer branch restrictions. 2. Run its test suite. 3. Do not force a transfer ref.',
  G10:'1. Inspect merged/closed PRs. 2. Exclude live/default/owned branches. 3. Delete only exact verified orphan heads.',
  G20:'1. Check the nightly CI and daily live promotion runs. 2. Confirm alerts/digests reach the owner. 3. Record monitoring evidence.'
};
const make=(id,description,status,evidence,more={})=>
  ({id,description,status,evidence,...more});
const ok=x=>x&&x.ok===true;
const value=x=>ok(x)?x.data:null;
const cleanReason=e=>e?.status===404?'GitHub returned not found or this setting is plan-restricted.':
  e?.status===403?'GitHub denied access; check installation/user scopes or plan.':
  e?.status===401?'GitHub authorization is missing or expired.':
  'The provider did not return readable evidence. No healthy state is inferred.';
const read=async(gh,route,p)=>{
  try{return {ok:true,data:(await gh.request(route,p)).data};}
  catch(error){return {ok:false,status:error?.status??null,reason:cleanReason(error)};}
};
const pair=(o,r)=>({owner:o,repo:r});
const hasDefault=x=>{const ref=x?.conditions?.ref_name;
  const inc=ref?.include??[];
  return x?.target==='branch'&&Array.isArray(inc)&&
    inc.some(y=>['~DEFAULT_BRANCH','refs/heads/main'].includes(y));
};
const checkRule=x=>(x?.rules??[]).find(y=>y.type==='required_status_checks');
const contexts=r=>(r?.parameters?.required_status_checks??[])
  .map(x=>x?.context).filter(Boolean);
const workflowContent=d=>{
  if(!d?.content||d.encoding!=='base64'||Number(d.size)>100000)
    return null;
  const s=Buffer.from(d.content,'base64').toString('utf8');
  return s.split(/\r?\n/).filter(line=>!line.trim().startsWith('#')).join('\n');
};
const permission=(s,key,level)=>String(s??'').split(/\r?\n/)
  .some(line=>line.trim()===key+': '+level);
const fileRoute='GET /repos/{owner}/{repo}/contents/{path}';
const secrets=async(gh,p)=>{
  const endpoints=['GET /repos/{owner}/{repo}/actions/secrets',
    'GET /repos/{owner}/{repo}/dependabot/secrets'];
  const result=await Promise.all(endpoints.map(route=>read(gh,route,p)));
  return result.every(ok)?{ok:true,data:result.map(x=>x.data)}:
    {ok:false,reason:result.find(x=>!ok(x))?.reason};
};
const listRules=async(gh,p)=>{
  try{
    const x=await listAll(gh,'GET /repos/{owner}/{repo}/rulesets',p,{max:100});
    if(x.capped||x.items.length>30)
      return {ok:false,reason:'Ruleset inventory is incomplete. Cannot prove branch policy.'};
    const details=await Promise.all(x.items.map(item=>read(gh,
      'GET /repos/{owner}/{repo}/rulesets/{ruleset_id}',
      {...p,ruleset_id:item.id})));
    if(details.some(x=>!ok(x)))return {ok:false,reason:'One or more ruleset details were denied.'};
    if(details.some(x=>!Array.isArray(x.data?.rules)))
      return {ok:false,reason:'GitHub did not provide complete ruleset content.'};
    return {ok:true,data:details.map(x=>x.data)};
  }catch(e){return {ok:false,reason:cleanReason(e)};}
};
const manual=(id,description,repo)=>make(id,description,'needs_you',
  'A policy document or tool alone cannot prove runtime enforcement.',
  {steps:steps[id],url:'https://github.com/'+repo+'/actions'});
const readiness=(profile)=>new Map((profile.readiness??[]).map(x=>[x.id,x.label]));
const add=(out,labels,id,status,evidence,rest={})=>
  out.push(make(id,labels.get(id)??id,status,evidence,rest));

export async function inspectReadiness(ctx,owner,repo,profile){
  const p=pair(owner,repo),name=owner+'/'+repo;
  const labels=readiness(profile),out=[],fixes=new Map();
  let gh;
  try{gh=await githubFor(ctx,{owner});}
  catch{for(let i=1;i<=20;i++)
    add(out,labels,'G'+i,'not_readable','GitHub installation authorization unavailable.');
    return {rows:out,fixes,scope:name};}
  const [repository,rules,live,security,actions,secretSets,
    ciFile,perfFile,dailyFile,transferFile,houseFile,keys,collabs]=await Promise.all([
    read(gh,'GET /repos/{owner}/{repo}',p),
    listRules(gh,p),
    read(gh,'GET /repos/{owner}/{repo}/branches/{branch}',{...p,branch:'live'}),
    readRepoSecurity(gh,p).then(data=>({ok:true,data}),e=>({ok:false,reason:cleanReason(e)})),
    readActionSections(gh,p).then(data=>({ok:true,data}),e=>({ok:false,reason:cleanReason(e)})),
    secrets(gh,p),
    read(gh,fileRoute,{...p,path:'.github/workflows/ci.yml'}),
    read(gh,fileRoute,{...p,path:'.github/workflows/perf.yml'}),
    read(gh,fileRoute,{...p,path:'.github/workflows/daily-live.yml'}),
    read(gh,fileRoute,{...p,path:'.github/workflows/sandbox-publish.yml'}),
    read(gh,fileRoute,{...p,path:'.github/workflows/git-housekeeping.yml'}),
    read(gh,'GET /repos/{owner}/{repo}/keys',{...p,per_page:100}),
    read(gh,'GET /repos/{owner}/{repo}/collaborators',{...p,per_page:100})
  ]);
  const settingsLink='https://github.com/'+name+'/settings';
  const need=(id,reason,extra={})=>add(out,labels,id,'needs_attention',reason,
    {url:settingsLink,...extra});
  const unknown=(id,e)=>add(out,labels,id,'not_readable',e?.reason??'Provider data was not readable.');
  const repoObj=value(repository);
  if(!ok(repository)||repoObj?.full_name?.toLowerCase()!==name.toLowerCase()){
    for(const id of ['G1','G4'])unknown(id,repository);
  }else{
    const isPublic=repoObj.private===false;
    if(isPublic)add(out,labels,'G1','done','Provider confirms public repository.');
    else need('G1','Repository is not public. Visibility change requires owner access approval.');
    if(repoObj.allow_merge_commit===true)add(out,labels,'G4','done','Merge commits enabled.');
    else{need('G4','Merge commits disabled; owner approval required.');
      fixes.set('G4',{tool:'github_repo_update_settings',args:{owner,repo,allow_merge_commit:true}});}
  }
  const effectiveRules=ok(rules)?rules.data.filter(x=>x.enforcement==='active'&&hasDefault(x)):[];
  const single=effectiveRules.length===1?effectiveRules[0]:null;
  const hasCi=effectiveRules.some(x=>contexts(checkRule(x)).includes('ci')&&
    contexts(checkRule(x)).length===1);
  const noMoreCi=effectiveRules.every(x=>!checkRule(x)||
    contexts(checkRule(x)).every(c=>c==='ci'));
  const force=effectiveRules.some(x=>x.rules.some(y=>y.type==='non_fast_forward'));
  const deletion=effectiveRules.some(x=>x.rules.some(y=>y.type==='deletion'));
  if(!ok(rules)){unknown('G2',rules);unknown('G3',rules);}
  else{
    if(hasCi&&noMoreCi)add(out,labels,'G2','done','Active default-branch ruleset requires ci and no extra checks.');
    else{
      need('G2',!hasCi?'Default branch lacks a readable ci check requirement.':
        'An extra required check needs an owner policy decision; not silently removed.');
      if(noMoreCi&&(effectiveRules.length===0||single))fixes.set('G2',{
        tool:'github_ruleset_save',args:rulesetChange(owner,repo,single,'G2')});
    }
    if(force&&deletion)add(out,labels,'G3','done','Active default-branch rules block both force pushes and branch deletion.');
    else{
      need('G3','Both non-fast-forward and deletion protections must be in force.');
      if(effectiveRules.length===0||single)fixes.set('G3',{
        tool:'github_ruleset_save',args:rulesetChange(owner,repo,single,'G3')});
    }
  }
  for(const id of ['G5','G6','G7','G9','G10','G20'])
    out.push(manual(id,labels.get(id)??id,name));
  const ownerHousekeeping=out.find(x=>x.id==='G20');
  if(!ok(houseFile))ownerHousekeeping.evidence+=
    ' Owner housekeeping workflow also could not be read.';
  const hasLive=ok(live)&&live.data?.name==='live'&&
    profile.productionBranches?.includes('live')&&
    profile.ownedRefs?.some(o=>o.pattern==='live'&&
      (o.managedBy==='daily-live.yml'||o.managedBy==='.github/workflows/daily-live.yml'));
  if(hasLive)add(out,labels,'G8','done','live exists and profile names its checked release workflow.');
  else if(!ok(live)&&live.status!==404)unknown('G8',live);
  else need('G8','live or its workflow ownership is missing; do not directly update live.');
  for(const [id,files,writeNames] of [
    ['G11',[ciFile,perfFile],[]],
    ['G12',[dailyFile],['contents','checks']],
    ['G13',[transferFile],['contents','actions']]
  ]){
    if(files.some(x=>!ok(x))){unknown(id,files.find(x=>!ok(x)));continue;}
    const texts=files.map(x=>workflowContent(x.data));
    if(texts.some(t=>t===null)){unknown(id,{reason:'Workflow source is too large or not base64/readable.'});continue;}
    const forbidden=texts.some(s=>/(^|\n)\s*pull_request_target\s*:/.test(s));
    const safe= !forbidden&&texts.every(s=>s.includes('permissions:')&&
      (writeNames.length?writeNames.every(k=>permission(s,k,k==='contents'?'write':'write')):
        permission(s,'contents','read')));
    if(safe)add(out,labels,id,'done','Published workflow permission/trigger text passes conservative checks; runtime proof is separate.');
    else need(id,'Workflow trigger or permission policy differs; inspect source manually. Never edit workflow files.');
  }
  if(!ok(secretSets))unknown('G14',secretSets);
  else if(secretSets.data.every(x=>x?.total_count===0))
    add(out,labels,'G14','needs_you','Action/Dependabot secret inventories empty; environment-scoped secrets still require separate verification.');
  else need('G14','One or more GitHub repository secret names exist; review only names, never fetch values.');
  if(!ok(security)){unknown('G15',security);}
  else{
    const state=security.data.security_and_analysis;
    const missing=['secret_scanning','secret_scanning_push_protection']
      .filter(k=>state[k]!=='enabled');
    if(!missing.length)add(out,labels,'G15','done','Secret scanning and push protection both enabled.');
    else{
      need('G15','Missing: '+missing.join(', ')+'. Private paid features are protected by spend gate.');
      for(const feature of missing)fixes.set('G15:'+feature,{
        tool:'github_security_set_feature',args:{owner,repo,feature,enabled:true}});
    }
  }
  if(!ok(actions)){unknown('G16',actions);unknown('G17',actions);}
  else{
    const policy=actions.data.fork?.approval_policy;
    if(policy==='all_external_contributors'||policy===2)
      add(out,labels,'G16','done','All external fork contributors require review.');
    else{
      need('G16','Fork workflow approval is looser than all_external_contributors.');
      fixes.set('G16',{tool:'github_actions_set_settings',args:{owner,repo,
        section:'fork',changes:{approval_policy:'all_external_contributors'}}});
    }
    const perm=actions.data.workflow?.default_workflow_permissions;
    if(perm==='read')add(out,labels,'G17','done','Default GITHUB_TOKEN read-only.');
    else{
      need('G17','Default workflow token is not read-only.');
      fixes.set('G17',{tool:'github_actions_set_settings',args:{owner,repo,
        section:'workflow',changes:{default_workflow_permissions:'read'}}});
    }
  }
  if(!ok(keys)||!ok(collabs)){unknown('G19',!ok(keys)?keys:collabs);}
  else if((keys.data??[]).length===100||(collabs.data??[]).length===100)
    unknown('G19',{reason:'Access inventory reached the page limit; not enough evidence to claim owner-only access.'});
  else if((keys.data??[]).some(k=>k.read_only===false)||
      (collabs.data??[]).some(c=>c.login?.toLowerCase()!==owner.toLowerCase()))
    need('G19','External collaborators or write-enabled deploy keys need owner review.');
  else add(out,labels,'G19','done','No external collaborator or write deploy key found in readable first page.');
  let installations;
  try{
    const u=await githubFor(ctx,{owner,cred:'U'});
    installations=await read(u,'GET /user/installations',{per_page:100});
  }catch(e){installations={ok:false,reason:cleanReason(e)};}
  if(!ok(installations))unknown('G18',installations);
  else if((installations.data.installations??[]).some(x=>/vercel/i.test(x.app_slug??'')&&
      x.account?.login?.toLowerCase()===owner.toLowerCase()))
    add(out,labels,'G18','needs_you','Vercel App installation visible; repository-specific access and production trigger must be checked at provider settings.');
  else need('G18','Vercel App installation not verified by this user grant.');
  const order=Object.fromEntries(Array.from({length:20},(_,i)=>['G'+(i+1),i]));
  out.sort((a,b)=>order[a.id]-order[b.id]);
  return {rows:out,fixes,scope:name};
}
function rulesetChange(owner,repo,existing,kind){
  const check={type:'required_status_checks',parameters:{
    strict_required_status_checks_policy:true,
    required_status_checks:[{context:'ci'}]}};
  const current=existing?.rules??[];
  const rules=current.filter(r=>r.type!=='required_status_checks');
  if(kind==='G2'&&!current.some(r=>r.type==='required_status_checks'))rules.push(check);
  if(kind==='G2'&&current.some(r=>r.type==='required_status_checks'))rules.push(check);
  if(kind==='G3'){
    if(!rules.some(r=>r.type==='non_fast_forward'))rules.push({type:'non_fast_forward'});
    if(!rules.some(r=>r.type==='deletion'))rules.push({type:'deletion'});
    for(const x of current.filter(r=>r.type==='required_status_checks'))rules.push(x);
  }
  if(!existing){
    if(!rules.some(r=>r.type==='non_fast_forward'))rules.push({type:'non_fast_forward'});
    if(!rules.some(r=>r.type==='deletion'))rules.push({type:'deletion'});
    if(!rules.some(r=>r.type==='required_status_checks'))rules.push(check);
  }
  const base={owner,repo,scope:'repo',rules};
  return existing?{...base,rulesetId:existing.id}:
    {...base,name:'main-ci-and-safety',target:'branch',enforcement:'active',
      conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}}};
}
