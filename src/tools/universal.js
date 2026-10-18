// U-1: universal REST is intentionally narrower than raw octokit: every request is
// pinned-schema validated, scoped, curated-first, and sent through the normal client.
import { defineRead } from './define-read.js';
import { defineGithubWrite } from './define-github-write.js';
import { githubFor } from '../github/client.js';
import { plain } from './github-read.js';
import { refusal } from './github-write.js';
import { restOperations,restOperation,validateRest,describeRest } from '../github/openapi-index.js';
import { classifyUniversal,assertUniversalAuthority,universalPrice } from '../github/operation-classes.js';
import { curatedTool } from '../github/hand-built-map.js';

const OP={type:'string',minLength:2,maxLength:240,description:'Pinned operationId or METHOD /path'};
const PARAMS={type:'object',additionalProperties:true,maxProperties:60,description:'Only OpenAPI-defined path and query parameters'};
const BODY={type:'object',additionalProperties:true,description:'JSON request body, validated against the pinned GitHub schema'};
const OWNER={type:'string',minLength:1,maxLength:39};
const CRED={type:'string',enum:['I','U','P'],description:'I installation; U user; P enrolled package-only classic token'};
const queryProperties={operation:OP,params:PARAMS,body:BODY,owner:OWNER,cred:CRED};

