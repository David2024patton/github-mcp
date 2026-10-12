// V-1: two complete, real GitHub scenario builders. The other five plans stay non-executable until implemented.
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal } from './github-write.js';
import { requireScratchOrg } from '../dev/scratch.js';
import { runDevMutationOnce } from '../dev/execute.js';
import { planScenario } from '../dev/scenarios.js';

export const SEEDABLE=Object.freeze(['repo-basic','failing-ci']);
const RUN={type:'string',minLength:3,maxLength:43,pattern:'^[a-z][a-z0-9-]{2,42}$'};
const OWNER={type:'string',maxLength:39};
const REPO={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$'};
const marker=id=>`rtc_run=${id}`;
const filePath=id=>`.github/workflows/rtc-${id}.yml`;
const branchName=id=>`rtc/${id}/failure-ref`;
const topic=id=>`rtc-run-${id}`;
const route={owner:'',repo:''};
const repoGet=(ctx,owner,repo)=>missing(async()=>(await (await octo(ctx,owner)).request('GET /repos/{owner}/{repo}',{owner,repo})).data);
const workflowSource=(id,failing)=>`name: RTC ${id}
on:
  workflow_dispatch:
jobs:
  fixture:
    runs-on: ubuntu-latest
    steps:
      - name: ${failing?'Fail':'Pass'} controlled scenario
        run: ${failing?'exit 1':'echo "RTC fixture passed"'}
`;
const same=(a,b)=>String(a??'').toLowerCase()===String(b??'').toLowerCase();

export const seed=defineGithubWrite({
  name:'github_dev_seed',area:'dev',audience:['B'],
  description:'Create repo-basic or failing-ci fixtures in a verified scratch org; all three exact objects are journaled.',
  properties:{owner:OWNER,repo:REPO,runId:RUN,scenario:{type:'string',enum:[...SEEDABLE]}},
  required:['repo','runId','scenario'],declarations:{production:'never'},
  target:(args,ctx)=>{
    if(ctx.connection?.mode!=='preview')throw new TypeError('Developer scenarios cannot run in production mode.');
    return {owner:ownerOf(args,ctx),repo:args.repo,scope:'repo'};
  },
  read:async(args,ctx,target)=>{
    await requireScratchOrg(ctx,target.owner); // before any outbound GitHub read
    const plan=planScenario(args.scenario,{runId:args.runId,owner:target.owner,repo:args.repo,scratch:true});
    const existing=await repoGet(ctx,target.owner,args.repo);
    if(existing){
      const prior=await ctx.db.getDevIntent({runId:args.runId,account:target.owner,
        connection:ctx.connection.client_id,stepId:'seed-repo'});
      if(!prior||prior.status!=='recorded'||!same(prior.object_id,`${target.owner}/${args.repo}`)||
        existing.private!==true||!String(existing.description??'').includes(marker(args.runId)))
        throw new TypeError('The named repository already exists and was not recorded as this run\'s exact scratch seed. Refusing to change it.');
    }
    return {existing,plan};
  },
  classify:()=>({}),
  summarize:({args,target,before})=>`Seed ${args.scenario} in private scratch ${target.owner}/${args.repo} (${marker(args.runId)}): ${before.plan.objects.map(x=>x.type).join(', ')}. Workflows run only when manually dispatched.`,
  apply:async({args,ctx,target})=>{
    const run={runId:args.runId,account:target.owner,connection:ctx.connection.client_id,
      owner:target.owner,repo:args.repo,scenarios:[args.scenario]};
    const github=await octo(ctx,target.owner);
    const repo=await runDevMutationOnce(ctx,{...run,stepId:'seed-repo',type:'repo',objectName:args.repo,
      create:async()=>{
        const result=(await github.request('POST /orgs/{org}/repos',{org:target.owner,name:args.repo,private:true,auto_init:true,
          description:`Developer fixture for ${marker(args.runId)} (${args.scenario})`})).data;
        if(!same(result?.full_name,`${target.owner}/${args.repo}`)||result.private!==true)
          throw refusal('GitHub did not create the expected private scratch repository.');
        return {objectId:result.full_name};
      }});
    const path=filePath(args.runId);
    const workflow=await runDevMutationOnce(ctx,{...run,stepId:'seed-workflow',type:'workflow_file',objectName:path,
      create:async()=>{
        const result=(await github.request('PUT /repos/{owner}/{repo}/contents/{path}',{
          owner:target.owner,repo:args.repo,path,
          message:`test: add ${marker(args.runId)} workflow`,content:Buffer.from(workflowSource(args.runId,args.scenario==='failing-ci')).toString('base64')
        })).data;
        if(result?.content?.path!==path||!/^[a-f0-9]{40}$/.test(result?.commit?.sha??''))
          throw refusal('GitHub did not confirm the new run-specific workflow file and commit.');
        return {objectId:path,createdSha:result.commit.sha};
      }});
    let third;
    if(args.scenario==='repo-basic'){
      const name=topic(args.runId);
      third=await runDevMutationOnce(ctx,{...run,stepId:'seed-label',type:'label',objectName:name,
        create:async()=>{
          const result=(await github.request('POST /repos/{owner}/{repo}/labels',{
            owner:target.owner,repo:args.repo,name,color:'0969da',description:marker(args.runId)
          })).data;
          if(result?.name!==name)throw refusal('GitHub did not return the created run label.');
          return {objectId:result.name};
        }});
    }else{
      const name=branchName(args.runId);
      third=await runDevMutationOnce(ctx,{...run,stepId:'seed-failure-ref',type:'branch',objectName:name,
        create:async()=>{
          if(!workflow.createdSha)throw refusal('Cannot create a test branch without the recorded workflow commit SHA.');
          const result=(await github.request('POST /repos/{owner}/{repo}/git/refs',{
            owner:target.owner,repo:args.repo,ref:`refs/heads/${name}`,sha:workflow.createdSha
          })).data;
          if(result?.ref!==`refs/heads/${name}`)throw refusal('GitHub did not return the expected test branch.');
          return {objectId:name,createdSha:workflow.createdSha};
        }});
    }
    return {data:{run_id:args.runId,scenario:args.scenario,objects:[repo,workflow,third]}};
  },
  readAfter:async({args,ctx,target})=>{
    const github=await octo(ctx,target.owner);
    const base={owner:target.owner,repo:args.repo};
    const [repository,workflow,extra]=await Promise.all([
      repoGet(ctx,target.owner,args.repo),
      github.request('GET /repos/{owner}/{repo}/contents/{path}',{...base,path:filePath(args.runId)}).then(x=>x.data),
      args.scenario==='repo-basic'
        ? github.request('GET /repos/{owner}/{repo}/labels/{name}',{...base,name:topic(args.runId)}).then(x=>x.data)
        : github.request('GET /repos/{owner}/{repo}/git/ref/{ref}',{...base,ref:`heads/${branchName(args.runId)}`}).then(x=>x.data)
    ]);
    return {repository,workflow,extra};
  },
  verify:async({args,ctx,target,after,response})=>{
    if(!after?.repository||after.repository.private!==true||
      !same(after.repository.full_name,`${target.owner}/${args.repo}`)||
      !String(after.repository.description??'').includes(marker(args.runId))||
      after.workflow?.path!==filePath(args.runId)||typeof after.workflow.content!=='string')return false;
    const content=Buffer.from(after.workflow.content.replace(/\s/g,''),'base64').toString('utf8');
    if(content!==workflowSource(args.runId,args.scenario==='failing-ci'))return false;
    if(args.scenario==='repo-basic'&&after.extra?.name!==topic(args.runId))return false;
    if(args.scenario==='failing-ci'&&after.extra?.ref!==`refs/heads/${branchName(args.runId)}`)return false;
    if(response.data.objects.length!==3)return false;
    const stored=await ctx.db.listDevObjects({runId:args.runId,account:target.owner,
      connection:ctx.connection.client_id,limit:10});
    return response.data.objects.every(o=>stored.some(r=>r.object_id===o.objectId&&r.owner===target.owner&&r.repo===args.repo));
  },
  inverse:()=>null,
  present:({args,response})=>({run_id:args.runId,scenario:args.scenario,created:response.data.objects,
    manual_dispatch_only:true,note:'Workflow files are real, but no Actions run was dispatched; IN-06 is required to use a real scratch organization.'})
});
export const tools=[seed.tool];
export const handlers={[seed.tool.name]:seed.handler};
