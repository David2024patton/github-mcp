// V-1 scratch creation only: GitHub writes are blocked until IN-06 is verified in server-owned account state.
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal } from './github-write.js';
import { requireScratchOrg } from '../dev/scratch.js';
import { matchesRunDescription } from '../dev/run-marker.js';
import { runDevMutationOnce } from '../dev/execute.js';
import { captureScratchOrigin } from '../dev/scratch-origin.js';

const RUN={type:'string',minLength:3,maxLength:43,pattern:'^[a-z][a-z0-9-]{2,42}$'};
const NAME={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$'};
const OWNER={type:'string',maxLength:39};
const tag=id=>`rtc_run=${id}`;
const repoGet=(ctx,owner,repo)=>missing(async()=>(await (await octo(ctx,owner)).request('GET /repos/{owner}/{repo}',{owner,repo})).data);

const scratchCreate=defineGithubWrite({
  name:'github_dev_create_scratch_repo',area:'dev',audience:['B'],
  description:'Create a private, run-labelled repository only in an owner-verified, isolated scratch organization.',
  properties:{owner:OWNER,runId:RUN,name:NAME},required:['runId','name'],
  declarations:{production:'never'},
  target:(args,ctx)=>{
    if(ctx.connection?.mode!=='preview')throw new TypeError('Developer writes are unavailable in production mode.');
    return {owner:ownerOf(args,ctx),repo:args.name,scope:'repo'};
  },
  read:async(args,ctx,target)=>{
    await requireScratchOrg(ctx,target.owner);
    return {existing:await repoGet(ctx,target.owner,args.name),run:await ctx.db.getDevRun({
      id:args.runId,account:target.owner,connection:ctx.connection.client_id})};
  },
  classify:()=>({}),
  summarize:({args,before,target})=>before?.existing
    ? `The repository ${target.owner}/${args.name} already exists; it will not be overwritten`
    : `Create PRIVATE scratch repository ${target.owner}/${args.name} marked ${tag(args.runId)}; it is added to this connection's durable run`,
  apply:async({args,ctx,target,before})=>{
    if(before.existing)throw refusal('A repository with this name already exists. Choose another scratch name.');
    const created=await runDevMutationOnce(ctx,{
      runId:args.runId,account:target.owner,connection:ctx.connection.client_id,
      stepId:'create-scratch-repo',type:'repo',owner:target.owner,repo:args.name,objectName:args.name,
      scenarios:['repo-basic'],create:async()=>{
        const data=(await (await octo(ctx,target.owner)).request('POST /orgs/{org}/repos',{
          org:target.owner,name:args.name,private:true,auto_init:true,
          description:`Scratch fixture for ${tag(args.runId)}`
        })).data;
        if(data?.full_name?.toLowerCase()!==`${target.owner}/${args.name}`.toLowerCase()||data.private!==true)
          throw refusal('GitHub did not return the private repository at the requested exact location.');
        const github=await octo(ctx,target.owner);
        return {objectId:data.full_name,createdSha:await captureScratchOrigin(github,{
          owner:target.owner,repo:args.name,runId:args.runId,created:data})};
      }});
    return {data:created};
  },
  readAfter:({args,ctx,target})=>repoGet(ctx,target.owner,args.name),
  verify:({args,target,after,response})=>!!after&&after.full_name?.toLowerCase()===`${target.owner}/${args.name}`.toLowerCase()&&
    after.private===true&&matchesRunDescription(after.description,args.runId)&&
    response.data.objectId.toLowerCase()===after.full_name.toLowerCase(),
  inverse:()=>null,
  present:({args,after,response})=>({run_id:args.runId,full_name:after?.full_name,private:after?.private,
    recorded_object_id:response.data.objectId,replayed:response.data.replayed,marker:tag(args.runId)})
});
export const tools=[scratchCreate.tool];
export const handlers={[scratchCreate.tool.name]:scratchCreate.handler};
