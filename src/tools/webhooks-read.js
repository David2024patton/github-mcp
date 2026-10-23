// H-2: webhook administration reads, deliberately omitting credential material and
// bounding payloads before result shaping. All GitHub calls use the pinned client.
import {listAll} from '../github/client.js';
import {defineRead} from './define-read.js';
import {plain,readerFor} from './github-read.js';

const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const ID={type:'integer',minimum:1},DID={type:['integer','string'],minimum:1,maxLength:25,pattern:'^[1-9][0-9]{0,24}$'},MAX={type:'integer',minimum:1,maximum:100};
const common={owner:OWNER,repo:REPO,scope:{type:'string',enum:['repo','org']}};
const target=a=>{
  if(a.scope==='org'&&a.repo)throw new TypeError('Organization webhooks have no repository.');
  if(a.scope!=='org'&&!a.repo)throw new TypeError('Repository webhook requires repo.');
};
const loc=a=>a.scope==='org'?{org:a.owner}:{owner:a.owner,repo:a.repo};
const endpoint=(a,suffix='')=>
  'GET '+(a.scope==='org'?'/orgs/{org}/hooks':'/repos/{owner}/{repo}/hooks')+suffix;
const safeHost=url=>{
  try{const x=new URL(url);return x.protocol==='https:'?x.hostname:null;}catch{return null;}
};
const hook=x=>({
  id:x.id,name:x.name,active:x.active,events:Array.isArray(x.events)?x.events.slice(0,100):[],
  type:x.type??null,updated_at:x.updated_at??null,
  config:x.config?{url_host:safeHost(x.config.url),content_type:x.config.content_type??null,
    insecure_ssl:x.config.insecure_ssl===undefined?null:String(x.config.insecure_ssl)==='1'}:null,
  deliveries_url:x.deliveries_url??null
});
const delivery=x=>({
  id:x.id,guid:x.guid??null,delivered_at:x.delivered_at??null,event:x.event??null,
  action:x.action??null,status:x.status??null,status_code:x.status_code??null,
  duration:x.duration??null,redelivery:x.redelivery??null,
  request:{headers_present:!!x.request?.headers,payload_present:x.request?.payload!==undefined},
  response:{status:x.response?.status??null,payload_present:x.response?.payload!==undefined}
});
const getHook=async(gh,p,a,id)=>{
  const x=(await gh.request(endpoint(p,'/{hook_id}'),{...loc(p),hook_id:id})).data;
  if(!x||x.id!==id)throw new TypeError('Webhook identity did not match the request.');
  return hook(x);
};
export const webhookList=defineRead({
  name:'github_webhook_list',area:'webhook',audience:['B','O'],
  description:'List repository or organization webhook destinations, event subscriptions and status without signing secrets.',
  properties:{...common,max:MAX},
  handler:(a,ctx)=>plain(async()=>{
    const {owner,octokit:gh}=await readerFor(a,ctx),p={...a,owner};target(p);
    const r=await listAll(gh,endpoint(p),{...loc(p),per_page:100},{max:a.max??100});
    return {owner,scope:p.scope??'repo',...(a.repo?{repo:a.repo}:{}),
      count:r.items.length,complete:!r.capped,items:r.items.map(hook),
      ...(r.capped?{warning:'Webhook inventory truncated; increase maximum for a complete list.'}:{})};
  })
});
export const webhookGet=defineRead({
  name:'github_webhook_get',area:'webhook',audience:['B','O'],
  description:'Inspect one webhook destination, subscribed events and active state without returning signing material.',
  properties:{...common,hookId:ID},required:['hookId'],
  handler:(a,ctx)=>plain(async()=>{
    const {owner,octokit:gh}=await readerFor(a,ctx),p={...a,owner};target(p);
    return {owner,scope:p.scope??'repo',...(a.repo?{repo:a.repo}:{}),
      ...(await getHook(gh,p,a,a.hookId))};
  })
});
export const webhookListDeliveries=defineRead({
  name:'github_webhook_list_deliveries',area:'webhook',audience:['B','Op'],
  description:'Inspect bounded webhook delivery outcomes and one exact delivery without leaking request or response credentials.',
  properties:{...common,hookId:ID,deliveryId:DID,max:MAX},required:['hookId'],
  handler:(a,ctx)=>plain(async()=>{
    const {owner,octokit:gh}=await readerFor(a,ctx),p={...a,owner};target(p);
    await getHook(gh,p,a,a.hookId);
    const base={...loc(p),hook_id:a.hookId};
    if(a.deliveryId){
      const d=(await gh.request(endpoint(p,'/{hook_id}/deliveries/{delivery_id}'),
        {...base,delivery_id:String(a.deliveryId)})).data;
      if(!d||String(d.id)!==String(a.deliveryId))throw new TypeError('Webhook delivery identity mismatch.');
      return {owner,hook_id:a.hookId,item:delivery(d),
        note:'Request/response bodies and headers are intentionally omitted to prevent credential disclosure.'};
    }
    const result=await listAll(gh,endpoint(p,'/{hook_id}/deliveries'),
      {...base,per_page:100},{max:a.max??100});
    return {owner,hook_id:a.hookId,count:result.items.length,
      complete:!result.capped,items:result.items.map(delivery),
      ...(result.capped?{warning:'Delivery inventory capped; additional deliveries may exist.'}:{})};
  })
});
export const tools=[webhookList.tool,webhookGet.tool,webhookListDeliveries.tool];
export const handlers=Object.fromEntries([
  [webhookList.tool,webhookList.handler],[webhookGet.tool,webhookGet.handler],
  [webhookListDeliveries.tool,webhookListDeliveries.handler]
].map(([t,h])=>[t.name,h]));

