// H-2: exact webhook deletion and existing-delivery control.
// No secret, request/response body or webhook callback path leaves these handlers.
import {listAll} from '../github/client.js';
import {publicHttpsUrl} from '../github/public-url.js';
import {defineGithubWrite} from './define-github-write.js';
import {octo,ownerOf,missing,refusal,slug} from './github-write.js';
import {productionReason} from './production-guard.js';

const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const ID={type:'integer',minimum:1};
// Delivery IDs can exceed 2^53, so they are accepted as an exact digit string as well as a number and always compared as text.
const DID={type:['integer','string'],minimum:1,maxLength:25,pattern:'^[1-9][0-9]{0,24}$'};
const props={owner:OWNER,repo:REPO,scope:{type:'string',enum:['repo','org']},hookId:ID};
const target=(a,c)=>{
  if(a.scope==='org'&&a.repo)throw new TypeError('Organization webhook cannot target a repository.');
  if(a.scope!=='org'&&!a.repo)throw new TypeError('A repository webhook needs a repository.');
  return {owner:ownerOf(a,c),...(a.scope==='org'?{}:{repo:a.repo}),
    scope:a.scope==='org'?'org':'repo',kind:'repo-settings'};
};
const args=t=>t.scope==='org'?{org:t.owner}:{owner:t.owner,repo:t.repo};
const route=(t,suffix='')=>(t.scope==='org'?'/orgs/{org}/hooks':'/repos/{owner}/{repo}/hooks')+suffix;
const get=async(ctx,t,id)=>missing(async()=>{
  const x=(await (await octo(ctx,t.owner)).request('GET '+route(t,'/{hook_id}'),
    {...args(t),hook_id:id})).data;
  if(x?.id!==id)throw refusal('Webhook numeric identity could not be verified.');
  let target_host=null;
  try{target_host=publicHttpsUrl(x.config?.url).hostname;}catch{}
  // Only this allowlisted projection may enter the change journal.
  return {id:x.id,active:x.active===true,
    events:Array.isArray(x.events)?x.events.slice(0,100):[],
    target_host};
});
const host=webhook=>{
  if(!webhook.target_host)
    throw refusal('Webhook delivery target is not a verified public HTTPS URL.');
  return webhook.target_host;
};
const inspect=async(a,ctx,t)=>{
  const hook=await get(ctx,t,a.hookId);
  if(!hook)throw refusal('Webhook does not exist on this account.');
  if(hook.active!==true)throw refusal('Webhook is inactive; no event should be dispatched.');
  return {hook,target_host:host(hook)};
};
const deliveries=async(ctx,t,hookId)=>{
  const r=await listAll(await octo(ctx,t.owner),'GET '+route(t,'/{hook_id}/deliveries'),
    {...args(t),hook_id:hookId,per_page:100},{max:100});
  if(r.capped||r.items.length===100)throw refusal('Webhook deliveries reached the 100-item safety limit; do not act on a potentially incomplete list.');
  // Read-back is persisted in the request journal: never retain provider payloads,
  // signing headers, raw callback URLs or request/response bodies.
  return r.items.map(d=>({id:d.id,guid:d.guid??null,event:d.event??null,
    redelivery:d.redelivery===true}));
};
// GitHub records a ping or redelivery a moment after it accepts the request, so an immediate read can miss it (seen on the real
// account). Look again a few times, bounded to about five seconds, before reporting "unconfirmed".
const settled=async(ctx,t,hookId,found)=>{
  const wait=ctx.sleep??(ms=>new Promise(r=>setTimeout(r,ms)));
  let items=await deliveries(ctx,t,hookId);
  for(let i=0;i<3&&!found(items);i++){await wait(1500);items=await deliveries(ctx,t,hookId);}
  return items;
};
const summarizeTarget=(t,a)=>t.scope==='org'?t.owner:slug(t.owner,a.repo);

export const webhookDelete=defineGithubWrite({
  name:'github_webhook_delete',area:'webhook',audience:['O'],
  description:'Permanently delete one exact webhook after confirmation, with independent absence readback.',
  properties:props,required:['hookId'],
  declarations:{production:'always',confirm:'always',profiles:['full']},target,
  read:async(a,ctx,t)=>({hook:await get(ctx,t,a.hookId)}),
  classify:()=>({production:'removes an existing GitHub event delivery subscription'}),
  summarize:({args:a,target:t,before:b})=>
    'DELETE webhook #'+a.hookId+' for '+summarizeTarget(t,a)+
      '; events '+(b?.hook?.events??[]).join(', ')+'; delivery will stop',
  apply:({args:a,ctx,target:t,before:b})=>{
    if(!b.hook)throw refusal('No matching existing webhook can be deleted.');
    return octo(ctx,t.owner).then(gh=>gh.request('DELETE '+route(t,'/{hook_id}'),
      {...args(t),hook_id:a.hookId}));
  },
  readAfter:({args:a,ctx,target:t})=>get(ctx,t,a.hookId),
  verify:({after})=>after===null,
  inverse:()=>null,present:({args:a})=>({deleted_hook_id:a.hookId,
    warning:'Past delivered events cannot be undone.'})
});

