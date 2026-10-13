// Explicit, protected custom-service RTC acceptance after *independent* Vercel
// deployment inspection. Never accepts a token as a CLI arg or reports its value.
// Nothing here issues/revokes a pass, writes to GitHub or starts a deployment.
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {probeRtcPublic} from './rtc-public-evidence.mjs';

export const TRUSTED_RTC_LIVE_ORIGIN='https://github-mcp-xi.vercel.app';
const PASS=/^rtc_pass_[A-Za-z0-9_-]{43}$/;
const SHA=/^[a-f0-9]{40}$/;
const check=(name,passed)=>({name,passed:passed===true});
async function call(fetchImpl,origin,pass,path,method='GET',body){
  const response=await fetchImpl(origin+path,{method,redirect:'error',
    headers:{accept:'application/json',authorization:'Bearer '+pass,
      ...(body===undefined?{}:{'content-type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    signal:AbortSignal.timeout(8000)});
  const value=await response.json();
  return {status:response.status,value};
}
export async function probeRtcAuthenticated({origin,providerRevision,pass,phase,fetchImpl=fetch}={}){
  const result={ok:false,phase:phase==='read'||phase==='revoked'?phase:null,
    checks:[],authenticated_oauth_mcp:false,hub_acceptance:false,
    full_rtc1_conformance:false,cleanup_acceptance:false,
    provider_revision_independently_retrieved_by_script:false};
  const allowedPhase=phase==='read'||phase==='revoked';
  const trusted=origin===TRUSTED_RTC_LIVE_ORIGIN;
  const validPass=typeof pass==='string'&&PASS.test(pass);
  result.checks.push(check('supported_phase',allowedPhase),
    check('pinned_live_origin',trusted),check('service_pass_format',validPass),
    check('provider_sha_supplied',SHA.test(providerRevision??'')));
  if(!allowedPhase||!trusted||!validPass||!SHA.test(providerRevision??''))return result;
  // The public call must succeed BEFORE the secret is sent anywhere.
  const publicReport=await probeRtcPublic({origin,providerRevision,fetchImpl});
  result.checks.push(check('exact_public_deployment_preflight',publicReport.ok&&
    publicReport.reported_revision===providerRevision));
  if(!result.checks.at(-1).passed)return result;
  const checked=async(name,fn)=>{
    try{
      const passed=await fn();
      result.checks.push(check(name,passed));
      return passed===true;
    }catch{
      result.checks.push(check(name,false));
      return false;
    }
  };
  if(phase==='revoked'){
    await checked('remote_pass_revoked',async()=>{
      const response=await call(fetchImpl,origin,pass,'/api/whoami');
      return response.status===401&&response.value?.ok===false&&
        response.value?.error?.code==='pass_revoked';
    });
    result.ok=result.checks.every(x=>x.passed);
    return result;
  }
  const identity=await checked('authenticated_read_only_identity',async()=>{
    const r=await call(fetchImpl,origin,pass,'/api/whoami');
    const who=r.value?.result;
    return r.status===200&&r.value?.ok===true&&who?.mode==='preview'&&
      who?.profile==='read_only'&&who?.allow_writes===false&&
      who?.production_access===false&&who?.money_limit_cents===0&&
      Array.isArray(who.areas)&&who.areas.length===2&&
      ['server','meta'].every(area=>who.areas.includes(area))&&
      who?.service_identity?.reported_revision===providerRevision;
  });
  if(!identity)return result;
  const listing=await checked('authenticated_catalog_limited_to_areas',async()=>{
    const r=await call(fetchImpl,origin,pass,'/api/tools?listing=catalog&limit=100');
    const tools=r.value?.result?.tools;
    return r.status===200&&r.value?.ok===true&&Array.isArray(tools)&&
      // The restricted catalog must be fully observed, not only page one.
      r.value?.result?.count===tools.length&&r.value?.result?.next===null&&
      tools.some(t=>t.name==='github_whoami')&&tools.every(t=>
        ['server','meta'].includes(t.area)&&t.writes===false&&
        t.money===false&&t.name!=='github_batch');
  });
  if(!listing)return result;
  // Metadata-only refusal: do not POST any write tool during acceptance.
  for(const blocked of ['github_enable_production','github_batch']){
    const denied=await checked('forbidden_discovery_'+blocked,async()=>{
      const r=await call(fetchImpl,origin,pass,'/api/tools/'+blocked);
      return r.status===404&&r.value?.ok===false&&r.value?.error?.code==='not_found';
    });
    if(!denied)return result;
  }
  await checked('authenticated_harmless_server_read',async()=>{
    const r=await call(fetchImpl,origin,pass,'/api/tools/github_whoami','POST',{});
    return r.status===200&&r.value?.ok===true&&r.value?.mode==='preview'&&
      r.value?.result!==undefined;
  });
  result.ok=result.checks.every(x=>x.passed);
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const result=await probeRtcAuthenticated({origin:process.env.RTC_PUBLIC_ORIGIN,
    providerRevision:process.env.RTC_PROVIDER_DEPLOYED_SHA,
    pass:process.env.RTC_AUTH_PASS,phase:process.argv[2]});
  process.stdout.write(JSON.stringify(result)+'\n');
  if(!result.ok)process.exitCode=1;
}
