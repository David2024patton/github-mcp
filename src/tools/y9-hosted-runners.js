// Y-9d GitHub-hosted runners. Creating a runner pool can incur unbounded billable minutes;
// those operations remain a guided owner action until GitHub exposes an enforceable financial cap.
import { defineRead } from './define-read.js';
import { defineGithubWrite } from './define-github-write.js';
import { plain } from './github-read.js';
import { octo, ownerOf, missing, refusal } from './github-write.js';

const OWNER={type:'string',minLength:1,maxLength:39};
const ID={type:'integer',minimum:1};
const NAME={type:'string',minLength:1,maxLength:64,pattern:'^[A-Za-z0-9._-]+$'};
const target=(a,c)=>({owner:ownerOf(a,c),scope:'org',kind:'hosted-runner'});
const ROUTE='/orgs/{org}/actions/hosted-runners';
async function gh(c,t){
  const account=await c.db.getAccount(t.owner);
  if(account?.account_type!=='Organization')throw refusal('Hosted runners require an enrolled organization.');
  return octo(c,t.owner,'I');
}
const one=async(c,t,id)=>missing(async()=>(
  await (await gh(c,t)).request('GET '+ROUTE+'/{hosted_runner_id}',{org:t.owner,hosted_runner_id:id})).data);
const shape=x=>x?({id:x.id,name:x.name,group:x.runner_group_id,status:x.status,
  size:x.machine_size_details?.id??null,maximum_runners:x.maximum_runners,
  image:x.image?.id??null,static_ips_enabled:!!x.public_ip_enabled}):null;

const hostedList=defineRead({
  name:'github_hosted_runner_list',area:'actions',audience:['O','Op'],
  description:'Read organization GitHub-hosted runner pools, sizes and maximum concurrency; no runners are created.',
  properties:{owner:OWNER},
  handler:(a,c)=>plain(async()=>{
    const t=target(a,c),client=await gh(c,t),items=[];
    for(let page=1;page<=5;page++){
      const d=(await client.request('GET '+ROUTE,{org:t.owner,per_page:100,page})).data;
      if(!Array.isArray(d?.runners))throw refusal('Runner inventory was unreadable.');
      items.push(...d.runners);
      if(d.runners.length<100&&(!Number.isInteger(d.total_count)||d.total_count===items.length))
        return {owner:t.owner,runners:items.map(shape),complete:true,source:'GitHub'};
    }
    return {owner:t.owner,runners:items.map(shape),complete:false,
      note:'List capped; cannot assume all pools were seen.'};
  })
});
const hostedManage=defineGithubWrite({
  name:'github_hosted_runner_manage',area:'actions',audience:['O'],
  description:'Rename, reduce concurrency or remove a verified hosted runner; price-increasing configuration is refused.',
  properties:{owner:OWNER,runnerId:ID,action:{type:'string',enum:['update','delete']},
    name:NAME,maximumRunners:{type:'integer',minimum:1,maximum:1000}},
  required:['runnerId','action'],
  declarations:{production:'always',confirm:'always',profiles:['full']},
  target,
  read:async(a,c,t)=>{
    const current=await one(c,t,a.runnerId);
    if(!current)throw refusal('Hosted runner not found; nothing to change.');
    return current;
  },
  classify:()=>({production:'changes GitHub-hosted runner organization configuration'}),
  summarize:({args:a,before:b,target:t})=>(a.action==='delete'?'DELETE':'UPDATE')+
    ' hosted runner '+b.name+' ('+a.runnerId+') in '+t.owner+
    '; current maximum '+b.maximum_runners+' runners, requested '+(a.maximumRunners??b.maximum_runners),
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(a.action==='update'){
      if(a.name===undefined&&a.maximumRunners===undefined)throw refusal('Choose a name or a concurrency reduction.');
      if(a.maximumRunners!==undefined&&(!Number.isInteger(b.maximum_runners)||a.maximumRunners>b.maximum_runners))
        throw refusal('Expanding hosted-runner capacity can incur unknown GitHub charges and is not priced safely.');
      if((a.name??b.name)===b.name&&(a.maximumRunners??b.maximum_runners)===b.maximum_runners)
        throw refusal('Runner already has the desired values.');
      return (await gh(ctx,t)).request('PATCH '+ROUTE+'/{hosted_runner_id}',
        {org:t.owner,hosted_runner_id:a.runnerId,...(a.name?{name:a.name}:{}),
          ...(a.maximumRunners!==undefined?{maximum_runners:a.maximumRunners}:{})});
    }
    // Provider deletion is asynchronous (202), so never infer success from the response.
    return (await gh(ctx,t)).request('DELETE '+ROUTE+'/{hosted_runner_id}',
      {org:t.owner,hosted_runner_id:a.runnerId});
  },
  readAfter:({args:a,ctx,target:t})=>one(ctx,t,a.runnerId),
  verify:({args:a,after:x})=>a.action==='delete'?
    x===null:!!x&&(a.name===undefined||x.name===a.name)
      &&(a.maximumRunners===undefined||x.maximum_runners===a.maximumRunners),
  inverse:()=>null,
  present:({args:a,after:x})=>({id:a.runnerId,action:a.action,observed:shape(x),
    note:a.action==='delete'?'Deletion is not confirmed until GitHub returns 404 on readback':null})
});
const hostedCreatePlan=defineRead({
  name:'github_hosted_runner_create_plan',area:'actions',audience:['O'],
  description:'Give exact owner steps for hosted-runner creation; no unpriced, unbounded billed compute is purchased by the agent.',
  properties:{owner:OWNER,name:NAME},
  handler:(a,c)=>plain(async()=>{
    const t=target(a,c),client=await gh(c,t);
    const [sizes,groups]=await Promise.all([
      client.request('GET /orgs/{org}/actions/hosted-runners/machine-sizes',{org:t.owner}),
      client.request('GET /orgs/{org}/actions/runner-groups',{org:t.owner,per_page:100})
    ]);
    return {status:'guided',completed:false,owner:t.owner,name:a.name??null,
      available_sizes:sizes.data?.machine_sizes?.map(x=>x.id)??[],
      groups:groups.data?.runner_groups?.map(x=>({id:x.id,name:x.name}))??[],
      reason:'A hosted runner can consume metered minutes without a provider-enforced maximum dollar amount. The spend guard refuses an invented zero-cost estimate.',
      url:'https://github.com/organizations/'+encodeURIComponent(t.owner)+'/settings/actions/runners',
      steps:['Confirm price, billing budget and a finite usage ceiling with GitHub.','Choose a runner image, size, group, and strict maximum concurrency.','Create it in GitHub after a separate owner approval; use github_hosted_runner_list for fresh readback.']};
  })
});
export const tools=[hostedList.tool,hostedManage.tool,hostedCreatePlan.tool];
export const handlers=Object.fromEntries([
  [hostedList.tool,hostedList.handler],[hostedManage.tool,hostedManage.handler],
  [hostedCreatePlan.tool,hostedCreatePlan.handler]
].map(([tool,handler])=>[tool.name,handler]));
