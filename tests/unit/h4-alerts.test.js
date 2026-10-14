import {describe,it,expect} from 'vitest';
import {makeWorld,runWriteContract,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import * as reads from '../../src/tools/security-read.js';
import * as updates from '../../src/tools/security-alerts-write.js';

const SECRET='NONPUBLIC_TEST_SECRET_MUST_NOT_APPEAR';
const routes={
  dep:'GET /repos/{owner}/{repo}/dependabot/alerts',
  code:'GET /repos/{owner}/{repo}/code-scanning/alerts',
  sec:'GET /repos/{owner}/{repo}/secret-scanning/alerts',
  secOne:'GET /repos/{owner}/{repo}/secret-scanning/alerts/{alert_number}',
  secPatch:'PATCH /repos/{owner}/{repo}/secret-scanning/alerts/{alert_number}',
  depOne:'GET /repos/{owner}/{repo}/dependabot/alerts/{alert_number}',
  depPatch:'PATCH /repos/{owner}/{repo}/dependabot/alerts/{alert_number}',
  codeOne:'GET /repos/{owner}/{repo}/code-scanning/alerts/{alert_number}',
  codePatch:'PATCH /repos/{owner}/{repo}/code-scanning/alerts/{alert_number}',
  advisories:'GET /repos/{owner}/{repo}/security-advisories',
  compare:'GET /repos/{owner}/{repo}/dependency-graph/compare/{basehead}',
  pull:'GET /repos/{owner}/{repo}/pulls/{pull_number}'};
const raw=(kind,state='open',reason=null)=>({
  number:9,state,updated_at:'2026-10-14T09:00:00Z',
  secret:SECRET,metadata:[{key:'raw',value:SECRET}],
  rule:{name:'codeQL/test',severity:'warning',security_severity_level:'high'},
  secret_type_display_name:'Test API credential',
  security_vulnerability:{severity:'high'},
  ...(kind==='secret'?{resolution:reason}:
    {dismissed_reason:reason})
});
const def={tool:updates.securityUpdateAlert.tool,handler:updates.securityUpdateAlert.handler};
function arrange(gh,result,kind,reason,status){
  const one=kind==='secret'?routes.secOne:kind==='code'?routes.codeOne:routes.depOne;
  const patch=kind==='secret'?routes.secPatch:kind==='code'?routes.codePatch:routes.depPatch;
  gh.when(one).replySequence([
    {status:200,body:raw(kind)},
    {status:200,body:raw(kind,result==='ok'?status:'open',
      result==='ok'?reason:null)}]);
  gh.when(patch).reply(200,raw(kind,status,reason));
}
runWriteContract({
  label:'github_security_update_alert resolved secret scanning',
  definition:def,args:{repo:'hello',kind:'secret',number:9,state:'resolved',reason:'revoked'},
  production:true,needsConfirm:true,
  arrange:(gh,result)=>arrange(gh,result,'secret','revoked','resolved')});
runWriteContract({
  label:'github_security_update_alert dismissed Dependabot',
  definition:def,args:{repo:'hello',kind:'dependabot',number:9,state:'dismissed',
    reason:'tolerable_risk'},
  production:true,needsConfirm:true,
  arrange:(gh,result)=>arrange(gh,result,'dependabot','tolerable_risk','dismissed')});
runWriteContract({
  label:'github_security_update_alert dismissed code scanning',
  definition:def,args:{repo:'hello',kind:'code',number:9,state:'dismissed',
    reason:'false positive'},
  production:true,needsConfirm:true,
  arrange:(gh,result)=>arrange(gh,result,'code','false positive','dismissed')});
async function call(w,name,args){
  const dispatch=createDispatch({env:w.ctx.env,credentials:w.credentials,
    fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:[]});
  const result=await dispatch({registry,name,args,connection:w.connection,db:w.db});
  return result.structuredContent??parse(result);
}
describe('H-4 security investigation and confidentiality',()=>{
  it('omits literal secret and untrusted metadata on list/get/update plus change log',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(routes.sec).reply(200,[raw('secret')]);
    arrange(w.gh,'ok','secret','revoked','resolved');
    const list=await call(w,'github_security_list_alerts',{
      repo:'hello',kind:'secret'});
    const get=await call(w,'github_security_get_alert',{
      repo:'hello',kind:'secret',number:9});
    const update=await call(w,'github_security_update_alert',{
      repo:'hello',kind:'secret',number:9,state:'resolved',reason:'revoked',confirm:true});
    const observed=JSON.stringify({list,get,update,history:await w.db.listChanges({
      limit:20,includePreviews:true})});
    expect(observed).not.toContain(SECRET);
    expect(list.items[0].secret_material_hidden).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses dismiss/resolve without a provider-supported reason before a write',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    for(const args of [
      {kind:'secret',state:'resolved'},
      {kind:'dependabot',state:'dismissed',reason:'wrong'},
      {kind:'code',state:'dismissed',reason:'false_positive'},
      {kind:'secret',state:'open',reason:'revoked'}]){
      const r=await call(w,'github_security_update_alert',{
        repo:'hello',number:9,...args,confirm:true});
      expect(r.done).toBe(false);
    }
    expect(w.gh.calls).toHaveLength(0);
  });
  it('only supports exact provider alert identity',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(routes.depOne).reply(200,raw('dependabot'));
    const r=await call(w,'github_security_get_alert',{
      repo:'hello',kind:'dependabot',number:11});
    expect(r.isError??r.done).not.toBe(true);
  });
  it('bounds advisory data and checks the actual route contract',async()=>{
    const w=await makeWorld({mode:'preview',profile:'full'});
    w.gh.when(routes.advisories).reply(200,[{
      ghsa_id:'GHSA-abcd-efgh-ijkl',summary:'Test advisory',
      severity:'high',description:SECRET,published_at:'2026-10-14T09:00:00Z'}]);
    const r=await call(w,'github_security_list_advisories',{repo:'hello'});
    expect(r.items).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(w.gh.invalid).toEqual([]);
  });
  it('resolves a PR comparison to exact base and head SHAs',async()=>{
    const w=await makeWorld({mode:'preview',profile:'full'});
    w.gh.when(routes.pull).reply(200,{number:6,
      base:{sha:'a'.repeat(40),repo:{full_name:'example-org/hello'}},
      head:{sha:'b'.repeat(40)}});
    w.gh.when(routes.compare).reply(200,[{
      change_type:'added',name:'safe-test-package',version:'1.0.0',
      ecosystem:'npm',manifest:'package.json',vulnerabilities:[{
        severity:'high',advisory_ghsa_id:'GHSA-aaaa-bbbb-cccc'}]}]);
    const r=await call(w,'github_security_compare_dependencies',{repo:'hello',prNumber:6});
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0].vulnerabilities[0].ghsa_id).toBe('GHSA-aaaa-bbbb-cccc');
    expect(w.gh.calls.find(x=>x.route===routes.compare)?.params?.basehead)
      .toBe('a'.repeat(40)+'...'+'b'.repeat(40));
    expect(w.gh.invalid).toEqual([]);
  });
  it('reports unavailable dependency-review provider 403 without suggesting an upgrade',async()=>{
    const w=await makeWorld({mode:'preview',profile:'full'});
    w.gh.when(routes.compare).reply(403,{message:'Plan does not support dependency review'});
    const r=await call(w,'github_security_compare_dependencies',{
      repo:'hello',base:'abc',head:'def'});
    expect(r.status).toBe('not_available_on_plan');
    expect(r).not.toHaveProperty('changes');
  });
});
