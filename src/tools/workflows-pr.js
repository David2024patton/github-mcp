// W-1: Compose the reviewed PR read/write tools; never issue an unguarded provider write.
// A workflow invocation advances at most one durable write, then resumes from fresh reads.
const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const NUMBER={type:'integer',minimum:1},BRANCH={type:'string',minLength:1,maxLength:250};
const TITLE={type:'string',minLength:1,maxLength:256},BODY={type:'string',maxLength:20000};
const LABELS={type:'array',maxItems:20,uniqueItems:true,items:{type:'string',minLength:1,maxLength:100}};
const receipt=(data,error=false)=>({structuredContent:data,
  content:[{type:'text',text:JSON.stringify(data)}],...(error?{isError:true}:{})});
const refused=(why)=>receipt({done:false,status:'refused',reason:why},true);
const clock=(ctx)=>typeof ctx.now==='function'?ctx.now():Date.now();
const within=(ctx,start)=>clock(ctx)-start<46000;
const readBody=(response)=>{
  if(response?.isError||!response?.structuredContent)return null;
  return response.structuredContent;
};
async function call(ctx,name,args){
  if(typeof ctx.callTool!=='function')throw new Error('The guarded tool dispatcher is unavailable.');
  return ctx.callTool(name,args);
}
const scope=(a)=>({...(a.owner?{owner:a.owner}:{}),repo:a.repo});
const short=x=>String(x??'').slice(0,8);
function nextAction(p){
  if(p.state!=='open')return p.merged?'Already merged.':'Closed; reopen it before continuing.';
  if(p.draft)return 'Mark this draft ready for review.';
  if(p.mergeable===false)return 'Resolve merge conflicts before merging.';
  if(p.mergeable!==true)return 'GitHub has not confirmed mergeability; check again.';
  if(!Number.isInteger(p.threads?.unresolved))return 'Review threads could not be verified; fix their read permission first.';
  if(p.threads.unresolved>0)return 'Address and resolve the outstanding review threads.';
  if(['CHANGES_REQUESTED','REVIEW_REQUIRED'].includes(p.review_decision))
    return 'Resolve the blocking review decision.';
  if(p.checks?.green!==true)return p.checks?.green===null
    ?'Required checks could not be verified; inspect permissions and rerun the read.'
    :'Wait for or repair required CI checks at this exact head.';
  return 'All checks appear green. Re-read the exact head and use merge_when_green with independent confirmation.';
}
export async function inspectPr(args,ctx){
  const start=clock(ctx),base=scope(args);
  const pr=readBody(await call(ctx,'github_pr_get',{...base,number:args.number}));
  if(!pr)return {done:false,status:'not_readable',number:args.number,
    next:'The PR or its required CI/review evidence could not be read.'};
  let position={state:'not_readable',note:'Stack membership could not be checked.'};
  if(within(ctx,start)){
    const r=readBody(await call(ctx,'github_pr_list_stacks',{...base,pullRequest:args.number,max:30}));
    if(r&&!r.next_page_possible&&r.count===0)position={state:'none'};
    else if(r&&Array.isArray(r.items)&&!r.next_page_possible){
      const matches=r.items.flatMap(s=>(s.pull_requests??[]).map((p,i)=>({
        stack:s.number,position:i+1,number:p.number,count:s.pull_requests.length
      }))).filter(x=>x.number===args.number);
      position=matches.length?{state:'found',items:matches}:{state:'none'};
    }
  }
  const next=nextAction(pr);
  return {done:true,status:'observed',number:pr.number,head_sha:pr.head_sha,
    head:pr.head,base:pr.base,draft:pr.draft,state:pr.state,merged:pr.merged,
    mergeable:pr.mergeable,mergeable_state:pr.mergeable_state,
    checks:pr.checks??null,review_decision:pr.review_decision??null,
    unresolved_threads:pr.threads?.unresolved??null,stack:position,
    next_action:next,can_request_merge:next.startsWith('All checks'),
    html_url:pr.html_url,observed_at:new Date(clock(ctx)).toISOString(),
    ...(within(ctx,start)?{}:{incomplete:true,reason:'The 50-second workflow budget is nearly exhausted.'})};
}
const statusTool={
  name:'github_workflow_pr_status',area:'workflow',audience:['B','Op'],compact:true,
  description:'Read a PR with head-specific CI, review threads, stack membership and one actionable next step.',
  usesRegistry:true,
  inputSchema:{type:'object',properties:{owner:OWNER,repo:REPO,number:NUMBER},required:['repo','number'],additionalProperties:false},
  annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}
};
async function openPr(args,ctx){
  if(!['everyday','full'].includes(ctx.connection?.profile))
    return refused('Opening PRs requires the everyday or full connection profile.');
  const start=clock(ctx),s=scope(args);
  let repo;
  try{repo=readBody(await call(ctx,'github_repo_get',s));}
  catch{return refused('The repository could not be read before opening its PR.');}
  if(!repo?.default_branch)return refused('The default branch is unreadable; no PR was opened.');
  const base=args.base??repo.default_branch;
  if((args.head.includes(':')?args.head.split(':').pop():args.head)===base)
    return refused('The PR head and base must be different branches.');
  if(!within(ctx,start))return receipt({done:false,status:'pending',next:'Workflow time budget exhausted before any change.'});
  const requested=(args.labels??[]).map(x=>x.trim()).filter(Boolean);
  if(new Set(requested.map(x=>x.toLowerCase())).size!==requested.length)
    return refused('Duplicate or blank label names are not allowed.');
  const head=args.head.includes(':')?args.head:(args.owner??ctx.connection.default_account)+':'+args.head;
  const listed=readBody(await call(ctx,'github_pr_list',{...s,base,head,max:20}));
  if(!listed||listed.more_exist)return refused('Open PR inventory is incomplete; cannot verify idempotence.');
  const matches=(listed.items??[]).filter(p=>p.head?.ref===args.head.split(':').pop()&&p.base?.ref===base);
  if(matches.length>1)return refused('Several open PRs match that head/base; select one explicitly.');
  let existing=matches[0]??null;
  if(existing){
    const status=readBody(await call(ctx,'github_pr_get',{...s,number:existing.number}));
    if(!status)return refused('The existing PR cannot be independently read.');
    const missing=requested.filter(label=>!(status.labels??[]).some(x=>x.toLowerCase()===label.toLowerCase()));
    if(!missing.length){
      return receipt({done:true,status:'existing',number:status.number,
        head_sha:status.head_sha,base,status: 'existing',next_action:nextAction(status),
        html_url:status.html_url,labels:status.labels});
    }
    if(!within(ctx,start))return receipt({done:false,status:'pending',number:status.number,next:'Resume label application after the workflow budget refreshes.'});
    const mutation=await call(ctx,'github_issue_set_labels',{
      ...s,number:status.number,labels:[...(status.labels??[]),...missing],
      confirm:args.confirm===true,dryRun:args.dryRun===true,
      ...(args.requestKey?{requestKey:args.requestKey+':labels'}:{})});
    const body=readBody(mutation);
    return receipt({done:false,status:body?.status==='applied'?'labels_applied':'labels_not_applied',
      number:status.number,underlying_status:body?.status??'unknown',guarded_tool:'github_issue_set_labels',
      next:'Re-run to verify labels and the PR status through fresh provider reads.'});
  }
  if(!within(ctx,start))return receipt({done:false,status:'pending',next:'Resume creation after the workflow budget refreshes.'});
  const result=await call(ctx,'github_pr_create',{
    ...s,head:args.head,base,title:args.title,body:args.body??'',draft:args.draft===true,
    confirm:args.confirm===true,dryRun:args.dryRun===true,
    ...(args.requestKey?{requestKey:args.requestKey+':create'}:{})});
  const applied=readBody(result);
  return receipt({done:false,status:applied?.status==='applied'?'pr_opened':'not_applied',
    underlying_status:applied?.status??'unknown',guarded_tool:'github_pr_create',
    ...(applied?.number?{number:applied.number}:{}),
    next:'Re-run with the same fields to verify the PR and apply requested labels, if any.'});
}
const openTool={
  name:'github_workflow_open_pr',area:'workflow',audience:['B'],compact:true,
  description:'Open a PR idempotently, then stage labels through the guarded writer; never push code or bypass notification controls.',
  usesRegistry:true,passthrough:true,profiles:['everyday','full'],
  delegatedWrites:['github_pr_create','github_issue_set_labels'],
  inputSchema:{type:'object',properties:{owner:OWNER,repo:REPO,head:BRANCH,
    base:BRANCH,title:TITLE,body:BODY,draft:{type:'boolean'},labels:LABELS,
    confirm:{type:'boolean'},dryRun:{type:'boolean'},
    requestKey:{type:'string',minLength:4,maxLength:128}},
    required:['repo','head','title'],additionalProperties:false},
  annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}
};
export const tools=[statusTool,openTool];
export const handlers={[statusTool.name]:inspectPr,[openTool.name]:openPr};
