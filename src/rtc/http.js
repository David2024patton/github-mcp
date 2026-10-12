// RTC read-only HTTPS integration. Reuses the MCP dispatcher; never accepts OAuth tokens as RTC passes.
import { toolsForProfile } from '../core/registry.js';
import { areaOf } from '../core/meta.js';
import { rtcMetadata,rtcManifest,rtcOpenApi } from './contract.js';

const ALLOWED=new Set(['server','meta']);
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
const scopedTools=registry=>toolsForProfile(registry,'read_only').filter(t=>
  ALLOWED.has(areaOf(t))&&t.annotations?.readOnlyHint===true&&t.writes!==true&&t.passthrough!==true);
const name=(req,key)=>{
  const value=req.query?.[key];
  return typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value)?value:null;
};
const deny=(res,status,body)=>{send(res,status,body);return null;};
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
    !row.areas.includes('server')||!row.areas.includes('meta')||
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
  const allowed=()=>scopedTools(registry);
  const run=async(tool,args,connection)=>{
    if(!allowed().some(t=>t.name===tool))return {status:403,body:rtcError('refused_by_guard')};
    const output=await dispatch({registry,name:tool,args,connection,db});
    if(output?.isError)return {status:400,body:rtcError('invalid_args')};
    const value=output?.structuredContent??null;
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
          areas:connection.areas,accounts:connection.accounts,allow_writes:false}});
      if(route==='tools'&&req.method==='GET'){
        const limit=Number(req.query?.limit??20),page=Number(req.query?.page??1);
        if(!Number.isInteger(limit)||limit<1||limit>100||
          !Number.isInteger(page)||page<1||page>1000)
          return send(res,400,rtcError('invalid_args'));
        const q=String(req.query?.q??'').toLowerCase();
        const area=String(req.query?.area??'');
        const audience=String(req.query?.audience??'');
        const listing=req.query?.listing==='catalog'?'catalog':'compact';
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
        if(req.method!=='POST'||!req.body||typeof req.body!=='object'||Array.isArray(req.body))
          return send(res,400,rtcError('invalid_args'));
        const result=await run(tool,req.body,connection);
        return send(res,result.status,result.body);
      }
      if(route==='batch'){
        const calls=req.body?.calls;
        if(req.method!=='POST'||!Array.isArray(calls)||calls.length===0||calls.length>10)
          return send(res,400,rtcError('invalid_args'));
        // Reject the whole batch before dispatching any read. A malformed later item
        // must not cause earlier reads to be executed under ambiguous arguments.
        if(calls.some(c=>!c||typeof c!=='object'||Array.isArray(c)||
          typeof c.name!=='string'||
          (c.args!==undefined&&(!c.args||typeof c.args!=='object'||Array.isArray(c.args)))||
          Object.keys(c).some(key=>key!=='name'&&key!=='args')))
          return send(res,400,rtcError('invalid_args'));
        if(calls.some(c=>!allowed().some(t=>t.name===c.name)))
          return send(res,403,rtcError('refused_by_guard'));
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
          results.push({name:item.name,ok:true,result:result.body.result});
        }
        return send(res,200,{ok:true,result:{results}});
      }
      if(route==='results'){
        const handle=name(req,'handle');
        if(req.method!=='GET'||!handle||!/^res_[A-Za-z0-9_-]{20,64}$/.test(handle))
          return send(res,404,rtcError('not_found'));
        const result=await run('github_get_result',{handle},connection);
        return send(res,result.status===200?200:404,
          result.status===200?result.body:rtcError('not_found'));
      }
      return send(res,404,rtcError('not_found'));
    }catch{
      return send(res,503,rtcError('service_error'));
    }
  };
}
