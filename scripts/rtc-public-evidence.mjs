// Non-secret deployed RTC evidence. This verifies only public HTTP and missing-pass denial.
// The caller independently obtains the actual deployed SHA from its hosting provider.
// No authenticated pass, OAuth token, provider credential or remote mutation is used.
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const SHA=/^[a-f0-9]{40}$/;
function check(name,passed){return {name,passed:passed===true};}
function originOf(value){
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
      url.pathname!=='/'||url.origin!==value.replace(/\/$/,'')||
      /^(?:localhost|.*\.localhost)$/i.test(url.hostname)||
      /^\[?[0-9a-f:.]+\]?$/i.test(url.hostname))return null;
    return url.origin;
  }catch{return null;}
}
async function read(fetchImpl,origin,path){
  const response=await fetchImpl(origin+path,{method:'GET',redirect:'error',
    headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});
  // Error handling never reproduces remote content or any configured credential.
  const value=await response.json();
  return {status:response.status,value};
}
export async function probeRtcPublic({origin,providerRevision,fetchImpl=fetch}={}){
  const url=originOf(origin);
  const checks=[check('public_https_origin',Boolean(url)),
    check('independently_supplied_provider_sha',SHA.test(providerRevision??''))];
  const report={ok:false,checks,claimed_rtc1:false,authenticated_acceptance:false,
    custom_oauth_acceptance:false,hub_route_acceptance:false};
  if(!url||!checks[1].passed)return report;
  try{
    const manifest=await read(fetchImpl,url,'/api/contract');
    const m=manifest.value;
    checks.push(check('public_manifest',manifest.status===200&&
      [0,1].includes(m?.rtc)&&m?.server==='robinson-github-mcp'&&m?.prefix==='github'));
    const reported=m?.service_identity?.reported_revision;
    checks.push(check('exact_reported_revision',typeof reported==='string'&&
      SHA.test(reported)&&reported===providerRevision&&
      m?.service_identity?.independently_verified===false));
    checks.push(check('restricted_subset_declared',m?.https_subset?.authentication==='service_issued_pass'&&
      m?.https_subset?.production_access===false&&m?.https_subset?.allow_writes===false&&
      m?.https_subset?.money_limit_cents===0));
    const openapi=await read(fetchImpl,url,'/api/openapi.json');
    checks.push(check('public_openapi',openapi.status===200&&
      /^3\./.test(String(openapi.value?.openapi??''))&&
      typeof openapi.value?.paths?.['/api/whoami']?.get==='object'));
    const denial=await read(fetchImpl,url,'/api/whoami');
    checks.push(check('no_pass_denied',denial.status===401&&denial.value?.ok===false&&
      denial.value?.error?.code==='permission'));
    report.ok=checks.every(x=>x.passed);
    // Even matching public self-report is NOT provider-verified by this process:
    // the caller's supplied SHA must first be independently verified.
    report.provider_revision_comparison='caller_supplied_not_retrieved';
    report.reported_revision=SHA.test(reported??'')?reported:null;
    report.advertised_rtc=m?.rtc===1?1:0;
    return report;
  }catch{
    checks.push(check('public_http_complete',false));
    return report;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const result=await probeRtcPublic({origin:process.env.RTC_PUBLIC_ORIGIN,
    providerRevision:process.env.RTC_PROVIDER_DEPLOYED_SHA});
  process.stdout.write(JSON.stringify(result)+'\n');
  if(!result.ok)process.exitCode=1;
}
