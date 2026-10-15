// P-3: complete new-project setup is a resumable desired-state workflow.
// It dispatches ONE independently guarded mutation per confirmed invocation;
// it does not commit files or move branch refs on another project's behalf.
import {githubFor,listAll} from '../github/client.js';
import {defineRead} from './define-read.js';
import {plain} from './github-read.js';
import {composeProjectDraft,STANDARD_PROJECT_LABELS} from '../data/project-draft.js';

const s={type:'string',minLength:1,maxLength:100};
const fields={
  id:{type:'string',minLength:3,maxLength:64},
  name:{type:'string',minLength:3,maxLength:100},
  owner:{type:'string',minLength:1,maxLength:39},
  repo:{type:'string',minLength:1,maxLength:100},
  description:{type:'string',minLength:1,maxLength:500},
  visibility:{type:'string',enum:['public','private']},
  requiredChecks:{type:'array',minItems:1,maxItems:15,
    items:s,uniqueItems:true},
  productionBranch:s,
  environments:{type:'array',maxItems:15,items:s,uniqueItems:true},
  findings:{type:'object',additionalProperties:true}
};
const setupInput={...fields,confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',minLength:4,maxLength:128}};
const reply=(x,bad=false)=>({structuredContent:x,
  content:[{type:'text',text:JSON.stringify(x)}],...(bad?{isError:true}:{})});
const refuse=x=>reply({status:'refused',done:false,error:x},true);
const body=x=>x?.structuredContent??null;
const safe=x=>({project:x.profile.id,repository:x.repository,
  draft_status:x.profile.status,profile:x.profile,doc:x.doc,
  needs_owner_review:x.review});
const err=e=>e?.status===404?'absent':e?.status===403?
  'Provider denied this API (permissions/plan); do not infer absence.':
  'The provider state is unreadable; no mutation was attempted.';
const request=async(gh,route,args)=>{
  try{return {state:'ok',value:(await gh.request(route,args)).data};}
  catch(e){return {state:e?.status===404?'absent':'unknown',message:err(e),code:e?.status??null};}
};
const rulesParam=(profile)=>({name:'project-setup-'+profile.id,target:'branch',
  enforcement:'active',conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}},
  rules:[
    {type:'required_status_checks',parameters:{
      strict_required_status_checks_policy:true,
      required_status_checks:profile.requiredChecks.map(context=>({context}))}},
    {type:'non_fast_forward'}, {type:'deletion'}
  ]});
const sameCheck=(a,b)=>a.length===b.length&&a.every(x=>b.includes(x));
const sameRules=(observed,desired)=>{
  const req=observed.rules?.find(x=>x.type==='required_status_checks');
  const actual=(req?.parameters?.required_status_checks??[]).map(x=>x.context);
  return observed.target==='branch'&&observed.enforcement==='active'&&
    observed.conditions?.ref_name?.include?.includes('~DEFAULT_BRANCH')&&
    sameCheck(actual,desired.requiredChecks)&&
    ['deletion','non_fast_forward'].every(t=>observed.rules?.some(x=>x.type===t))&&
    Array.isArray(observed.bypass_actors)&&observed.bypass_actors.length===0;
};
const authorized=(ctx,owner)=>ctx.connection?.accounts?.some(x=>x.toLowerCase()===owner);
const list=async(gh,route,p)=>{
  try{
    const x=await listAll(gh,route,{...p,per_page:100},{max:200});
    if(x.capped)return {state:'unknown',message:'GitHub inventory exceeded the safe scan bound.'};
    return {state:'ok',value:x.items};
  }catch(e){return {state:'unknown',message:err(e)};}
};
const state=(status,detail,more={})=>({status,detail,...more});

