// RTC read-only HTTPS integration. Reuses the MCP dispatcher; never accepts OAuth tokens as RTC passes.
import {rtcBatchReply} from './batch.js';
import { areaOf } from '../core/meta.js';
import {validateArgs} from '../core/validate.js';
import { rtcMetadata,rtcManifest,rtcOpenApi } from './contract.js';
import {RTC_HTTP_AREAS,rtcHttpTools,rtcIdentity} from './scope.js';

const MAX_REQUEST_BYTES=32768;
// JSON has already been parsed by the HTTP door. Bound the complete wire
// payload before allowing a tool dispatch, including multibyte strings.
function boundedRequest(value,headers={}) {
  // JSON parsing discards raw whitespace and escapes. Reject declared
  // oversized wire bodies even if the parsed object is tiny.
  const declared=headers?.['content-length'];
  if(declared!==undefined&&
    (typeof declared!=='string'||!/^(0|[1-9][0-9]*)$/.test(declared)||
      !Number.isSafeInteger(Number(declared))||Number(declared)>MAX_REQUEST_BYTES))
    return false;
  try {
    const json=JSON.stringify(value);
    return typeof json==='string'&&Buffer.byteLength(json,'utf8')<=MAX_REQUEST_BYTES;
  }catch{
    return false;
  }
}
const messages={
  permission:'Owner-issued RTC pass required.',pass_expired:'RTC pass expired.',
  pass_revoked:'RTC pass revoked.',refused_by_guard:'Operation outside read-only scratch permission.',
  rate_limited:'Rate limit reached.',invalid_args:'Invalid request.',
  not_found:'Tool or result not found.',service_error:'RTC service unavailable.'
};
export const rtcError=code=>({ok:false,error:{code,what:messages[code]??'Request refused.',
  cause:code,todo:code==='rate_limited'?'Retry after Retry-After.':'Check authorization and input.',technical:''}});
