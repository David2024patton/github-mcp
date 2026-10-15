// H-4: security alert triage reads and dependency-review diagnostics.
// Never retain raw secret-scanning alert objects, including secrets/metadata,
// in a result or a write journal. Provider responses are projected immediately.
import {listAll} from '../github/client.js';
import {defineRead} from './define-read.js';
import {readerFor,plain} from './github-read.js';

const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const NUMBER={type:'integer',minimum:1},MAX={type:'integer',minimum:1,maximum:100};
const STRING={type:'string',minLength:1,maxLength:255};
const TYPE={type:'string',enum:['dependabot','code','secret']};
const collection=kind=>kind==='dependabot'?'dependabot/alerts':
  kind==='code'?'code-scanning/alerts':'secret-scanning/alerts';
const route=(p,kind,one=false)=>'GET '+(p.scope==='org'?'/orgs/{org}':'/repos/{owner}/{repo}')+
  '/'+collection(kind)+(one?'/{alert_number}':'');
const params=(p,one=false)=>({...(
  p.scope==='org'?{org:p.owner}:{owner:p.owner,repo:p.repo}),
  ...(one?{alert_number:p.number}:{})});
const validate=(p,one=false)=>{
  if(p.scope==='org'&&p.repo)throw new TypeError('Organization alert listing does not accept repo.');
  if(one&&p.scope==='org')throw new TypeError('Get one alert from its exact repository, not an organization.');
  if(p.scope!=='org'&&!p.repo)throw new TypeError('Security alerts require repo.');
};
const alert=(a,kind)=>({
  number:a.number,state:a.state,kind,
  created_at:a.created_at??null,updated_at:a.updated_at??null,
  dismissed_at:a.dismissed_at??null,
  dismissed_reason:a.dismissed_reason??null,
  resolution:a.resolution??null,validity:kind==='secret'?a.validity??null:undefined,
  severity:kind==='dependabot'?a.security_vulnerability?.severity??null:
    kind==='code'?a.rule?.security_severity_level??a.rule?.severity??null:null,
  summary:kind==='dependabot'?a.security_advisory?.summary??null:
    kind==='code'?a.rule?.name??null:a.secret_type_display_name??a.secret_type??null,
  package:kind==='dependabot'?{name:a.dependency?.package?.name??null,
    ecosystem:a.dependency?.package?.ecosystem??null,
    manifest:a.dependency?.manifest_path??null}:undefined,
  location:kind==='code'?{path:a.most_recent_instance?.location?.path??null,
    start_line:a.most_recent_instance?.location?.start_line??null}:undefined,
  html_url:a.html_url??null,
  // Secret strings, raw metadata, response headers and arbitrary payloads are never included.
  secret_material_hidden:kind==='secret'?true:undefined,
  ...(kind==='secret'?{push_protection_bypassed:typeof a.push_protection_bypassed==='boolean'?a.push_protection_bypassed:null}:{})
});
const safeAlert=(a,kind,number)=>{
  if(!Number.isSafeInteger(a?.number)||a.number<1||number!==undefined&&a.number!==number)
    throw new TypeError('GitHub did not return the requested exact alert number.');
  return alert(a,kind);
};
export const securityListAlerts=defineRead({
  name:'github_security_list_alerts',area:'security',audience:['B','O','Op'],
  description:'List bounded repository/organization security alerts without returning secret-scanning material.',
  properties:{owner:OWNER,repo:REPO,scope:{type:'string',enum:['repo','org']},
    kind:TYPE,state:{type:'string',enum:['open','dismissed','resolved','fixed']},max:MAX},
  required:['kind'],
  handler:(a,ctx)=>plain(async()=>{
    const {owner,octokit:gh}=await readerFor(a,ctx),p={...a,owner};validate(p);
    if(a.scope==='org'&&a.kind==='code')throw new TypeError(
      'Organization code-scanning alerts use a different API; use repository scope.');
    if(a.state&&((a.kind==='secret'&&!['open','resolved'].includes(a.state))||
       (a.kind!=='secret'&&a.state==='resolved')))
      throw new TypeError('This alert kind does not support the requested state filter.');
    const data=await listAll(gh,route(p,a.kind),{
      ...params(p),per_page:100,...(a.state?{state:a.state}:{})},{max:a.max??100});
    return {owner,scope:p.scope??'repo',kind:a.kind,
      ...(p.repo?{repo:p.repo}:{}),count:data.items.length,
      complete:!data.capped,items:data.items.map(x=>safeAlert(x,a.kind)),
      ...(data.capped?{warning:'Alert inventory capped; more alerts may exist.'}:{})};
  })
});
export const securityGetAlert=defineRead({
  name:'github_security_get_alert',area:'security',audience:['B','O'],
  description:'Get one exact security alert with reason and severity, suppressing all secret-scanning secret material.',
  properties:{owner:OWNER,repo:REPO,kind:TYPE,number:NUMBER},
  required:['repo','kind','number'],
  handler:(a,ctx)=>plain(async()=>{
    const {owner,octokit:gh}=await readerFor(a,ctx),p={...a,owner};validate(p,true);
    const raw=(await gh.request(route(p,p.kind,true),{
      ...params(p,true),...(a.kind==='secret'?{hide_secret:true}:{})})).data;
    return {owner,repo:a.repo,...safeAlert(raw,a.kind,a.number)};
  })
});
export const securityAdvisories=defineRead({
  name:'github_security_list_advisories',area:'security',audience:['B','O'],
  description:'List bounded repository security advisories or the global GitHub advisory database.',
  properties:{owner:OWNER,repo:REPO,scope:{type:'string',enum:['repo','global']},
    max:MAX,ecosystem:{type:'string',maxLength:70},severity:{type:'string',
      enum:['critical','high','medium','low']}},
  handler:(a,ctx)=>plain(async()=>{
    const {owner,octokit:gh}=await readerFor(a,ctx);
    if(a.scope!=='global'&&!a.repo)throw new TypeError('Repository advisories require repo.');
    if(a.scope==='global'&&a.repo)throw new TypeError('Global advisories have no repo.');
    const route=a.scope==='global'?'GET /advisories':
      'GET /repos/{owner}/{repo}/security-advisories';
    const q=a.scope==='global'?{}:{owner,repo:a.repo};
    const data=await listAll(gh,route,{
      ...q,per_page:100,...(a.ecosystem?{ecosystem:a.ecosystem}:{}),
      ...(a.severity?{severity:a.severity}:{})},{max:a.max??100});
    return {scope:a.scope??'repo',owner,count:data.items.length,
      complete:!data.capped,
      items:data.items.map(x=>({ghsa_id:x.ghsa_id,cve_id:x.cve_id??null,
        summary:x.summary??null,severity:x.severity??null,
        state:x.state??null,html_url:x.html_url??null,
        published_at:x.published_at??null,updated_at:x.updated_at??null})),
      ...(data.capped?{warning:'Advisory inventory truncated.'}:{})};
  })
});
export const compareDependencies=defineRead({
  name:'github_security_compare_dependencies',area:'security',audience:['B','O'],
  description:'Show dependency changes and vulnerabilities between refs or the base/head commits of a pull request.',
  properties:{owner:OWNER,repo:REPO,base:STRING,head:STRING,prNumber:NUMBER,
    name:{type:'string',minLength:1,maxLength:400}},
  required:['repo'],
  handler:(a,ctx)=>plain(async()=>{
    const {owner,octokit:gh}=await readerFor(a,ctx);
    if(Boolean(a.prNumber)===Boolean(a.base&&a.head))
      throw new TypeError('Supply a PR number or both base and head references.');
    if(a.prNumber&&(a.base||a.head))
      throw new TypeError('Cannot mix PR and explicit revisions.');
    let base=a.base,head=a.head;
    if(a.prNumber){
      const pr=(await gh.request('GET /repos/{owner}/{repo}/pulls/{pull_number}',
        {owner,repo:a.repo,pull_number:a.prNumber})).data;
      if(pr?.number!==a.prNumber||!pr.base?.sha||!pr.head?.sha||
        pr.base.repo?.full_name?.toLowerCase()!==`${owner}/${a.repo}`.toLowerCase())
        throw new TypeError('PR base/head identity could not be independently verified.');
      base=pr.base.sha;head=pr.head.sha;
    }
    const p={owner,repo:a.repo,basehead:`${base}...${head}`,
      ...(a.name?{name:a.name}:{})};
    try{
      const data=(await gh.request(
        'GET /repos/{owner}/{repo}/dependency-graph/compare/{basehead}',p)).data;
      if(!Array.isArray(data))throw new TypeError('GitHub did not return dependency comparison items.');
      return {owner,repo:a.repo,base,head,changes:data.slice(0,100).map(x=>({
        change_type:x.change_type,manifest:x.manifest,ecosystem:x.ecosystem,
        package:x.name,version:x.version,license:x.license,
        vulnerabilities:(x.vulnerabilities??[]).slice(0,20).map(v=>({
          ghsa_id:v.advisory_ghsa_id,severity:v.severity,summary:v.advisory_summary}))})),
        complete:data.length<=100,count:data.length};
    }catch(e){
      if(e?.status===403)return {status:'not_available_on_plan',owner,repo:a.repo,
        note:'GitHub dependency review may require eligible Code Security, or disallow this fork. No paid upgrade is attempted.'};
      throw e;
    }
  })
});
export const tools=[securityListAlerts.tool,securityGetAlert.tool,
  securityAdvisories.tool,compareDependencies.tool];
export const handlers=Object.fromEntries([
  [securityListAlerts.tool,securityListAlerts.handler],
  [securityGetAlert.tool,securityGetAlert.handler],
  [securityAdvisories.tool,securityAdvisories.handler],
  [compareDependencies.tool,compareDependencies.handler]
].map(([t,h])=>[t.name,h]));