// The first run of setup always records the requested draft as durable data.
// On retries this row is the ownership/recovery anchor; a partially configured
// repository is never silently treated as a new unowned project.
export async function planProjectSetup(ctx,draft,stored){
  const {profile}=draft;
  const [owner,repo]=profile.source.repository.split('/');
  if(stored&&stored.profile?.status!=='draft')
    return state('needs_owner_review','The existing policy is active or retired; setup cannot rewrite it.');
  if(stored&&(stored.profile.source.repository!==profile.source.repository||
    stored.profile.repoSettings?.visibility!==profile.repoSettings.visibility||
    !sameCheck(stored.profile.requiredChecks,profile.requiredChecks)))
    return state('needs_owner_review','An existing draft uses different repository, visibility or required checks. Reconcile its revision with the owner.');
  let gh;
  try{gh=await githubFor(ctx,{owner});}
  catch{return state('not_readable','GitHub credential for this authorized owner is missing.');}
  const p={owner,repo};
  const r=await request(gh,'GET /repos/{owner}/{repo}',p);
  if(r.state==='unknown')return state('not_readable',r.message);
  if(!stored){
    if(r.state==='ok'&&r.value?.size!==0)
      return state('needs_owner_review','An existing nonempty repository cannot be taken over by this new-project setup. Owner must independently import it.');
    return state('save_draft','Persist a validated draft recovery checkpoint before any provider change.');
  }
  if(r.state==='absent')
    return state('change','Create the empty repository without committing files.',
      {tool:'github_repo_create',args:{owner,name:repo,
        description:profile.notes.slice(0,200),visibility:profile.repoSettings.visibility,
        auto_init:false}});
  const remote=r.value;
  if(remote.full_name?.toLowerCase()!==profile.source.repository)
    return state('not_readable','Provider returned a different repository identity.');
  const actualVisibility=remote.visibility??(remote.private?'private':'public');
  if(actualVisibility!==profile.repoSettings.visibility)
    return state('needs_owner_review','Existing repository visibility differs from the approved specification; no automatic access change.');
  if(remote.archived||remote.disabled)
    return state('needs_owner_review','Archived or disabled repository cannot be set up.');
  if(remote.allow_merge_commit!==true)
    return state('change','Enable required merge-commit method.',
      {tool:'github_repo_update_settings',args:{owner,repo,allow_merge_commit:true}});
  const rules=await list(gh,'GET /repos/{owner}/{repo}/rulesets',p);
  if(rules.state!=='ok')return state('not_readable',rules.message);
  const ours=rules.value.filter(x=>x.name==='project-setup-'+profile.id);
  if(ours.length>1)return state('needs_owner_review','Several identically named rulesets exist.');
  if(!ours.length){
    const value=rulesParam(profile);
    return state('change','Create the required-check/force-push/deletion ruleset with no bypass.',
      {tool:'github_ruleset_save',args:{owner,repo,scope:'repo',...value}});
  }
  const exact=await request(gh,'GET /repos/{owner}/{repo}/rulesets/{ruleset_id}',{
    ...p,ruleset_id:ours[0].id});
  if(exact.state!=='ok')return state('not_readable','Cannot independently verify the complete setup ruleset.');
  if(!sameRules(exact.value,profile))
    return state('needs_owner_review','Existing setup ruleset differs: no whole-object overwrite or added bypass.');
  const labels=await list(gh,'GET /repos/{owner}/{repo}/labels',p);
  if(labels.state!=='ok')return state('not_readable',labels.message);
  for(const desired of STANDARD_PROJECT_LABELS){
    const current=labels.value.find(x=>x.name?.toLowerCase()===desired.name);
    if(!current)return state('change','Create standard label '+desired.name,
      {tool:'github_label_save',args:{owner,repo,...desired}});
    // Existing labels are not automatically overwritten, even for color differences.
  }
  for(const environment of profile.productionEnvironments){
    const found=await request(gh,'GET /repos/{owner}/{repo}/environments/{environment_name}',{
      ...p,environment_name:environment});
    if(found.state==='unknown')return state('not_readable',found.message);
    if(found.state==='absent'){
      // A production-like environment without explicit branch/reviewer/wait
      // policies is deliberately a guided decision, not an unprotected grant.
      if(['production','prod','live'].includes(environment.toLowerCase()))
        return state('needs_owner_review','Production environment '+environment+
          ' needs owner-defined branch policy and reviewer/wait rules; no unsafe empty protection is invented.');
      return state('change','Create the requested environment '+environment,
        {tool:'github_env_save',args:{owner,repo,environment,waitTimer:0}});
    }
  }
  const sec=remote.security_and_analysis;
  if(!sec)return state('not_readable','Security feature states cannot be verified.');
  for(const feature of ['secret_scanning','secret_scanning_push_protection']){
    const setting=sec[feature]?.status;
    if(setting==='enabled')continue;
    if(setting!=='disabled')return state('not_readable',
      'Cannot independently determine '+feature+' status.');
    if(remote.private)return state('needs_owner_review',
      'Private-repository '+feature+' may incur metered or premium costs. Owner must verify pricing and approve independently; autonomous spending remains $0.');
    return state('change','Enable required public security feature '+feature,
      {tool:'github_security_set_feature',args:{owner,repo,feature,enabled:true}});
  }
  // No workflow, source-code, ref or README mutation. The draft is deliberately
  // left draft until the owner verifies and activates the desired policies.
  return state('complete','All automated, provider-verifiable steps are satisfied. The profile remains a draft pending owner review.',
    {next:'Have the owner review/commit the generated APP-NEEDS document and independently verify permissions, production policy and real provider connection.'});
}