function ownerFor(a,c,p) {
  const names=[a.owner,p.owner,p.org,p.username,p.account].filter(v=>typeof v==='string'&&v.length);
  const owner=String(names[0]??c.connection.default_account);
  if(names.some(n=>n.toLowerCase()!==owner.toLowerCase()))
    throw new TypeError('Universal operation account and path must belong to the same connected account.');
  if(!(c.connection.accounts??[]).some(n=>n.toLowerCase()===owner.toLowerCase()))
    throw new TypeError('Requested account is not enrolled in this connection.');
  return owner;
}
function scopeFor(a,c,p,op) {
  const owner=ownerFor(a,c,p);
  const repo=p.repo;
  if(repo!==undefined && (typeof repo!=='string'||!repo.trim()))
    throw new TypeError('A named repository must not be blank.');
  if(/\/repos\/\{owner\}\/\{repo\}/.test(op.path) && !repo)
    throw new TypeError('A repository operation needs an explicit repository.');
  return {owner, ...(repo?{repo}:{}),scope:repo?'repo':'org',
    kind:repo?'universal-repo':'universal-account'};
}
function credentials(a,op) {
  if(typeof a.cred!=='undefined' && !['I','U','P'].includes(a.cred))
    throw new TypeError('Only enrolled I, U and package-only P credentials are supported.');
  const packages=/^\/(?:orgs\/\{org\}|users\/\{username\}|user)\/packages(?:\/|$)/.test(op.path);
  if ((packages && a.cred !== 'P') || (a.cred === 'P' && !packages))
    throw new TypeError('Package routes require explicitly enrolled P authorization; P cannot be used for other operations.');
  const userOnly=/^\/user(?:\/|$)/.test(op.path);
  if(userOnly && !packages && a.cred!=='U')
    throw new TypeError('This operation requires explicitly selected U authorization.');
  return a.cred??'I';
}
function resolve(a,c,methods,writing=false) {
  const op=restOperation(a.operation,methods);
  const params=a.params??{};
  // Validate and classify BEFORE any credential or provider request.
  validateRest(op,params,a.body);
  assertUniversalAuthority(op,params,a.body);
  if(writing) {
    const curated=curatedTool(op);
    if(curated) throw new TypeError('The specialized '+curated+' tool must be used for this operation; universal access cannot bypass its checks.');
  }
  const target=scopeFor(a,c,params,op);
  const body=a.body??{};
  const reserved=new Set(['headers','request','mediaType','url','method','baseUrl']);
  for(const name of [...Object.keys(params),...Object.keys(body)]) {
    if(reserved.has(name))throw new TypeError('Transport override is not permitted: '+name);
    if(Object.hasOwn(params,name)&&Object.hasOwn(body,name))throw new TypeError('Body overrides a path/query value: '+name);
  }
  if(JSON.stringify({params,body}).length>32768)throw new TypeError('REST arguments exceed the safe request size.');
  const cred=credentials(a,op);
  if(writing && op.deprecated) throw new TypeError('Deprecated provider writes are refused until reviewed.');
  return {op,params,target,cred,request:{...params,...(a.body??{})}};
}
async function accountClient(ctx,target,cred) {
  // Fine-grained and U credentials cannot be narrowed per request.
  // An enrolled GitHub App can mint a scoped installation credential.
  const account=await ctx.db.getAccount(target.owner);
  return githubFor(ctx,{owner:target.owner,cred,
    ...(cred==='I'&&account?.credential_kind==='app'&&target.repo?
      {scope:{repositories:[target.repo]}}:{})});
}
async function requestFor(ctx,{target,cred,op,request}) {
  return (await accountClient(ctx,target,cred)).request(op.route,request);
}
function safeDescription(op) {
  const mark=classifyUniversal(op);
  return {operationId:op.operationId,method:op.method,path:op.path,summary:op.summary,
    category:op.category,kind:op.method==='GET'?'read':'write',
    production:mark.production,accessWidening:mark.accessWidening,
    notifies:mark.notifies,spendRisk:mark.spendRisk,
    curated:curatedTool(op),deprecated:op.deprecated};
}
const apiSearch=defineRead({
  name:'github_api_search',area:'universal',audience:['B','O','Op'],
  description:'Find pinned GitHub REST operations by method, path, summary or category, with conservative safety labels.',
  properties:{query:{type:'string',minLength:1,maxLength:160},
    method:{type:'string',enum:['GET','POST','PUT','PATCH','DELETE']},
    max:{type:'integer',minimum:1,maximum:40}},required:['query'],
  handler:async a=>{
    const words=a.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let matches=0,items=[];
    for(const op of restOperations()) {
      if(a.method && op.method!==a.method)continue;
      const hay=(op.route+' '+op.summary+' '+op.operationId+' '+op.category).toLowerCase();
      if(!words.every(word=>hay.includes(word)))continue;
      matches++;
      if(items.length<(a.max??20))items.push(safeDescription(op));
    }
    return {pinnedVersion:'2026-03-10',count:matches,shown:items.length,more:matches>items.length,items};
  }
});
const apiDescribe=defineRead({
  name:'github_api_describe',area:'universal',audience:['B','O','Op'],
  description:'Describe one pinned REST operation, allowed inputs and its guarded or curated route.',
  properties:{operation:OP},required:['operation'],
  handler:async a=>{
    const op=restOperation(a.operation);
    return {...describeRest(op),safety:safeDescription(op)};
  }
});
const apiRead=defineRead({
  name:'github_api_read',area:'universal',audience:['B','O','Op'],
  description:'Run a validated pinned GitHub GET operation with scoped credentials and bounded retained results.',
  properties:{operation:OP,params:PARAMS,owner:OWNER,cred:CRED},required:['operation'],
  handler:(a,c)=>plain(async()=>{
    const result=resolve(a,c,['GET']);
    const response=await requestFor(c,result);
    return {operationId:result.op.operationId,route:result.op.route,status:response.status,
      data:response.data,scope:result.target.owner+(result.target.repo?'/'+result.target.repo:'')};
  })
});
function readRouteFor(op) {
  try{return restOperation('GET '+op.path,'GET');}catch{return null;}
}
// Baseline is obtained BEFORE the write and always scoped to the same account.
async function baseline(ctx,chosen) {
  const {op,params,target,cred}=chosen;
  const same=readRouteFor(op);
  if(same) {
    try {
      return {kind:'exact',state:(await requestFor(ctx,{...chosen,op:same,request:params})).data};
    } catch(error) {
      if(error?.status!==404)throw error;
      // A missing target is not a valid positive baseline for generic writes.
      return {kind:'absent',state:null};
    }
  }
  if(target.repo) {
    const data=(await (await accountClient(ctx,target,cred))
      .request('GET /repos/{owner}/{repo}',{owner:target.owner,repo:target.repo})).data;
    if(data?.full_name && data.full_name.toLowerCase()!==(target.owner+'/'+target.repo).toLowerCase())
      throw refusal('The repository identity returned by GitHub did not match the requested target.');
    return {kind:'parent',state:{full_name:data.full_name,default_branch:data.default_branch}};
  }
  const org=(await (await accountClient(ctx,target,cred))
    .request('GET /orgs/{org}',{org:target.owner})).data;
  if(String(org?.login??'').toLowerCase()!==target.owner.toLowerCase())
    throw refusal('The account identity returned by GitHub did not match.');
  return {kind:'parent',state:{login:org.login}};
}
function beforeFingerprint(value){return JSON.stringify(value??null);}
const apiWrite=defineGithubWrite({
  name:'github_api_write',area:'universal',audience:['B','O','Op'],
  description:'PRODUCTION: Execute validated non-curated REST writes with delegated billing warnings, scoped guards and confirmation.',
  properties:queryProperties,required:['operation'],
  declarations:{production:'when-target',accessWidening:true,notifies:true,spend:true,confirm:'always',cred:'I,U,P',profiles:['full']},
  target:(a,c)=>resolve(a,c,['POST','PUT','PATCH','DELETE'],true).target,
  read:async(a,c)=>baseline(c,resolve(a,c,['POST','PUT','PATCH','DELETE'],true)),
  price:({args:a,ctx:c})=>universalPrice(resolve(a,c,['POST','PUT','PATCH','DELETE'],true).op),
  classify:({args:a,ctx:c,target:t,before})=>{
    const {op}=resolve(a,c,['POST','PUT','PATCH','DELETE'],true);
    const classed=classifyUniversal(op);
    return {production:classed.production?'universal '+op.method+' operation on '+t.owner:null,
      accessWidening:classed.accessWidening?'unclassified privilege implications require independent approval':null,
      notifies:classed.notifies?[t.owner+' (GitHub notification recipients must be verified)']:[],
      ...(before?.kind==='absent'?{production:'the existing object was not readable'}:{})};
  },
  summarize:({args:a,ctx:c,target:t,before})=>{
    const {op}=resolve(a,c,['POST','PUT','PATCH','DELETE'],true);
    return op.method+' '+op.path+' ('+String(op.summary).slice(0,120)+') on '+t.owner+
      (t.repo?'/'+t.repo:'')+'; existing baseline: '+(before?.kind??'unreadable')+
      '; intended JSON fields: '+Object.keys(a.body??{}).join(',').slice(0,180);
  },
  apply:async({args:a,ctx:c})=>{
    const chosen=resolve(a,c,['POST','PUT','PATCH','DELETE'],true);
    return requestFor(c,chosen);
  },
  readAfter:async({args:a,ctx:c,response})=>{
    const chosen=resolve(a,c,['POST','PUT','PATCH','DELETE'],true);
    const same=readRouteFor(chosen.op);
    if(!same)return {independentlyRead:false,receipt:{status:response?.status,
      identifier:response?.data?.id??response?.data?.node_id??response?.data?.number??null}};
    const after=await requestFor(c,{...chosen,op:same,request:chosen.params});
    return {independentlyRead:true,data:after.data};
  },
  verify:({args:a,before,after})=>{
    if(!after?.independentlyRead)return false;
    if(before?.kind==='exact' && beforeFingerprint(before.state)===beforeFingerprint(after.data))
      return false;
    const changes=Object.entries(a.body??{});
    // An accepted write without a matching independent read is NEVER claimed as confirmed.
    return changes.length>0 && changes.every(([key,value])=>
      Object.prototype.hasOwnProperty.call(after.data??{},key)&&
      beforeFingerprint(after.data[key])===beforeFingerprint(value));
  },
  present:({after,response})=>({status:response?.status??null,
    independentRead:after?.independentlyRead===true,
    state:after?.independentlyRead===true?after.data:null,
    receiptId:response?.data?.id??response?.data?.node_id??response?.data?.number??null}),
  inverse:()=>null
});
export const tools=[apiSearch.tool,apiDescribe.tool,apiRead.tool,apiWrite.tool];
export const handlers=Object.fromEntries([apiSearch,apiDescribe,apiRead,apiWrite].map(x=>[x.tool.name,x.handler]));
