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
export const tools=[appWebhookSet.tool];
export const handlers={[appWebhookSet.tool.name]:appWebhookSet.handler};