const send=(res,status,value)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  return res.status(status).json(value);
};
const name=(req,key)=>{
  const value=req.query?.[key];
  return typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value)?value:null;
};
const deny=(res,status,body)=>{send(res,status,body);return null;};
function parseResultQuery(query={}) {
  const paging={};
  for(const [key,min,max] of [['page',1,100000],['pageSize',1,100],['offset',0,100000000]]){
    if(query[key]===undefined)continue;
    const value=query[key];
    if(typeof value!=='string'||!/^[0-9]+$/.test(value))return null;
    const num=Number(value);
    if(!Number.isSafeInteger(num)||num<min||num>max)return null;
    paging[key]=num;
  }
  if(query.fields!==undefined){
    const values=Array.isArray(query.fields)?query.fields:[query.fields];
    if(values.some(v=>typeof v!=='string'))return null;
    const fields=values.flatMap(v=>v.split(','));
    if(fields.length<1||fields.length>20||fields.some(v=>!v||v.length>64))return null;
    paging.fields=fields;
  }
  if(Object.keys(query).some(k=>!['handle','page','pageSize','offset','fields'].includes(k)))return null;
  return paging;
}
function parseToolsQuery(query={}) {
  if(!query||typeof query!=='object'||Array.isArray(query)||
    Object.keys(query).some(k=>!['limit','page','q','area','audience','listing'].includes(k)))
    return null;
  const numeric=(key,fallback,max)=>{
    const value=query[key];
    if(value===undefined)return fallback;
    if(typeof value!=='string'||!/^[0-9]+$/.test(value))return null;
    const n=Number(value);
    return Number.isSafeInteger(n)&&n>=1&&n<=max?n:null;
  };
  const limit=numeric('limit',20,100),page=numeric('page',1,1000);
  if(limit===null||page===null)return null;
  const bounded=(key,max)=>{
    const value=query[key]??'';
    return typeof value==='string'&&value.length<=max?value:null;
  };
  const q=bounded('q',200),area=bounded('area',64),audience=bounded('audience',64);
  const listing=query.listing??'compact';
  if(q===null||area===null||audience===null||
    !['catalog','compact'].includes(listing))return null;
  return {limit,page,q:q.toLowerCase(),area,audience,listing};
}
async function authenticate(req,res,db){
  const bearer=/^Bearer (rtc_pass_[A-Za-z0-9_-]{43})$/.exec(String(req.headers?.authorization??''));
  if(!bearer)return deny(res,401,rtcError('permission'));
  const row=await db.getRtcPass(bearer[1]);
  if(!row)return deny(res,401,rtcError('permission'));
  if(row.revoked_at)return deny(res,401,rtcError('pass_revoked'));
  if(!(Date.parse(row.expires_at)>Date.now()))return deny(res,401,rtcError('pass_expired'));
  if(row.mode!=='preview'||row.profile!=='read_only'||row.listing!=='compact'||
    !/^rtc-[a-f0-9]{24}$/.test(row.client_id??'')||
    !Array.isArray(row.accounts)||row.accounts.length!==1||
    row.accounts[0]!==row.default_account||
    !Array.isArray(row.areas)||row.areas.length!==2||
    !RTC_HTTP_AREAS.every(area=>row.areas.includes(area))||
    row.allow_writes!==false||row.production_access!==false||
    Number(row.money_limit_cents)!==0)
    return deny(res,403,rtcError('refused_by_guard'));
  const account=await db.getAccount(row.default_account);
  if(!account||account.login!==row.default_account||account.is_scratch!==true||
    account.production_enabled!==false||account.account_type!=='Organization'||
    account.installation_status!=='active'||account.repository_selection!=='all')
    return deny(res,403,rtcError('refused_by_guard'));
  if(!await db.consumeRtcPassRate(bearer[1])){
    res.setHeader('Retry-After','60');
    return deny(res,429,rtcError('rate_limited'));
  }
  return {client_id:row.client_id,default_account:row.default_account,
    accounts:[row.default_account],areas:[...row.areas],mode:'preview',profile:'read_only',listing:'compact'};
}
export function createRtcHttpHandler({db,registry,dispatch}){
  if(!db||!registry||typeof dispatch!=='function')
    throw new TypeError('RTC HTTP needs the existing guarded dispatcher.');
  const allowed=()=>rtcHttpTools(registry);
  const run=async(tool,args,connection)=>{
    const selected=allowed().find(t=>t.name===tool);
    if(!selected)return {status:403,body:rtcError('refused_by_guard')};
    // The same validator as the canonical MCP dispatcher distinguishes a
    // caller's malformed arguments from an unavailable upstream service.
    // Never label a provider failure as a request-validation error.
    if(validateArgs(selected.inputSchema,args))
      return {status:400,body:rtcError('invalid_args')};
    const output=await dispatch({registry,name:tool,args,connection,db});
    if(!output||typeof output!=='object'||output.isError===true||
      !Object.hasOwn(output,'structuredContent'))
      return {status:503,body:rtcError('service_error')};
    const value=output.structuredContent;
    const kept=value?.kept_result;
    if(kept?.handle && /^res_[A-Za-z0-9_-]{20,64}$/.test(kept.handle)) {
      const {kept_result: _discarded,...summary}=value;
      return {status:200,body:{ok:true,result:summary,handle:kept.handle,
        summary:String(kept.what??'Large result'),mode:connection.mode}};
    }
    return {status:200,body:{ok:true,result:value,mode:connection.mode}};
  };
  return async(req,res,route)=>{
    if(route==='contract'||route==='openapi'){
      return req.method==='GET'
        ?send(res,200,route==='contract'?rtcManifest(registry):rtcOpenApi())
        :send(res,405,rtcError('invalid_args'));
    }
    try{
      const connection=await authenticate(req,res,db);
      if(!connection)return;
      if(route==='whoami'&&req.method==='GET')
        return send(res,200,{ok:true,result:{profile:'read_only',mode:'preview',
          areas:connection.areas,accounts:connection.accounts,allow_writes:false,
          production_access:false,money_limit_cents:0,service_identity:rtcIdentity()}});
      if(route==='tools'&&req.method==='GET'){
        const query=parseToolsQuery(req.query);
        if(!query)return send(res,400,rtcError('invalid_args'));
        const {limit,page,q,area,audience,listing}=query;
        let tools=allowed().filter(t=>(!area||areaOf(t)===area)&&
          (!audience||rtcMetadata(t).audience.includes(audience))&&
          (!q||t.name.toLowerCase().includes(q)||t.description.toLowerCase().includes(q)));
        if(listing==='compact')tools=tools.filter(t=>t.compact===true);
        const start=(page-1)*limit;
        return send(res,200,{ok:true,result:{tools:tools.slice(start,start+limit).map(rtcMetadata),
          count:tools.length,next:start+limit<tools.length?page+1:null}});
      }
      if(route==='tool'){
        const tool=name(req,'name');
        if(!tool||!allowed().some(t=>t.name===tool))
          return send(res,404,rtcError('not_found'));
        if(req.method==='GET')
          return send(res,200,{ok:true,result:rtcMetadata(allowed().find(t=>t.name===tool))});
        if(req.method!=='POST'||!req.body||typeof req.body!=='object'||
          Array.isArray(req.body)||!boundedRequest(req.body,req.headers))
          return send(res,400,rtcError('invalid_args'));
        const result=await run(tool,req.body,connection);
        return send(res,result.status,result.body);
      }
      if(route==='batch'){
        const calls=req.body?.calls;
        if(req.method!=='POST'||!req.body||typeof req.body!=='object'||
          Array.isArray(req.body)||Object.keys(req.body).some(k=>k!=='calls')||
          !boundedRequest(req.body,req.headers)||!Array.isArray(calls)||calls.length===0||calls.length>10)
          return send(res,400,rtcError('invalid_args'));
        // Reject the whole batch before dispatching any read. A malformed later item
        // must not cause earlier reads to be executed under ambiguous arguments.
        if(calls.some(c=>!c||typeof c!=='object'||Array.isArray(c)||
          typeof c.name!=='string'||
          (c.args!==undefined&&(!c.args||typeof c.args!=='object'||Array.isArray(c.args)))||
          Object.keys(c).some(key=>key!=='name'&&key!=='args')))
          return send(res,400,rtcError('invalid_args'));
        const tools=allowed();
        if(calls.some(c=>!tools.some(t=>t.name===c.name)))
          return send(res,403,rtcError('refused_by_guard'));
        // Schema-check every item before the first read or additional rate unit.
        if(calls.some(c=>validateArgs(tools.find(t=>t.name===c.name).inputSchema,c.args??{})))
          return send(res,400,rtcError('invalid_args'));
        const results=[];
        let current=connection;
        for(let i=0;i<calls.length;i++){
          // A pass can be revoked, expire, or lose its verified scratch owner
          // between the individual reads. Recheck the current DB authority and
          // consume another shared rate unit before every subsequent dispatch.
          // Never continue with the original, potentially stale connection.
          if(i>0){
            current=await authenticate(req,res,db);
            if(!current)return;
          }
          const item=calls[i];
          const result=await run(item.name,item.args??{},current);
          if(result.status!==200)return send(res,result.status,result.body);
          // A retained result must remain retrievable after a batch call.
          // Its original connection-owned handle is never expanded here.
          results.push({name:item.name,ok:true,result:result.body.result,
            ...(result.body.handle?{handle:result.body.handle,summary:result.body.summary}:{})});
        }
        const reply=await rtcBatchReply({results,connection:current,db});
        return send(res,200,reply);
      }
      if(route==='results'){
        const handle=name(req,'handle');
        if(req.method!=='GET'||!handle||!/^res_[A-Za-z0-9_-]{20,64}$/.test(handle))
          return send(res,404,rtcError('not_found'));
        const paging=parseResultQuery(req.query);
        if(!paging)return send(res,400,rtcError('invalid_args'));
        const result=await run('github_get_result',{handle,...paging},connection);
        return send(res,result.status===200?200:404,
          result.status===200?result.body:rtcError('not_found'));
      }
      return send(res,404,rtcError('not_found'));
    }catch{
      return send(res,503,rtcError('service_error'));
    }
  };
}