export const webhookRedeliver=defineGithubWrite({
  name:'github_webhook_redeliver',area:'webhook',audience:['B','Op'],
  description:'Request one exact webhook delivery retry and verify a new GitHub delivery receipt.',
  properties:{...props,deliveryId:DID},required:['hookId','deliveryId'],
  declarations:{production:'when-target',confirm:'always',profiles:['everyday','full']},target,
  read:async(a,ctx,t)=>{
    const snapshot=await inspect(a,ctx,t);
    const d=(await (await octo(ctx,t.owner)).request(
      'GET '+route(t,'/{hook_id}/deliveries/{delivery_id}'),
      {...args(t),hook_id:a.hookId,delivery_id:String(a.deliveryId)})).data;
    if(String(d?.id)!==String(a.deliveryId)||!d.guid)throw refusal('Original delivery ID and GUID cannot be verified.');
    const inventory=await deliveries(ctx,t,a.hookId);
    return {...snapshot,delivery:{id:d.id,guid:d.guid,event:d.event??null},known:inventory.map(v=>v.id)};
  },
  classify:({ctx,target:t})=>productionReason(ctx,t).then(production=>({production})),
  summarize:({args:a,target:t,before:b})=>
    'Redeliver '+b.delivery.event+' from webhook #'+a.hookId+' for '+
    summarizeTarget(t,a)+' to '+b.target_host+'; original delivery #'+a.deliveryId,
  apply:({args:a,ctx,target:t})=>octo(ctx,t.owner).then(gh=>gh.request(
    'POST '+route(t,'/{hook_id}/deliveries/{delivery_id}/attempts'),
    {...args(t),hook_id:a.hookId,delivery_id:String(a.deliveryId)})),
  readAfter:({args:a,ctx,target:t,before:b})=>settled(ctx,t,a.hookId,items=>items.some(d=>d.guid===b.delivery.guid&&
    String(d.id)!==String(b.delivery.id)&&!b.known.includes(d.id)&&d.redelivery===true)),
  verify:({before:b,after:items})=>items?.some(d=>d.guid===b.delivery.guid&&
    String(d.id)!==String(b.delivery.id)&&!b.known.includes(d.id)&&d.redelivery===true),
  inverse:()=>null,
  present:({args:a,after:items,before:b})=>({webhook_id:a.hookId,
    original_delivery_id:String(a.deliveryId),
    verified_new_delivery_id:items?.find(d=>d.guid===b.delivery.guid&&
      String(d.id)!==String(a.deliveryId)&&!b.known.includes(d.id)&&d.redelivery===true)?.id??null})
});

export const webhookPing=defineGithubWrite({
  name:'github_webhook_ping',area:'webhook',audience:['B'],
  description:'Send a confirmed ping to one existing HTTPS webhook and verify GitHub recorded a new delivery.',
  properties:props,required:['hookId'],
  declarations:{production:'when-target',confirm:'always',profiles:['everyday','full']},target,
  read:async(a,ctx,t)=>{
    const snap=await inspect(a,ctx,t),existing=await deliveries(ctx,t,a.hookId);
    return {...snap,known:existing.map(v=>v.id)};
  },
  classify:({ctx,target:t})=>productionReason(ctx,t).then(production=>({production})),
  summarize:({args:a,target:t,before:b})=>
    'Ping webhook #'+a.hookId+' in '+summarizeTarget(t,a)+' at '+b.target_host+
    '; delivery receipt is required to confirm success',
  apply:({args:a,ctx,target:t})=>octo(ctx,t.owner).then(gh=>gh.request(
    'POST '+route(t,'/{hook_id}/pings'),{...args(t),hook_id:a.hookId})),
  readAfter:({args:a,ctx,target:t,before:b})=>settled(ctx,t,a.hookId,items=>items.some(d=>d.event==='ping'&&!b.known.includes(d.id))),
  verify:({before:b,after:items})=>items?.some(d=>d.event==='ping'&&!b.known.includes(d.id)),
  inverse:()=>null,present:({args:a,after:items,before:b})=>({
    webhook_id:a.hookId,ping_delivery_id:items?.find(d=>d.event==='ping'&&!b.known.includes(d.id))?.id??null})
});
export const tools=[webhookDelete.tool,webhookRedeliver.tool,webhookPing.tool];
export const handlers=Object.fromEntries([
  [webhookDelete.tool,webhookDelete.handler],
  [webhookRedeliver.tool,webhookRedeliver.handler],
  [webhookPing.tool,webhookPing.handler]
].map(([t,h])=>[t.name,h]));
