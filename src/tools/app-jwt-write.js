// CAP-4 App webhook configuration mutation: exact enrolled App OWNER only,
// short-lived App JWT generated from the existing encrypted key, no secret
// arguments, full guarded write journal and independent provider readback.
// Raw URL paths and provider webhook signing secrets NEVER enter change logs.
import {createHash} from 'node:crypto';
import {defineGithubWrite} from './define-github-write.js';
import {ownerOf,refusal} from './github-write.js';
import {appFor} from './app-jwt-read.js';

const OWNER={type:'string',minLength:1,maxLength:39};
const URL_VALUE={type:'string',minLength:12,maxLength:600,
  pattern:'^https://'};
const CONTENT={type:'string',enum:['json','form']};
const R={
  read:'GET /app/hook/config',
  update:'PATCH /app/hook/config'
};
function safeUrl(value){
  if(typeof value!=='string'||value.length>600)
    throw refusal('A bounded webhook HTTPS URL is required.');
  let u;
  try{u=new URL(value);}catch{throw refusal('Invalid webhook URL.');}
  if(u.protocol!=='https:'||!u.hostname||u.username||u.password||
    u.search||u.hash||!['443',''].includes(u.port)||
    /[\x00-\x1F]/.test(value))
    throw refusal('Webhook URL must be HTTPS without query, credentials or fragment.');
  return {host:u.hostname,hash:createHash('sha256').update(u.href).digest('hex'),
    normalized:u.href};
}
function providerState(d){
  if(!d||typeof d!=='object'||Array.isArray(d))
    throw refusal('GitHub returned an invalid App webhook configuration.');
  // A stored config URL may contain secrets from a prior owner action.
  // Never copy raw URLs, paths, query strings or masked signing secret.
  if(typeof d.url!=='string'||d.url.length>2048)
    throw refusal('GitHub returned a missing App webhook destination.');
  const u=new URL(d.url);
  if(u.protocol!=='https:'||!u.hostname)
    throw refusal('The existing App webhook is not HTTPS; correct it outside this partial update.');
  if(!['json','form'].includes(d.content_type) ||
    !['0',0,false].includes(d.insecure_ssl))
    throw refusal('Existing App webhook TLS/content type cannot be confirmed.');
  return {url_host:u.hostname,
    url_hash:createHash('sha256').update(u.href).digest('hex'),
    content_type:d.content_type,tls_verified:true};
}
const target=(a,ctx)=>({owner:ownerOf(a,ctx),scope:'org',
  kind:'app-webhook-config'});
async function config(a,ctx,t){
  const owner=await appFor({owner:t.owner},ctx);
  return {owner,view:providerState((await owner.gh.request(R.read)).data)};
}
export const appWebhookSet=defineGithubWrite({
  name:'github_app_webhook_configuration_set',area:'app',audience:['O'],
  description:'PRODUCTION: Update owned App webhook HTTPS destination or format by JWT, with confirmation and secret-safe readback.',
  properties:{owner:OWNER,url:URL_VALUE,contentType:CONTENT},
  required:[],
  declarations:{production:'always',confirm:'always',accessWidening:true,
    notifies:true,cred:'JWT',profiles:['full']},target,
  read:async(a,ctx,t)=>{
    if(a.url===undefined&&a.contentType===undefined)
      throw refusal('Provide a webhook URL or content type to update.');
    // Validate the submitted URL before provider reads.
    if(a.url!==undefined)safeUrl(a.url);
    return (await config(a,ctx,t)).view;
  },
  classify:({args:a,before:b})=>({
    accessWidening:a.url!==undefined&&safeUrl(a.url).hash!==b?.url_hash,
    notifies:a.url!==undefined?[safeUrl(a.url).host]:[]
  }),
  summarize:({args:a,target:t,before:b})=>
    'Change GitHub App webhook for '+t.owner+' from destination host '+
    b.url_host+' to '+(a.url===undefined?b.url_host:safeUrl(a.url).host)+
    (a.contentType?' and content type '+a.contentType:'')+
    '. This alters external event delivery; TLS verification remains required.',
  apply:async({args:a,ctx,target:t,before:b})=>{
    const requested=a.url===undefined?null:safeUrl(a.url);
    if((!requested||requested.hash===b.url_hash)&&
      (a.contentType===undefined||a.contentType===b.content_type))
      throw refusal('Webhook configuration is already set; no write sent.');
    const {gh}=await appFor({owner:t.owner},ctx);
    // Octokit reserves a top-level "url" option as the HTTP destination.
    // Use "data" to serialize the webhook destination into the JSON BODY,
    // keeping the bearer App JWT exclusively on api.github.com.
    return gh.request(R.update,{data:{
      ...(requested?{url:requested.normalized}:{}),
      ...(a.contentType?{content_type:a.contentType}:{})
    }});
  },
  readAfter:async({args:a,ctx,target:t})=>(await config(a,ctx,t)).view,
  verify:({args:a,before:b,after:d})=>
    d?.tls_verified===true&&
    d?.url_hash===(a.url===undefined?b.url_hash:safeUrl(a.url).hash)&&
    d?.content_type===(a.contentType??b.content_type),
  inverse:()=>null,
  present:({target:t,after:d})=>({org:t.owner,
    url_host:d.url_host,content_type:d.content_type,
    tls_verified:d.tls_verified,
    note:'GitHub accepted and returned the expected HTTPS destination and format. Review webhook delivery health separately.'})
});