const profileDraft=defineRead({
  name:'github_profile_draft',area:'profile',audience:['B','O'],
  description:'Turn supplied project findings into a validated draft profile and APP-NEEDS document; never read or commit code.',
  properties:fields,
  required:['id','name','owner','repo','description','visibility','requiredChecks'],
  handler:(a,ctx)=>plain(async()=>{
    const draft=composeProjectDraft(a,ctx.now());
    return {status:'draft',read_only:true,...safe(draft)};
  })
});

async function setup(args,ctx){
  let draft;
  try{const spec=Object.fromEntries(Object.entries(args).filter(([k])=>
    k!=='confirm'&&k!=='dryRun'&&k!=='requestKey'));
    draft=composeProjectDraft(spec,ctx.now());}
  catch(e){return refuse(e.message);}
  const {profile}=draft,[owner]=profile.source.repository.split('/');
  if(!authorized(ctx,owner))return refuse('The connected account is not authorized for this repository.');
  if(!ctx.db?.getKnownProject||!ctx.db?.createKnownProject)
    return refuse('The durable project profile store is unavailable.');
  let stored;
  try{stored=await ctx.db.getKnownProject(profile.id);}
  catch{return refuse('Project profile persistence could not be read. No changes attempted.');}
  let plan;
  try{plan=await planProjectSetup(ctx,draft,stored);}
  catch{return refuse('Project setup inspection failed; no mutation attempted.');}
  const base={project:profile.id,repository:draft.repository,draft:profile,
    appNeedsText:draft.doc,ownerReview:draft.review,
    stage:plan.status,step:plan.detail,version:stored?.version??null};
  if(!['save_draft','change'].includes(plan.status))
    return reply({...base,done:plan.status==='complete',
      ...(plan.next?{next:plan.next}:{}),
      ...(plan.status==='needs_owner_review'?{blockedStep:plan.detail}: {})});
  if(ctx.connection.profile!=='full')
    return reply({...base,done:false,status:'needs_full_profile',
      next:'Explicit full profile is required for any setup write.'});
  if(args.dryRun===true||args.confirm!==true)
    return reply({...base,done:false,status:'preview',
      next:'Confirm this one named action; existing production, spending and approval safeguards still apply.',
      ...(plan.tool?{guardedTool:plan.tool,args:plan.args}:{})});
  if(plan.status==='save_draft'){
    try{
      const created=await ctx.db.createKnownProject(profile);
      return reply({...base,done:false,status:created?'draft_saved':'concurrent_draft',
        version:created?.version??null,
        next:'Rerun with the same desired state to inspect/advance one guarded provider step.'});
    }catch{return refuse('Draft checkpoint could not be persisted. No provider action attempted.');}
  }
  if(typeof ctx.callTool!=='function')
    return refuse('Guarded write dispatcher unavailable; no mutation was sent.');
  const selected={...plan.args,confirm:true,...(args.requestKey?{requestKey:args.requestKey}:{})};
  const result=await ctx.callTool(plan.tool,selected);
  const outcome=body(result);
  if(outcome?.status!=='applied')
    return reply({...base,done:false,status:'not_applied',tool:plan.tool,
      underlying_status:outcome?.status??'unknown',
      explanation:outcome?.error??result.content?.[0]?.text??'Underlying tool did not confirm its readback.'});
  // Resume by provider state, not by an incremented local stage counter.
  return reply({...base,done:false,status:'step_applied',tool:plan.tool,
    next:'Rerun the setup plan: it will read GitHub again before choosing the next independent action.'});
}
const workflow={
  name:'github_workflow_project_setup',area:'workflow',audience:['B','O'],
  description:'Resumable project creation, rules, labels, environments and security: one guarded approved step per call; draft only.',
  usesRegistry:true,passthrough:true,profiles:['full'],
  delegatedWrites:['github_repo_create','github_repo_update_settings',
    'github_ruleset_save','github_label_save','github_env_save','github_security_set_feature'],
  inputSchema:{type:'object',properties:setupInput,
    required:['id','name','owner','repo','description','visibility','requiredChecks'],
    additionalProperties:false},
  annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}
};
export const tools=[profileDraft.tool,workflow];
export const handlers={[profileDraft.tool.name]:profileDraft.handler,[workflow.name]:setup};
