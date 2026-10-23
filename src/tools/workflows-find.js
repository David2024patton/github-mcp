// W-7: scoped discovery/digest plus the original standard-repository desired state.
import {createHash} from 'node:crypto';
import {defineRead} from './define-read.js';
const OWNER={type:'string',minLength:1,maxLength:39},REPO={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9._-]+$'};
const safe=r=>r&&!r.isError?r.structuredContent??null:null;
const partial=x=>!x||!!(x.kept_result||x.more_exist||x.more_possible||x.next_page_possible||x.incomplete_results||x.complete===false);
const receipt=(data,error=false)=>({structuredContent:data,content:[{type:'text',text:JSON.stringify(data)}],...error?{isError:true}:{}});
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function actor(a,c){
  const owner=a.owner??c.connection.default_account;
  if(!c.connection.accounts?.some(x=>x.toLowerCase()===owner.toLowerCase()))throw new TypeError('Account is not enrolled in this connection.');
  return owner;
}
function observation(c){
  const start=c.now(),sections=[];
  const time=()=>c.now()-start<46000;
  async function read(id,name,args){
    if(!time()){sections.push({id,status:'not_attempted',reason:'Workflow time budget exhausted.'});return null;}
    let result;try{result=await c.callTool(name,args);}catch{result=null;}
    const data=safe(result);
    sections.push({id,tool:name,status:!data?'not_readable':partial(data)?'partial':'observed',
      ...!data?{reason:(result?.content?.find(x=>x.type==='text')?.text??'Wrapped read unavailable.').slice(0,400)}:{}});
    return data;
  }
  return {read,time,sections,finish:data=>({done:sections.every(x=>x.status==='observed'),
    status:sections.every(x=>x.status==='observed')?'observed':'partial',sections,...data,
    note:'Bounded read-only observations; no write, notification, grant, repair or purchase.'})};
}
export async function find(a,c){
  const owner=actor(a,c),s=observation(c),groups=[];
  const query=a.query.replace(/["\\\r\n]/g,' ').trim();
  if(!query)throw new TypeError('A nonempty search phrase is required.');
  let qualifier='repo:'+owner+'/'+a.repo;
  if(!a.repo){
    const identity=await s.read('identity','github_whoami',{detail:'brief'});
    const type=identity?.accounts?.find(x=>x.login.toLowerCase()===owner.toLowerCase())?.type;
    if(!['Organization','User'].includes(type))return s.finish({owner,groups,reason:'Account type is unknown; specify one repository rather than guessing an account-wide search scope.'});
    qualifier=(type==='Organization'?'org:':'user:')+owner;
  }
  for(const kind of ['repository','pull_request','issue','commit']){
    const searchScope=kind==='repository'?'user:'+owner:qualifier;
    const result=await s.read(kind,'github_search_github',{owner,type:kind,query:'"'+query+'" '+searchScope,page:a.page??1,max:a.max??20});
    const items=(result?.items??[]).filter(x=>{
      const name=kind==='repository'?x.full_name:x.repository;
      return typeof name==='string'&&name.toLowerCase().startsWith(owner.toLowerCase()+'/')&&(!a.repo||name.toLowerCase()===`${owner}/${a.repo}`.toLowerCase());
    });
    const outside=items.length!==(result?.items??[]).length;
    if(outside)s.sections.push({id:kind+':scope',status:'partial',reason:'Results outside the selected account/repository were excluded; no exhaustive absence is claimed.'});
    groups.push({kind,items,complete:!!result&&!partial(result)&&!outside,...result?.more_possible?{next_page:(a.page??1)+1}:{}});
  }
  const repositories=a.repo?{items:[{name:a.repo}]}:await s.read('repositories','github_repo_list',{owner,max:a.maxRepositories??3,detail:'full',fields:['name','full_name']});
  const needle=query.toLowerCase();
  for(const repository of repositories?.items??[]){
    const repo=repository.name??repository.full_name?.split('/')[1];
    if(!repo){s.sections.push({id:'repository-identity',status:'not_readable'});continue;}
    const base={owner,repo};
    const runs=await s.read(repo+':runs','github_actions_list_runs',{...base,max:100,fields:['id','name','display_title','head_sha','head_branch','html_url'],detail:'full'});
    groups.push({kind:'run',repo,items:(runs?.items??[]).filter(x=>[x.name,x.display_title,x.head_sha,x.head_branch].some(v=>String(v??'').toLowerCase().includes(needle))),complete:!!runs&&!partial(runs),search_scope:'Bounded latest-run metadata; no log/body search.'});
    const releases=await s.read(repo+':releases','github_release_list',{...base,page:a.page??1,max:30,fields:['id','tag_name','name','body','html_url']});
    groups.push({kind:'release',repo,items:(releases?.items??[]).filter(x=>[x.tag_name,x.name,x.body].some(v=>String(v??'').toLowerCase().includes(needle))),complete:!!releases&&!partial(releases),...releases?.next_page_possible?{next_page:releases.next_page_possible}:{}});
  }
  return s.finish({owner,...a.repo?{repo:a.repo}:{},query:a.query,groups,
    next:'Use each group continuation where present. Capped/truncated metadata is not an exhaustive negative search.'});
}
const denver=ms=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',dateStyle:'medium',timeStyle:'short'}).format(new Date(ms));
const dollar=cents=>Number.isSafeInteger(cents)?'$'+(cents/100).toFixed(2):null;
export async function digest(a,c){
  const requested=a.accounts??c.connection.accounts;
  if(new Set(requested.map(x=>x.toLowerCase())).size!==requested.length)throw new TypeError('Accounts must be distinct.');
  for(const owner of requested)actor({owner},c);
  const s=observation(c),identity=await s.read('identity','github_whoami',{detail:'brief'});
  const end=Math.floor(c.now()/86400000)*86400000,start=end-7*86400000;
  const inWindow=value=>{const ms=Date.parse(value);return Number.isFinite(ms)&&ms>=start&&ms<end;};
  const accounts=[];
  for(const owner of requested){
    if(!s.time()){s.sections.push({id:owner,status:'not_attempted',reason:'Account not inspected before workflow budget.'});break;}
    const type=identity?.accounts?.find(x=>x.login.toLowerCase()===owner.toLowerCase())?.type;
    const repositories=await s.read(owner+':repositories','github_repo_list',{owner,max:a.maxRepositories??3,fields:['name','full_name'],detail:'full'});
    const report={owner,repositories:[],pending_invitations:null,billed_usage:{actions_cents:0,copilot_cents:0,complete:true,days:[]}};
    if(type==='Organization'){
      const invitations=await s.read(owner+':invitations','github_org_list_invitations',{owner,max:100});
      report.pending_invitations=invitations?{pending:invitations.pending?.length??null,failed:invitations.failed?.length??null,complete:!partial(invitations)}:null;
    }else if(type==='User')report.pending_invitations={status:'not_applicable',reason:'Organization invitations do not apply to a personal account.'};
    else s.sections.push({id:owner+':account-type',status:'not_readable',reason:'Account type was not disclosed; no organization or billing scope was guessed.'});
    for(const repository of repositories?.items??[]){
      if(!s.time()){s.sections.push({id:owner+':repository-budget',status:'not_attempted',reason:'Remaining repositories were not inspected.'});break;}
      const repo=repository.name??repository.full_name?.split('/')[1];
      if(!repo){s.sections.push({id:owner+':repository-identity',status:'not_readable'});continue;}
      const base={owner,repo};
      const prs=await s.read(owner+'/'+repo+':prs','github_pr_list',{...base,state:'closed',max:100,detail:'full',fields:['number','merged_at','html_url']});
      const runs=await s.read(owner+'/'+repo+':runs','github_actions_list_runs',{...base,max:100,detail:'full',fields:['id','created_at','status','conclusion']});
      const observed=(runs?.items??[]).filter(x=>inWindow(x.created_at)&&x.status==='completed');
      const failures=observed.filter(x=>['failure','timed_out','action_required'].includes(x.conclusion)).length;
      const entry={repo,merged_prs:prs?(prs.items??[]).filter(x=>inWindow(x.merged_at)).map(x=>({number:x.number,html_url:x.html_url})):null,
        ci:runs?{completed:observed.length,failures,failure_rate:observed.length?failures/observed.length:null,complete:!partial(runs)}:null,open_alerts:{}};
      for(const kind of ['dependabot','code','secret']){
        const alerts=await s.read(owner+'/'+repo+':'+kind,'github_security_list_alerts',{...base,kind,state:'open',max:100});
        entry.open_alerts[kind]=alerts?{count:alerts.count??alerts.items?.length,complete:!partial(alerts)}:null;
      }
      report.repositories.push(entry);
    }
    for(let day=0;day<7;day++){
      const date=new Date(start+day*86400000);
      if(!['Organization','User'].includes(type)){report.billed_usage.complete=false;break;}
      const cost=await s.read(owner+':billing:'+date.toISOString().slice(0,10),'github_billing_get_usage',{
        owner,scope:type==='Organization'?'organization':'user',year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate(),max:500});
      const dayKey=date.toISOString().slice(0,10);
      // The registered billing reader returns a verified envelope with nested
      // usage.items/complete/total_net_dollars, not flat top-level fields.
      // Validate the responding principal and billing month as well as every
      // line's requested day before calling any reported cents an actual bill.
      const usage=cost?.usage;
      const expectedScope=type==='Organization'?'organization':'user';
      const good=!!cost&&cost.owner?.toLowerCase()===owner.toLowerCase()&&
        cost.scope===expectedScope&&cost.year===date.getUTCFullYear()&&cost.month===date.getUTCMonth()+1&&
        !!usage&&usage.complete===true&&!partial(usage)&&Array.isArray(usage.items)&&
        Number.isFinite(usage.total_net_dollars)&&usage.total_net_dollars>=0&&
        Number.isSafeInteger(Math.round(usage.total_net_dollars*100))&&
        (usage.items.length>0||usage.total_net_dollars===0)&&usage.items.every(x=>
          Number.isFinite(x.net_dollars)&&Number.isSafeInteger(Math.round(x.net_dollars*100))&&x.net_dollars>=0&&
          typeof x.product==='string'&&x.product.length>0&&
          Number.isFinite(Date.parse(x.date))&&new Date(x.date).toISOString().slice(0,10)===dayKey);
      report.billed_usage.days.push({date:dayKey,status:good?'observed':'unknown'});
      if(!good){report.billed_usage.complete=false;s.sections.push({id:owner+':billing-shape:'+dayKey,status:'not_readable',reason:'Complete date-bound billed costs were not verified.'});continue;}
      for(const item of usage.items){
        const product=item.product.toLowerCase(),cents=Math.round(item.net_dollars*100);
        if(product.includes('actions'))report.billed_usage.actions_cents+=cents;
        else if(product.includes('copilot'))report.billed_usage.copilot_cents+=cents;
      }
      if(!Number.isSafeInteger(report.billed_usage.actions_cents)||!Number.isSafeInteger(report.billed_usage.copilot_cents)){report.billed_usage.complete=false;s.sections.push({id:owner+':cost-range',status:'not_readable',reason:'Usage exceeds safe integer cents.'});}
    }
    if(!report.billed_usage.complete){report.billed_usage.actions_cents=null;report.billed_usage.copilot_cents=null;}
    report.billed_usage.actions_display=dollar(report.billed_usage.actions_cents);
    report.billed_usage.copilot_display=dollar(report.billed_usage.copilot_cents);
    report.billed_usage.coverage='Provider-reported billed usage only. Fixed subscriptions or seat invoices not exposed in usage are not inferred from estimated prices.';
    accounts.push(report);
  }
  return s.finish({period:{from:new Date(start).toISOString(),until:new Date(end).toISOString(),from_denver:denver(start),until_denver:denver(end),basis:'Last seven complete UTC billing days, end exclusive; the same activity interval is displayed in Denver time.'},accounts});
}
async function child(c,name,args){const r=await c.callTool(name,args);return r?.structuredContent??{status:'unknown',reason:(r?.content?.[0]?.text??'No verified result').slice(0,400)};}
const allowedSetup=new Set(['github_repo_create','github_repo_update_settings','github_ruleset_save','github_label_save','github_env_save','github_security_set_feature']);
export async function newRepo(a,c){
  const owner=actor(a,c),start=c.now(),base={owner,repo:a.repo};
  if(c.connection.profile!=='full')return receipt({done:false,status:'refused',reason:'New repository setup requires the full profile.'},true);
  const project='new-repo-'+hash([owner.toLowerCase(),a.repo.toLowerCase()]).slice(0,20);
  const desired={id:project,name:('Repository '+a.repo).slice(0,100),...base,description:a.description??'Standard GitHub repository '+a.repo,
    visibility:a.visibility??'private',requiredChecks:a.requiredChecks??['ci'],environments:[]};
  const plan=await child(c,'github_workflow_project_setup',{...desired,dryRun:true,confirm:false});
  const blocked=plan.stage!=='complete'&&!(plan.stage==='needs_owner_review'&&plan.conditional_feature);
  if(c.now()-start>=46000)return receipt({done:false,status:'pending',reason:'Setup planning used the workflow time budget; no changes attempted.'});
  const execute=async(name,args,step)=>{
    if(c.now()-start>=46000)return receipt({done:false,status:'pending',reason:'Workflow budget expired before mutation; resume from fresh reads.'});
    if(a.confirm&&!a.dryRun&&!a.requestKey)return receipt({done:false,status:'refused',reason:'Confirmed setup requires a stable requestKey.'},true);
    const requestKey='w7-'+hash([a.requestKey,owner,a.repo,step]);
    const result=await child(c,name,{...args,dryRun:a.dryRun===true||a.confirm!==true,confirm:a.confirm===true,requestKey});
    return receipt({done:false,status:result.status==='applied'?'step_applied':result.status??'unknown',step,tool:name,result,
      next:'Repeat the identical desired state; fresh reads choose the next step. Do not change requestKey to recover uncertainty.'});
  };
  if(plan.stage==='save_draft')return execute('github_workflow_project_setup',desired,'save-draft');
  if(blocked){
    if(plan.guardedTool&&allowedSetup.has(plan.guardedTool)){
      const args={...plan.args};
      if(plan.guardedTool==='github_repo_create')args.auto_init=true;
      return execute(plan.guardedTool,args,'setup:'+plan.guardedTool+':'+hash(args).slice(0,16));
    }
    return receipt({done:false,status:plan.stage??plan.status??'not_readable',result:plan,next:'Resolve this exact setup prerequisite before changing repository policy.'});
  }
  const repo=safe(await c.callTool('github_repo_get',base));
  if(!repo?.default_branch)return receipt({done:false,status:'not_readable',reason:'Repository state could not be independently read.'});
  if(repo.default_branch!=='main'){
    const branches=safe(await c.callTool('github_branch_list',{...base,max:100,fields:['name']}));
    if(partial(branches))return receipt({done:false,status:'not_readable',reason:'Complete branch inventory is required before selecting main.'});
    if(!(branches.items??[]).some(x=>x.name==='main'))return execute('github_branch_create',{...base,branch:'main',from:repo.default_branch},'create-main');
    return execute('github_repo_set_default_branch',{...base,branch:'main'},'default-main');
  }
  const options=repo.merge_options;
  if(!options||['merge_commit','squash','rebase','delete_branch_on_merge'].some(k=>typeof options[k]!=='boolean'))return receipt({done:false,status:'not_readable',reason:'Merge settings were not fully disclosed.'});
  if(!options.merge_commit||options.squash||options.rebase||!options.delete_branch_on_merge)
    return execute('github_repo_update_settings',{...base,allow_merge_commit:true,allow_squash_merge:false,allow_rebase_merge:false,delete_branch_on_merge:true},'merge-policy');
  const alerts=safe(await c.callTool('github_repo_get_vulnerability_alerts',base));
  if(typeof alerts?.enabled!=='boolean')return receipt({done:false,status:'not_readable',reason:'Dependabot alert enabled state could not be verified.'});
  if(!alerts.enabled)return execute('github_repo_set_vulnerability_alerts',{...base,enabled:true},'dependabot-alerts');
  const actions=safe(await c.callTool('github_actions_get_settings',base));
  const forkNA=Boolean(actions?.fork?.not_applicable);
  if(!actions?.workflow?.default_workflow_permissions||(!actions.fork?.approval_policy&&!forkNA))return receipt({done:false,status:'not_readable',reason:'Actions/fork policy is unreadable; no values were guessed.'});
  if(actions.workflow.default_workflow_permissions!=='read'||actions.workflow.can_approve_pull_request_reviews!==false)
    return execute('github_actions_set_settings',{...base,section:'workflow',changes:{default_workflow_permissions:'read',can_approve_pull_request_reviews:false}},'actions-token');
  if(!forkNA&&actions.fork.approval_policy!=='all_external_contributors')return execute('github_actions_set_settings',{...base,section:'fork',changes:{approval_policy:'all_external_contributors'}},'fork-approval');
  if(c.now()-start>=46000)return receipt({done:false,status:'pending',reason:'Resume to verify the completed setup after the workflow deadline.'});
  return receipt({done:!plan.conditional_feature,status:plan.conditional_feature?'partially_configured':'configured',owner,repo:a.repo,project,
    ...plan.conditional_feature?{conditional_security:{status:'owner_review_required',feature:plan.conditional_feature,reason:'Private security activation needs verified pricing/eligibility and independent owner authority; no plan entitlement was guessed.'}}:{},
    next:plan.conditional_feature?'Independent defaults are observed; private security still needs its exact pricing/eligibility and owner decision. The optional profile stays draft.':'The standard provider-verifiable policy is observed. The optional project profile stays draft until independent owner review.'});
}
const definitions=[
  defineRead({name:'github_workflow_find',area:'workflow',audience:['Op'],description:'Find related PRs, issues, commits, workflow runs and releases in one enrolled repository; retain partial coverage.',properties:{owner:OWNER,repo:REPO,query:{type:'string',minLength:1,maxLength:120},page:{type:'integer',minimum:1,maximum:30},max:{type:'integer',minimum:1,maximum:50},maxRepositories:{type:'integer',minimum:1,maximum:20}},required:['query'],handler:find}),
  defineRead({name:'github_workflow_weekly_digest',area:'workflow',audience:['O','Op'],description:'Summarize seven complete billing days of merged PRs, CI, alerts, actual usage and invitations with Denver dates.',properties:{accounts:{type:'array',items:OWNER,minItems:1,maxItems:10,uniqueItems:true},maxRepositories:{type:'integer',minimum:1,maximum:20}},handler:digest})
];
const setupTool={name:'github_workflow_new_repo',area:'workflow',audience:['B','O'],description:'Create a private-by-default repository with the approved standard rules, security and Actions policy; one guarded step per call.',usesRegistry:true,passthrough:true,boundsResult:true,profiles:['full'],
  delegatedWrites:['github_repo_create','github_repo_update_settings','github_ruleset_save','github_label_save','github_env_save','github_security_set_feature','github_branch_create','github_repo_set_default_branch','github_repo_set_vulnerability_alerts','github_actions_set_settings'],
  inputSchema:{type:'object',properties:{owner:OWNER,repo:REPO,description:{type:'string',minLength:1,maxLength:350},visibility:{type:'string',enum:['private','public']},requiredChecks:{type:'array',items:{type:'string',minLength:1,maxLength:100},minItems:1,maxItems:15,uniqueItems:true},confirm:{type:'boolean'},dryRun:{type:'boolean'},requestKey:{type:'string',minLength:4,maxLength:128}},required:['repo'],additionalProperties:false},
  annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}};
export const tools=[...definitions.map(x=>({...x.tool,usesRegistry:true})),setupTool];
export const handlers={...Object.fromEntries(definitions.map(x=>[x.tool.name,x.handler])),[setupTool.name]:newRepo};