const DELIVERY_ID={type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER};
const REDO={
  one:'GET /app/hook/deliveries/{delivery_id}',
  list:'GET /app/hook/deliveries',
  attempt:'POST /app/hook/deliveries/{delivery_id}/attempts'
};
const safeDeliveryText=(v,name)=>{
  if(typeof v!=='string'||!v||v.length>100||/[\x00-\x1F]/.test(v))
    throw refusal('GitHub returned an invalid webhook '+name+'.');
  return v;
};
function deliverySummary(d,id,installationId){
  if(!d||typeof d!=='object'||Array.isArray(d)||
    d.id!==id||d.installation_id!==installationId)
    throw refusal('Webhook delivery does not belong to the enrolled App installation.');
  return {id,installation_id:installationId,
    guid:safeDeliveryText(d.guid,'GUID'),
    event:safeDeliveryText(d.event,'event'),
    status:safeDeliveryText(d.status,'status'),
    delivered_at:safeDeliveryText(d.delivered_at,'time')};
}
async function retryIndex(gh,guid,installationId) {
  // GitHub's JWT-only App hook feed is GLOBAL across installations. Always
  // cap this one page and project only exact same-installation retry IDs.
  const r=await gh.request(REDO.list,{per_page:100});
  if(!Array.isArray(r.data)||r.data.length>100)
    throw refusal('GitHub returned an unbounded App delivery page.');
  const matching=r.data.filter(x=>x?.guid===guid &&
    x.installation_id===installationId&&x.redelivery===true);
  for(const x of matching) {
    if(!Number.isSafeInteger(x.id)||x.id<1||
      typeof x.delivered_at!=='string'||!Number.isFinite(Date.parse(x.delivered_at)))
      throw refusal('GitHub returned a malformed App retry receipt.');
  }
  return matching.map(x=>({id:x.id,delivered_at:x.delivered_at}));
}
export const appWebhookRedeliver=defineGithubWrite({
  name:'github_app_webhook_redeliver',area:'app',audience:['O'],
  description:'PRODUCTION: Redeliver one owned App webhook event by JWT and confirm only a distinct provider retry receipt.',
  properties:{owner:OWNER,deliveryId:DELIVERY_ID},required:['deliveryId'],
  declarations:{production:'always',confirm:'always',notifies:true,
    cred:'JWT',profiles:['full']},
  target:(a,ctx)=>({owner:ownerOf(a,ctx),scope:'org',kind:'app-webhook-retry',
    deliveryId:a.deliveryId}),
  read:async(a,ctx,t)=>{
    const {gh,installationId}=await appFor({owner:t.owner},ctx);
    if(!Number.isSafeInteger(installationId)||installationId<1)
      throw refusal('An active enrolled App installation is required to redeliver.');
    const raw=(await gh.request(REDO.one,{delivery_id:a.deliveryId})).data;
    const selected=deliverySummary(raw,a.deliveryId,installationId);
    const destination=providerState((await gh.request(R.read)).data).url_host;
    const seen=await retryIndex(gh,selected.guid,installationId);
    const stamp=(ctx.now??Date.now)();
    if(!Number.isFinite(stamp))throw refusal('A reliable webhook retry clock is required.');
    return {...selected,destination,seenIds:seen.map(x=>x.id),
      checkpoint:stamp};
  },
  classify:({before:b})=>({notifies:[b.destination]}),
  summarize:({args:a,target:t,before:b})=>
    'REDRIVE App webhook delivery #'+a.deliveryId+' ('+b.event+
    ') for enrolled installation '+b.installation_id+' on '+t.owner+
    ', notifying HTTPS host '+b.destination+
    '. GitHub can queue without completing it; confirmation requires an independent new retry receipt.',
  apply:async({args:a,ctx,target:t})=>{
    const {gh}=await appFor({owner:t.owner},ctx);
    const response=await gh.request(REDO.attempt,{delivery_id:a.deliveryId});
    if(response.status!==202)throw refusal('GitHub did not confirm a queued App redelivery.');
    return response;
  },
  readAfter:async({args:a,ctx,target:t,before:b})=>{
    const {gh,installationId}=await appFor({owner:t.owner},ctx);
    if(installationId!==b.installation_id)
      throw refusal('App installation changed during retry.');
    const receipts=await retryIndex(gh,b.guid,installationId);
    // Only a new, separately identified provider attempt after our
    // preflight can establish success; 202 alone is not a delivery proof.
    const newReceipt=receipts.find(x=>!b.seenIds.includes(x.id)&&
      Date.parse(x.delivered_at)>=b.checkpoint);
    return {delivery_id:a.deliveryId,installation_id:installationId,
      retryReceiptId:newReceipt?.id??null,
      independentlyObserved:!!newReceipt};
  },
  verify:({after:a})=>a?.independentlyObserved===true &&
    Number.isSafeInteger(a.retryReceiptId),
  inverse:()=>null,
  present:({args:a,target:t,before:b,after:d})=>({
    org:t.owner,delivery_id:a.deliveryId,
    recipient_host:b.destination,confirmed_receipt_id:d?.retryReceiptId??null,
    independently_observed:d?.independentlyObserved===true,
    note:d?.independentlyObserved?
      'GitHub shows a distinct retry delivery. Check that delivery status separately.':
      'GitHub accepted redelivery (202) but no distinct matching retry is visible yet. Never replay blindly; check delivery history.'})
});

export const tools=[appWebhookSet.tool,appWebhookRedeliver.tool];
export const handlers={
  [appWebhookSet.tool.name]:appWebhookSet.handler,
  [appWebhookRedeliver.tool.name]:appWebhookRedeliver.handler
};
