// FORK-CI-1: approve ordinary checks for a reviewed public fork PR; never merge or deploy.
import { createHash } from 'node:crypto';
import { defineGithubWrite } from './define-github-write.js';
import { octo, ownerOf, refusal, slug, missing } from './github-write.js';
import { workflowProduction } from './actions-write.js';
const TARGET = (args,ctx) => ({ owner:ownerOf(args,ctx),repo:args.repo,scope:'repo' });
const ROUTE = (t) => ({owner:t.owner,repo:t.repo});
const SHA = /^[a-f0-9]{40}$/i;
const eq=(a,b)=>String(a??'').toLowerCase()===String(b??'').toLowerCase();
const deny=(why)=>{throw refusal(why);};
async function inspect(args,ctx,target,requirePending=false){
  if(!SHA.test(String(args.expectedHeadSha??'')))deny('A reviewed exact 40-character PR head is required.');
  const gh=await octo(ctx,target.owner,'U'),p=ROUTE(target);
  const repository=await missing(async()=>(await gh.request('GET /repos/{owner}/{repo}',p)).data);
  if(!repository || (repository.private!==false && repository.visibility!=='public'))
    deny('Only public fork workflows can be approved here; private or unknown billing exposure is excluded.');
  const pr=await missing(async()=>(await gh.request('GET /repos/{owner}/{repo}/pulls/{pull_number}',{...p,pull_number:args.prNumber})).data);
  if(!pr || pr.state!=='open' || !eq(pr.head?.sha,args.expectedHeadSha) || pr.head?.repo?.fork!==true ||
      eq(pr.head?.repo?.full_name,slug(target.owner,target.repo)) ||
      (pr.base?.repo?.full_name && !eq(pr.base.repo.full_name,slug(target.owner,target.repo))))
    deny('Pull request changed, closed, or is not from a public external fork.');
  const run=await missing(async()=>(await gh.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}',{...p,run_id:args.runId})).data);
  if(!run || run.id!==args.runId || run.event!=='pull_request' ||
      (run.head_repository?.full_name && !eq(run.head_repository.full_name,pr.head.repo.full_name)) ||
      (run.repository?.full_name && !eq(run.repository.full_name,slug(target.owner,target.repo))) ||
      (run.actor?.login && pr.user?.login && !eq(run.actor.login,pr.user.login)) ||
      (Array.isArray(run.pull_requests)&&run.pull_requests.length>0&&!run.pull_requests.some(x=>x.number===args.prNumber)))
    deny('Run does not belong to this exact open fork PR head.');
  // GitHub pull_request workflows usually check a synthetic two-parent merge commit,
  // not the contributor's branch HEAD. Accept only a merge commit whose parents
  // include the exact reviewed PR head; never silently treat an unrelated SHA
  // as authorized. This avoids an MCP-only veto on genuine first-time fork CI.
  if(!eq(run.head_sha,args.expectedHeadSha)){
    if(!SHA.test(String(run.head_sha??'')))deny('Run has no verifiable commit SHA.');
    const merge=await missing(async()=>(await gh.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}',{...p,commit_sha:run.head_sha})).data);
    if(!merge || !Array.isArray(merge.parents) || merge.parents.length!==2 ||
        !merge.parents.some(parent=>eq(parent.sha,args.expectedHeadSha)))
      deny('Run merge commit does not contain the reviewed PR head.');
  }
  if(requirePending && (run.status!=='completed' || run.conclusion!=='action_required'))
    deny('Run already advanced or is no longer awaiting approval; no fresh approval may be sent.');
  if(!/^\.github\/workflows\/[^/]+\.(?:yml|yaml)$/.test(String(run.path??'')))
    deny('Run workflow file could not be verified.');
  if(!Number.isInteger(pr.changed_files)||pr.changed_files<0||pr.changed_files>3000)
    deny('PR file list exceeds independently verifiable single-page limit.');
  const fileData=[];
  const pages=Math.max(1,Math.ceil(pr.changed_files/100));
  for(let page=1;page<=pages;page++){
    const chunk=(await gh.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files',
      {...p,pull_number:args.prNumber,per_page:100,page})).data;
    if(!Array.isArray(chunk)||chunk.length>100)deny('PR file list is incomplete or malformed.');
    fileData.push(...chunk);
  }
  if(fileData.length!==pr.changed_files ||
      fileData.some(f=>typeof f.filename!=='string'||f.filename.startsWith('.github/workflows/')))
    deny('Incomplete file list or modified CI workflows; review and approve outside this limited tool.');
  return {pr,run};
}
const def=defineGithubWrite({
  name:'github_actions_approve_fork_run',area:'actions',audience:['B','Op'],
  description:'Approve one reviewed public fork PR CI run without bypassing required checks.',
  properties:{
    owner:{type:'string',maxLength:39},
    repo:{type:'string',minLength:1,maxLength:100},
    prNumber:{type:'integer',minimum:1},
    runId:{type:'integer',minimum:1},
    expectedHeadSha:{type:'string',pattern:'^[a-fA-F0-9]{40}$'}
  },
  required:['repo','prNumber','runId','expectedHeadSha'],
  declarations:{production:'when-target',confirm:'always',cred:'U',profiles:['full']},
  requestKey:(ctx,args)=>'rmcp_fork_ci_'+createHash('sha256').update(JSON.stringify([
    ctx.connection?.client_id??ctx.connection?.pass_id,String(args.owner??ctx.connection?.default_account).toLowerCase(),
    args.repo.toLowerCase(),args.prNumber,args.runId,args.expectedHeadSha
  ])).digest('hex'),
  target:TARGET,
  read:inspect,
  classify:async({ctx,target,before})=>({
    production:await workflowProduction(ctx,target,{path:before.run.path,contentRef:before.pr.base.ref})
  }),
  summarize:({args,before,target})=>'Approve ordinary CI for public fork PR #'+args.prNumber+
    ' at exact head '+args.expectedHeadSha+', run '+args.runId+' ('+before.run.path+
    ') in '+slug(target.owner,target.repo)+'. Does not merge, bypass checks or deploy.',
  apply:async({args,ctx,target})=>{
    await inspect(args,ctx,target,true); // require still-pending run at mutation time; journal replays remain possible
    return (await octo(ctx,target.owner,'U')).request('POST /repos/{owner}/{repo}/actions/runs/{run_id}/approve',
      {...ROUTE(target),run_id:args.runId});
  },
  readAfter:async({args,ctx,target})=>missing(async()=>(await (await octo(ctx,target.owner,'U'))
    .request('GET /repos/{owner}/{repo}/actions/runs/{run_id}',{...ROUTE(target),run_id:args.runId})).data),
  verify:({args,before,after})=>after?.id===args.runId&&after.event==='pull_request'&&
    eq(after.head_sha,before.run.head_sha)&&(after.status!=='completed'||after.conclusion!=='action_required'),
  present:({args,after})=>({pr_number:args.prNumber,run_id:args.runId,head_sha:args.expectedHeadSha,
    status:after?.status,conclusion:after?.conclusion,
    next:'Wait for exact-head ci and release-policy. This is not a merge or a release.'})
});
export const tools=[def.tool];
export const handlers={[def.tool.name]:def.handler};
