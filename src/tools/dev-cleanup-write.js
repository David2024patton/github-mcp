// V-2 guarded scratch teardown. Live calls require independently authorized connected OAuth.
import { defineGithubWrite } from './define-github-write.js';
import { ownerOf } from './github-write.js';
import { readCleanupRun, executeCleanup, readCleanupAfter } from '../dev/cleanup-execute.js';

const RUN={type:'string',minLength:3,maxLength:43,pattern:'^[a-z][a-z0-9-]{2,42}$'};
const REPO={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$'};
const OWNER={type:'string',maxLength:39};

const cleanup=defineGithubWrite({
  name:'github_dev_cleanup',area:'dev',audience:['B'],
  description:'Confirm and clean exact run-owned private scratch objects; refuse uncertain or foreign identities.',
  properties:{owner:OWNER,repo:REPO,runId:RUN},required:['repo','runId'],
  declarations:{production:'never',confirm:'always'},
  target:(args,ctx)=>{
    if(ctx.connection?.mode!=='preview')throw new TypeError('Developer cleanup requires preview-only connection.');
    return {owner:ownerOf(args,ctx),repo:args.repo,scope:'repo'};
  },
  read:(args,ctx,target)=>readCleanupRun(ctx,target.owner,args.repo,args.runId),
  classify:()=>({}),
  summarize:({args,target,before})=>`Delete exact recorded PRIVATE scratch ${target.owner}/${args.repo} for run ${args.runId}, close its recorded draft PRs and verify all ${before.plan.count} remaining objects are absent. This cannot be undone.`,
  apply:async({args,ctx,target,before})=>({data:await executeCleanup(ctx,{owner:target.owner,repo:args.repo,runId:args.runId,before})}),
  readAfter:({args,ctx,target})=>readCleanupAfter(ctx,{owner:target.owner,repo:args.repo,runId:args.runId}),
  verify:({after,response})=>response.data.verified===true&&after.repo===null&&
    after.run?.status==='cleaned'&&after.objects.length<50&&after.objects.every(o=>o.cleaned===true),
  inverse:()=>null,
  present:({args,response,after})=>({run_id:args.runId,cleanup:response.data,
    status:after.run?.status,remaining:after.objects.filter(o=>!o.cleaned).length})
});
export const tools=[cleanup.tool];
export const handlers={[cleanup.tool.name]:cleanup.handler};
