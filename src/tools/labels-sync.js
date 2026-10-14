// F-2: synchronize a source label catalog to connected repository targets.
// No direct provider mutations: each planned action goes through the normal
// protected, per-account, journalled github_label_save/delete write tool.
import crypto from 'node:crypto';
import { listAll } from '../github/client.js';
import { defineGithubWrite } from './define-github-write.js';
import { octo, ownerOf, refusal, slug } from './github-write.js';
import { protectedResourceGate } from './protect-guard.js';
import { labelSave, labelDelete } from './labels.js';

const OWNER={type:'string',minLength:1,maxLength:39};
const REPO={type:'string',minLength:1,maxLength:100};
const DEST={type:'object',properties:{owner:OWNER,repo:REPO},required:['owner','repo'],additionalProperties:false};
const SAME=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const key=t=>slug(t.owner,t.repo).toLowerCase();
const normalized=l=>({name:l.name,color:l.color.toLowerCase(),description:l.description??''});
const ordered=labels=>[...labels].map(normalized).sort((a,b)=>a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
const snapshot=labels=>JSON.stringify(ordered(labels));
const signature=values=>crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
function mapLabels(labels){
  const map=new Map();
  for(const row of labels){
    if(typeof row?.name!=='string'||!row.name||typeof row.color!=='string'||!/^[0-9a-f]{6}$/i.test(row.color))
      throw refusal('GitHub returned a malformed label. Synchronization refused.');
    const lower=row.name.toLowerCase();
    if(map.has(lower))throw refusal('The repository contains ambiguous duplicate label names.');
    map.set(lower,normalized(row));
  }
  return map;
}
async function inventory(ctx,t){
  const {items,capped}=await listAll(await octo(ctx,t.owner),'GET /repos/{owner}/{repo}/labels',
    {owner:t.owner,repo:t.repo,per_page:100},{max:101});
  if(capped||items.length>100)throw refusal('Label inventory is incomplete or exceeds 100 items; no synchronization was attempted.');
  mapLabels(items);
  return items;
}
function difference(source,current,deleteOthers){
  const desired=mapLabels(source),found=mapLabels(current),ops=[];
  for(const row of desired.values()){
    const existing=found.get(row.name.toLowerCase());
    if(!existing)ops.push({type:'create',name:row.name,color:row.color,description:row.description});
    else if(existing.name!==row.name||existing.color!==row.color||existing.description!==row.description)
      ops.push({type:'update',name:existing.name,newName:row.name,color:row.color,description:row.description});
  }
  if(deleteOthers)for(const row of found.values()){
    if(!desired.has(row.name.toLowerCase()))ops.push({type:'delete',name:row.name});
  }
  return ops.sort((a,b)=>(a.type==='delete'?1:0)-(b.type==='delete'?1:0)
    ||a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}
const accounts=(ctx,t)=>ctx.connection.accounts.some(x=>SAME(x,t.owner));
const target=(args,ctx)=>{
  if(!Array.isArray(args.targets)||!args.targets.length)throw new TypeError('Provide at least one destination repository.');
  const src={owner:args.sourceOwner??ownerOf(args,ctx),repo:args.sourceRepo};
  const keys=new Set();
  for(const t of args.targets){
    if(!t?.owner||!t?.repo)throw new TypeError('Every destination requires an owner and repository.');
    if(key(t)===key(src))throw new TypeError('A destination cannot be the source repository.');
    if(keys.has(key(t)))throw new TypeError('Duplicate destination repositories are not allowed.');
    keys.add(key(t));
  }
  return {...args.targets[0],scope:'repo'};
};
const checkDestination=async(ctx,args,t)=>{
  if(!accounts(ctx,t))throw refusal(`Destination ${key(t)} is not an account connected to this client.`);
  // The parent pipeline protects its primary target; independently run the
  // same protections for every additional target before any mutation.
  const gates=[protectedResourceGate(),...(ctx.gates??[])];
  for(const gate of gates){
    const decision=await gate({name:'github_label_sync',args,ctx,target:{...t,scope:'repo'},
      classification:{production:null,notifies:[],accessWidening:null,spendCents:0},
      declarations:{production:'never',notifies:false,spend:false,accessWidening:false}});
    if(decision?.refuse)throw refusal(`Destination ${key(t)} refused by ${decision.by??'guard'}: ${decision.refuse}`);
  }
};

function targetMatches(desired,actualLabels,deleteOthers){
  try{
    const wanted=mapLabels(desired),actual=mapLabels(actualLabels);
    for(const row of wanted.values()){
      const found=actual.get(row.name.toLowerCase());
      if(!found||found.name!==row.name||found.color!==row.color||found.description!==row.description)return false;
    }
    return !deleteOthers||actual.size===wanted.size;
  }catch{return false;}
}
function allTargetsMatch(plan,after,deleteOthers){
  if(!Array.isArray(after)||after.length!==plan.repositories.length)return false;
  return after.every((report,i)=>!report.error&&key(report)===key(plan.repositories[i])
    &&targetMatches(plan.desired,report.labels,deleteOthers));
}

export const labelSync=defineGithubWrite({
  name:'github_label_sync',area:'label',audience:['O','Op'],
  description:'Synchronize labels from one connected repository to others, with an exact preview and per-target readback.',
  properties:{sourceOwner:OWNER,sourceRepo:REPO,
    targets:{type:'array',minItems:1,maxItems:5,items:DEST},
    deleteOthers:{type:'boolean',description:'Only true may remove labels absent from source; always needs confirmation.'}},
  required:['sourceRepo','targets'],declarations:{production:'never',confirm:'always',profiles:['full']},target,
  read:async(args,ctx)=>{
    const src={owner:args.sourceOwner??ctx.connection.default_account,repo:args.sourceRepo};
    if(!accounts(ctx,src))throw refusal('The source account is not connected.');
    const desired=await inventory(ctx,src);
    const repositories=[];
    for(const t of args.targets){
      await checkDestination(ctx,args,t);
      const current=await inventory(ctx,t);
      repositories.push({owner:t.owner,repo:t.repo,original:snapshot(current),
        operations:difference(desired,current,args.deleteOthers===true)});
    }
    const total=repositories.reduce((n,t)=>n+t.operations.length,0);
    if(total>20)throw refusal('The plan exceeds 20 per-label mutations; use smaller destination batches.');
    return {source:src,sourceSnapshot:snapshot(desired),desired:ordered(desired),repositories,total};
  },
  classify:()=>({}),
  summarize:({args,before:b})=>{
    const details=b.repositories.map(t=>`${key(t)}: ${t.operations.length?
      t.operations.map(op=>`${op.type==='delete'?'DELETE':op.type} ${op.name}${op.newName&&op.newName!==op.name?` -> ${op.newName}`:''}`).join(', '):'no changes'}`);
    return `Sync ${b.desired.length} labels from ${key(b.source)} to ${b.repositories.length} repositories; ${args.deleteOthers?'EXPLICIT deletion of unmatched labels allowed':'no label deletion'}; ${details.join('; ')}.`;
  },
  apply:async({args,ctx,before:b,requestKey})=>{
    const outcomes=[];
    // Fail closed if the source set changed after the preview and before write.
    if(snapshot(await inventory(ctx,b.source))!==b.sourceSnapshot)
      throw refusal('Source labels changed after the plan; regenerate the preview.');
    for(const t of b.repositories){
      await checkDestination(ctx,args,t);
      if(snapshot(await inventory(ctx,t))!==t.original)
        return {data:{outcomes,failed:true,reason:`Destination ${key(t)} changed since planning`}};
      const item={owner:t.owner,repo:t.repo,operations:[],complete:true};
      outcomes.push(item);
      for(const op of t.operations){
        const id=signature([requestKey,key(t),op]);
        const selected=op.type==='delete'?labelDelete:labelSave;
        const callArgs={owner:t.owner,repo:t.repo,name:op.name,confirm:true,
          requestKey:`sync-${id}`,...(op.type==='delete'?{}:{
            color:op.color,description:op.description,
            ...(op.type==='update'&&op.newName!==op.name?{newName:op.newName}:{})})};
        const reply=await selected.handler(callArgs,ctx);
        const value=reply.structuredContent;
        const ok=value?.confirmed===true&&['applied','replayed'].includes(value.status);
        item.operations.push({type:op.type,name:op.name,status:value?.status??'unknown',confirmed:ok});
        if(!ok){
          item.complete=false;
          return {data:{outcomes,failed:true,reason:`Operation ${op.type} ${op.name} in ${key(t)} was not confirmed`}};
        }
      }
    }
    return {data:{outcomes,failed:false}};
  },
  readAfter:async({ctx,before:b})=>{
    const reports=[];
    for(const t of b.repositories){
      try{
        reports.push({owner:t.owner,repo:t.repo,labels:await inventory(ctx,t)});
      }catch{
        reports.push({owner:t.owner,repo:t.repo,error:'GitHub readback was unavailable'});
      }
    }
    return reports;
  },
  verify:({args,before:b,after,response:r})=>
    !r?.data?.failed&&allTargetsMatch(b,after,args.deleteOthers===true),
  inverse:()=>null,
  present:({args,before:b,after,response:r})=>{
    const finalMatch=allTargetsMatch(b,after,args.deleteOthers===true);
    return {
      source:key(b.source),destination_count:b.repositories.length,planned_mutations:b.total,
      delete_others:args.deleteOthers===true,
      outcomes:r?.data?.outcomes??[],failed:!!r?.data?.failed||!finalMatch,
      ...(r?.data?.reason?{reason:r.data.reason}:!finalMatch?{
        reason:'One or more destination label inventories did not independently match the requested final state'
      }:{}),
      independent_readback:Array.isArray(after)?after.map(t=>({
        repository:key(t),readable:!t.error,label_count:t.labels?.length??null,
        matches_source:!!t.labels&&targetMatches(b.desired,t.labels,args.deleteOthers===true)
      })):[]
    };
  }
});
export const tools=[labelSync.tool];
export const handlers={[labelSync.tool.name]:labelSync.handler};
