// CAP-4: GitHub App JWT-only visibility for the exact enrolled App OWNER.
// App JWT is not an installation token. Never accept an app id or JWT from
// tool args; never expose raw configuration, delivery payloads or JWTs.
import {bareOctokit} from '../github/client.js';
import {defineRead} from './define-read.js';
import {plain} from './github-read.js';

const OWNER={type:'string',minLength:1,maxLength:39};
const MAX={type:'integer',minimum:1,maximum:100};
const CURSOR={type:'string',minLength:1,maxLength:300,
  pattern:'^[A-Za-z0-9_.~-]+$'};
const DELIVERY_ID={type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER};
const HOST='https://api.github.com';
const R={
  app:'GET /app',
  config:'GET /app/hook/config',
  deliveries:'GET /app/hook/deliveries',
  one:'GET /app/hook/deliveries/{delivery_id}'
};
const bounded=(v,label,max=150)=>{
  if(v===null||v===undefined)return null;
  if(typeof v!=='string'||v.length>max||/[\x00-\x1F]/.test(v))
    throw new TypeError('GitHub returned unsafe App '+label+'.');
  return v;
};
function urlHost(value) {
  if(value===null||value===undefined)return null;
  let u;
  try{u=new URL(value);}catch{
    throw new TypeError('GitHub returned an invalid App webhook URL.');
  }
  if(u.protocol!=='https:'||!u.hostname||u.username||u.password)
    throw new TypeError('GitHub returned an unsafe App webhook URL.');
  return u.hostname;
}
function validatedCursor(link){
  if(link===undefined||link===null||link==='')return null;
  if(typeof link!=='string'||link.length>4096)
    throw new TypeError('GitHub returned an invalid App pagination link.');
  const next=link.split(',').map(s=>s.trim()).filter(x=>/;\s*rel="next"(?:\s*;|$)/.test(x));
  if(!next.length)return null;
  if(next.length!==1)throw new TypeError('Ambiguous App pagination.');
  const match=/^<([^<>]+)>;\s*rel="next"(?:\s*;.*)?$/.exec(next[0]);
  if(!match)throw new TypeError('Invalid App pagination URL.');
  let url;
  try{url=new URL(match[1]);}catch{
    throw new TypeError('Invalid App pagination URL.');
  }
  if(url.origin!==HOST||url.pathname!=='/app/hook/deliveries'||
    url.username||url.password||url.hash||
    url.searchParams.getAll('cursor').length!==1)
    throw new TypeError('App pagination leaves authorized API path.');
  const cursor=url.searchParams.get('cursor');
  if(!cursor||cursor.length>300||!new RegExp(CURSOR.pattern).test(cursor))
    throw new TypeError('Invalid App delivery cursor.');
  return cursor;
}
function delivery(d,installationId){
  if(!d||typeof d!=='object'||Array.isArray(d)||
    !Number.isSafeInteger(d.id)||d.id<1||
    d.installation_id!==installationId)
    throw new TypeError('GitHub returned a mismatched App delivery.');
  return {id:d.id,guid:bounded(d.guid,'delivery guid',90),
    event:bounded(d.event,'event',90),action:bounded(d.action,'action',90),
    delivered_at:bounded(d.delivered_at,'delivery time',80),
    status:bounded(d.status,'delivery status',50),
    status_code:Number.isInteger(d.status_code)&&d.status_code>=100&&d.status_code<=599
      ?d.status_code:null,redelivery:d.redelivery===true};
}
// One exact stored App owner only. An installation grantee cannot use its
// installation's app JWT to view GLOBAL app settings or other tenants.
// A current provider GET /app proves owner id and login before any other call.
async function appFor(a,ctx){
  if(ctx.connection?.pass===true)
    throw new TypeError('App-owner JWT operations cannot be delegated to service passes.');
  const requested=a.owner??ctx.connection?.default_account;
  const owner=ctx.connection?.accounts?.find(x=>
    typeof requested==='string'&&x.toLowerCase()===requested.toLowerCase());
  if(!owner)throw new TypeError('GitHub App owner is not in this connection.');
  const account=await ctx.db.getAccount(owner);
  if(!account||!Number.isSafeInteger(account.app_id)||account.app_id<1||
    !Number.isSafeInteger(Number(account.account_id))||Number(account.account_id)<1)
    throw new TypeError('An enrolled GitHub App owner is required.');
  const app=await ctx.db.getApp(account.app_id);
  if(!app||app.id!==account.app_id||
    app.owner_login?.toLowerCase()!==owner.toLowerCase()||
    app.owner_type!==account.account_type)
    throw new TypeError('The GitHub App is not bound to the selected owner.');
  if(typeof ctx.credentials?.appJwt!=='function')
    throw new TypeError('GitHub App JWT credentials are unavailable.');
  const jwt=await ctx.credentials.appJwt(app.id);
  if(typeof jwt!=='string'||!jwt)throw new TypeError('No GitHub App JWT was issued.');
  const gh=bareOctokit({token:jwt,fetch:ctx.fetch});
  const data=(await gh.request(R.app)).data;
  if(data?.id!==app.id||
    data.owner?.login?.toLowerCase()!==owner.toLowerCase()||
    Number(data.owner?.id)!==Number(account.account_id))
    throw new TypeError('Provider App identity differs from the enrolled owner.');
  return {gh,owner,appId:app.id,
    installationId:account.installation_status==='active'?account.installation_id:null,
    identity:{id:data.id,slug:bounded(data.slug,'slug'),
      owner,owner_id:Number(account.account_id),
      name:bounded(data.name,'name')}};
}
export const appIdentity=defineRead({
  name:'github_app_owner_identity',area:'app',audience:['O'],
  description:'Verify the selected enrolled GitHub App identity with App JWT, without exporting its private key or tokens.',
  properties:{owner:OWNER},
  handler:(a,ctx)=>plain(async()=>({app:(await appFor(a,ctx)).identity}))
});
export const webhookConfiguration=defineRead({
  name:'github_app_webhook_configuration',area:'app',audience:['O'],
  description:'Read the enrolled owner App webhook host, content type and TLS flag via JWT; never return the signing secret.',
  properties:{owner:OWNER},
  handler:(a,ctx)=>plain(async()=>{
    const {gh,owner,appId}=await appFor(a,ctx);
    const d=(await gh.request(R.config)).data;
    if(!d||typeof d!=='object'||Array.isArray(d))
      throw new TypeError('GitHub returned an invalid App webhook configuration.');
    return {org:owner,app_id:appId,config:{
      url_host:urlHost(d.url),content_type:bounded(d.content_type,'content type',30),
      tls_verified:d.insecure_ssl==='0'||d.insecure_ssl===0||
        d.insecure_ssl===false}};
  })
});
export const webhookDeliveries=defineRead({
  name:'github_app_webhook_deliveries',area:'app',audience:['O'],
  description:'Read a bounded App webhook delivery page, showing only this enrolled installation and omitting payloads.',
  properties:{owner:OWNER,max:MAX,cursor:CURSOR,
    status:{type:'string',enum:['success','failure']},
    deliveryId:DELIVERY_ID},
  handler:(a,ctx)=>plain(async()=>{
    const {gh,owner,appId,installationId}=await appFor(a,ctx);
    if(!Number.isSafeInteger(installationId)||installationId<1)
      throw new TypeError('An active enrolled App installation is required.');
    if(a.deliveryId!==undefined){
      const d=(await gh.request(R.one,{delivery_id:a.deliveryId})).data;
      return {org:owner,app_id:appId,
        item:delivery(d,installationId)};
    }
    const max=a.max??30;
    const r=await gh.request(R.deliveries,{per_page:max,
      ...(a.cursor?{cursor:a.cursor}:{}),
      ...(a.status?{status:a.status}:{})});
    if(!Array.isArray(r.data)||r.data.length>max)
      throw new TypeError('GitHub returned an invalid App delivery page.');
    const items=r.data.filter(d=>d?.installation_id===installationId)
      .map(d=>delivery(d,installationId));
    const next=validatedCursor(r.headers?.link);
    return {org:owner,app_id:appId,items,shown:items.length,
      pageExamined:r.data.length,complete:!next&&r.data.length<max,
      nextCursor:next,
      note:'The App webhook is global. Only deliveries for this enrolled installation are shown; absence from this page does not prove no other deliveries exist.'};
  })
});
export const tools=[appIdentity.tool,webhookConfiguration.tool,webhookDeliveries.tool];
export const handlers=Object.fromEntries([
  [appIdentity.tool,appIdentity.handler],
  [webhookConfiguration.tool,webhookConfiguration.handler],
  [webhookDeliveries.tool,webhookDeliveries.handler]
].map(([t,h])=>[t.name,h]));
