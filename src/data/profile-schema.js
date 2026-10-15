// P-1: validated project profiles. All profile content is policy data, never a bypass of owner/production gates.
const SLUG=/^[a-z0-9-]{1,39}\/[a-z0-9._-]{1,100}$/;
const REF=/^[A-Za-z0-9_./*?-]{1,120}$/;
const YAML=/^(?:\.github\/workflows\/)?[A-Za-z0-9._-]+\.ya?ml$/;
const fail=(m)=>{throw new TypeError('Invalid project profile: '+m);};
const check=(x,m)=>{if(!x)fail(m);};
const clone=(x)=>structuredClone(x);
const distinct=(a,max,m)=>{check(Array.isArray(a)&&a.length<=max,m+' must be a bounded array.');
  check(a.every(x=>typeof x==='string'&&x.length>0)&&new Set(a.map(x=>x.toLowerCase())).size===a.length,m+' must be distinct strings.');return a;};
const READINESS=Object.freeze([
['G1','Public repository','github_repo_get'],['G2','Main CI ruleset','github_ruleset_list'],
['G3','Force-push/delete prevention','github_ruleset_get'],['G4','Merge commits','github_repo_get'],
['G5','Exact-head merge','github_workflow_merge_when_green'],['G6','Ordered stacks','github_workflow_merge_stack'],
['G7','Review thread disposition','github_workflow_review_threads'],['G8','Live protected release','github_branch_get'],
['G9','Sandbox-publish transfer','github_actions_list_workflows'],['G10','Branch cleanup','github_branch_list'],
['G11','Read-only CI and perf','github_content_get'],['G12','Daily promotion policy','github_content_get'],
['G13','Sandbox workflow permissions','github_content_get'],['G14','No unattended secrets','github_secret_list'],
['G15','Security scanning','github_security_get_settings'],['G16','Fork approval','github_actions_get_settings'],
['G17','Read-only default GITHUB_TOKEN','github_actions_get_settings'],
['G18','Vercel GitHub App','github_app_list_installations'],['G19','Owner-only access','github_collab_list'],
['G20','CI and release monitoring','github_actions_list_runs']]);
export const APP_READINESS_IDS=Object.freeze(READINESS.map(x=>x[0]));
export const PROFILE_SCHEMA_VERSION=1;
const makeWork=(file,permissions,write=false)=>({file,maxPermissions:permissions,
  forbiddenTriggers:['pull_request_target'],ownsWrites:write});
const appliance={schemaVersion:1,id:'appliance-desk',name:'Appliance Desk',status:'active',
  source:{repository:'christcr2012/appliance-desk',verifiedMainSha:'20466bc50cead4d300523ee38382f34267a07f4d',
    checkedOn:'2026-10-15',documentation:'docs/APP-NEEDS-APPLIANCE-DESK.md'},
  repos:['christcr2012/appliance-desk'],productionBranches:['live'],productionEnvironments:[],
  ownedRefs:[{pattern:'live',managedBy:'daily-live.yml',note:'Checked daily main to live release'},
    {pattern:'transfer/**',managedBy:'sandbox-publish.yml',agentMay:['create-from-default','commit-files'],
      note:'Only sandbox transfer create and file commits are allowed'}],
  branchPatterns:{default:'main',work:['ai/**'],preview:[],transfer:['transfer/**']},
  requiredChecks:['ci'],mergeMethod:'merge',
  workflows:[makeWork('ci.yml',{contents:'read'}),makeWork('perf.yml',{contents:'read'}),
    makeWork('daily-live.yml',{contents:'write',checks:'read'},true),
    makeWork('sandbox-publish.yml',{contents:'write',actions:'write'},true),
    makeWork('git-housekeeping.yml',{contents:'write',pull_requests:'read'},true)],
  repoSettings:{visibility:'public',allow_merge_commit:true,allow_force_pushes:false,allow_deletions:false},
  security:{secretScanning:true,pushProtection:true},actionsSettings:{defaultWorkflowPermissions:'read',forkPrApproval:'all'},
  apps:['Vercel'],collaborators:'owner-only',
  readiness:READINESS.map(([id,label,tool])=>({id,label,tool})),
  notes:'Daily live promotion is owner checked; Vercel builds live only. Manual fallback sandbox-publish may write ai/*.'};
const servers={schemaVersion:1,id:'robinson-servers',name:'Robinson MCP servers',status:'active',
  source:{repository:'robinson-ai-systems/github-mcp',verifiedMainSha:'810c06562013d15b811255beb026606ab82e7ea0',
    checkedOn:'2026-10-15',documentation:'docs/designs/BATCH-P.md'},
  repos:['github-mcp','stripe-mcp','google-workspace-mcp','robinsons-toolkit-hub','vercel-mcp','neon-mcp']
    .map(n=>'robinson-ai-systems/'+n),
  productionBranches:['live'],productionEnvironments:[],
  ownedRefs:[{pattern:'live',managedBy:'daily-live.yml',note:'Only checked daily live policy may promote'}],
  branchPatterns:{default:'main',work:['ai/**'],preview:[],transfer:[]},
  requiredChecks:['ci'],mergeMethod:'merge',
  workflows:[makeWork('ci.yml',{contents:'read'}),makeWork('daily-live.yml',{contents:'write',checks:'read'},true)],
  repoSettings:{allow_merge_commit:true},security:{secretScanning:true,pushProtection:true},
  actionsSettings:{defaultWorkflowPermissions:'read'},apps:[],collaborators:'owner-only',
  readiness:[],notes:'Shared policy baseline; provider and per-project acceptance require independent checks.'};
export const DEFAULT_PROJECTS=Object.freeze([appliance,servers].map(x=>Object.freeze(clone(x))));

export function validateProjectProfile(raw){
  check(raw&&typeof raw==='object'&&!Array.isArray(raw),'profile must be an object');
  const allowed=['schemaVersion','id','name','status','source','repos','productionBranches',
    'productionEnvironments','ownedRefs','branchPatterns','requiredChecks','mergeMethod',
    'workflows','repoSettings','security','actionsSettings','apps','collaborators','readiness','notes'];
  for(const key of Object.keys(raw))check(allowed.includes(key),'unknown field '+key);
  check(raw.schemaVersion===PROFILE_SCHEMA_VERSION,'unsupported schemaVersion');
  check(/^[a-z][a-z0-9-]{2,63}$/.test(raw.id),'invalid ID');
  check(typeof raw.name==='string'&&raw.name.length>=3&&raw.name.length<=100,'invalid name');
  check(['active','draft','retired'].includes(raw.status),'invalid status');
  check(raw.source&&SLUG.test(raw.source.repository)&&/^[a-f0-9]{40}$/.test(raw.source.verifiedMainSha)
    &&/^\d{4}-\d{2}-\d{2}$/.test(raw.source.checkedOn),'source requires repository, SHA, date');
  check(typeof raw.source.documentation==='string'&&raw.source.documentation.length<240,'missing documentation');
  const repos=distinct(raw.repos,50,'repos').map(x=>x.toLowerCase());
  check(repos.length>0&&repos.every(r=>SLUG.test(r))&&repos.includes(raw.source.repository),'source repo not in repos');
  for(const field of ['productionBranches','productionEnvironments','requiredChecks'])
    check(distinct(raw[field],100,field).every(s=>REF.test(s)),'invalid '+field);
  check(Array.isArray(raw.ownedRefs)&&raw.ownedRefs.length<=100,'invalid ownedRefs');
  for(const item of raw.ownedRefs){
    check(item&&REF.test(item.pattern)&&YAML.test(item.managedBy),'invalid owned ref owner/pattern');
    const may=item.agentMay??[];distinct(may,2,'agentMay');
    check(may.every(x=>['create-from-default','commit-files'].includes(x)),'agentMay must be authorized');
  }
  check(raw.branchPatterns&&REF.test(raw.branchPatterns.default),'invalid default');
  for(const field of ['work','preview','transfer'])
    check(distinct(raw.branchPatterns[field],30,field).every(x=>REF.test(x)),'invalid '+field+' patterns');
  check(['merge','squash','rebase'].includes(raw.mergeMethod),'invalid merge method');
  check(Array.isArray(raw.workflows)&&raw.workflows.length<=100,'invalid workflow list');
  const seen=new Set();
  for(const w of raw.workflows){
    check(w&&YAML.test(w.file)&&!seen.has(w.file),'workflow must be a unique YAML path');
    seen.add(w.file);check(w.maxPermissions&&typeof w.maxPermissions==='object','permissions missing');
    check(Object.entries(w.maxPermissions).every(([k,v])=>/^[a-z_]{2,40}$/.test(k)&&
      ['read','write','none'].includes(v)),'invalid permission');
    check(w.ownsWrites===true||w.ownsWrites===false,'write capability must be explicit');
    check(distinct(w.forbiddenTriggers,20,'forbidden triggers').every(x=>REF.test(x)),'invalid triggers');
  }
  for(const k of ['repoSettings','security','actionsSettings'])check(raw[k]&&
    typeof raw[k]==='object'&&JSON.stringify(raw[k]).length<4096,'invalid '+k);
  distinct(raw.apps,100,'apps');
  check(typeof raw.collaborators==='string'&&raw.collaborators.length<300,'invalid collaborators');
  check(Array.isArray(raw.readiness)&&raw.readiness.length<=20,'invalid readiness');
  const ids=new Set();
  for(const x of raw.readiness){
    check(APP_READINESS_IDS.includes(x.id)&&!ids.has(x.id),'unknown/duplicate readiness ID');
    ids.add(x.id);
    check(typeof x.label==='string'&&x.label.length<200&&/^github_[a-z_]+$/.test(x.tool),'invalid readiness mapping');
  }
  if(raw.id==='appliance-desk')check(APP_READINESS_IDS.every(id=>ids.has(id)),'missing G1-G20 row');
  check(typeof raw.notes==='string'&&raw.notes.length<=2000,'invalid notes');
  return clone({...raw,repos});
}
export function containsRepo(profile,owner,repo){
  const slug=String(owner).toLowerCase()+'/'+String(repo).toLowerCase();
  return profile?.repos?.some(x=>x.toLowerCase()===slug)===true;
}
export function storedProject(row){
  if(!row)return null;
  const profile=validateProjectProfile(row.profile);
  check(row.status===profile.status,'status must agree with profile');
  check(Number.isSafeInteger(Number(row.version))&&Number(row.version)>=1,'invalid revision');
  return {id:row.id,name:row.name,status:row.status,version:Number(row.version),
    profile,updated_at:row.updated_at??null};
}
