import {describe,it,expect} from 'vitest';
import {makeWorld,runWriteContract,parse} from '../../test/helpers/write-contract.js';
import {registry} from '../../src/tools/index.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import * as settings from '../../src/tools/security-settings-write.js';

const routes={
  repo:'GET /repos/{owner}/{repo}',repoPatch:'PATCH /repos/{owner}/{repo}',
  actions:'GET /repos/{owner}/{repo}/actions/permissions',
  workflow:'GET /repos/{owner}/{repo}/actions/permissions/workflow',
  selected:'GET /repos/{owner}/{repo}/actions/permissions/selected-actions',
  fork:'GET /repos/{owner}/{repo}/actions/permissions/fork-pr-contributor-approval',
  retention:'GET /repos/{owner}/{repo}/actions/permissions/artifact-and-log-retention',
  pvr:'GET /repos/{owner}/{repo}/private-vulnerability-reporting',pvrPut:'PUT /repos/{owner}/{repo}/private-vulnerability-reporting',
  pvrDelete:'DELETE /repos/{owner}/{repo}/private-vulnerability-reporting',
  workflowPut:'PUT /repos/{owner}/{repo}/actions/permissions/workflow',
  retentionPut:'PUT /repos/{owner}/{repo}/actions/permissions/artifact-and-log-retention'
};
const security=(secret='disabled',priv=false)=>({
  id:1,full_name:'example-org/hello',private:priv,
  security_and_analysis:{
    advanced_security:{status:'disabled'},code_security:{status:'disabled'},
    secret_scanning:{status:secret},
    secret_scanning_push_protection:{status:'disabled'},
    dependabot_security_updates:{status:'enabled'}}});
function arrangeFeature(gh,result){
  gh.when(routes.repo).replySequence([
    {status:200,body:security()},
    {status:200,body:security(result==='ok'?'enabled':'disabled')}]);
  gh.when(routes.repoPatch).reply(200,security('enabled'));
  gh.when(routes.pvr).reply(200,{enabled:false});
}
const actions={enabled:true,allowed_actions:'all',sha_pinning_required:true};
const workflow=(p='read')=>({
  default_workflow_permissions:p,can_approve_pull_request_reviews:false});
const fork={approval_policy:1};
const retention={days:30,maximum_allowed_days:90};
function arrangeWorkflow(gh,result){
  gh.when(routes.actions).reply(200,actions);
  gh.when(routes.workflow).replySequence([
    {status:200,body:workflow()},
    {status:200,body:workflow(result==='ok'?'write':'read')}]);
  gh.when(routes.fork).reply(200,fork);
  gh.when(routes.retention).reply(200,retention);
  gh.when(routes.workflowPut).reply(204,null);
}
const featureDef={tool:settings.securitySetFeature.tool,
  handler:settings.securitySetFeature.handler};
const actionDef={tool:settings.actionsSetSettings.tool,
  handler:settings.actionsSetSettings.handler};
runWriteContract({
  label:'github_security_set_feature preserves other flags',
  definition:featureDef,args:{repo:'hello',feature:'secret_scanning',enabled:true},
  production:true,needsConfirm:true,profile:'full',arrange:arrangeFeature});
runWriteContract({
  label:'github_actions_set_settings preserves other policy',
  definition:actionDef,args:{repo:'hello',section:'workflow',
    changes:{default_workflow_permissions:'write'}},
  production:true,needsConfirm:true,accessWidening:true,profile:'full',
  arrange:arrangeWorkflow});
async function call(w,name,args){
  const dispatch=createDispatch({env:w.ctx.env,credentials:w.credentials,
    fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:[]});
  const v=await dispatch({registry,name,args,connection:w.connection,db:w.db});
  return v.structuredContent??(v.isError?{done:false,error:v.content?.[0]?.text}:parse(v));
}
describe('H-4 security feature and Actions policy safety',()=>{
  it('reads five Actions categories and feature state before modifying anything',async()=>{
    const w=await makeWorld({mode:'preview',profile:'full'});
    arrangeWorkflow(w.gh,'ok');w.gh.when(routes.repo).reply(200,security());w.gh.when(routes.pvr).reply(200,{enabled:true});
    const a=await call(w,'github_actions_get_settings',{repo:'hello'});
    const s=await call(w,'github_security_get_settings',{repo:'hello'});
    expect(a.workflow.default_workflow_permissions).toBe('read');
    expect(a.retention.days).toBe(30);
    expect(a.actions.sha_pinning_required).toBe(true);
    expect(s.security_and_analysis.dependabot_security_updates).toBe('enabled');
    expect(s.security_and_analysis.private_vulnerability_reporting).toBe('enabled');
    expect(w.gh.invalid).toEqual([]);
  });
  it('paid activation on a private repo is refused at source even if confirmation is sent',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(routes.repo).reply(200,security('disabled',true));
    const r=await call(w,'github_security_set_feature',{
      repo:'hello',feature:'code_security',enabled:true,confirm:true});
    expect(r.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.route===routes.repoPatch)).toHaveLength(0);
    expect(JSON.stringify(r)).toMatch(/paid|private|spend/i);
  });
  it('denies any changed field without complete readback baseline',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    arrangeWorkflow(w.gh,'ok');
    w.gh.when(routes.workflow).reply(200,{default_workflow_permissions:'read'});
    const r=await call(w,'github_actions_set_settings',{
      repo:'hello',section:'workflow',
      changes:{can_approve_pull_request_reviews:true},confirm:true});
    expect(r.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.method==='PUT')).toHaveLength(0);
  });
  it('blocks retention beyond inherited organization policy',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    arrangeWorkflow(w.gh,'ok');
    const r=await call(w,'github_actions_set_settings',{
      repo:'hello',section:'retention',changes:{days:365},confirm:true});
    expect(r.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.route===routes.retentionPut)).toHaveLength(0);
  });
  it('confirms only the changed workflow fields and writes the complete preserved object',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    arrangeWorkflow(w.gh,'ok');
    const r=await call(w,'github_actions_set_settings',{
      repo:'hello',section:'workflow',
      changes:{default_workflow_permissions:'write'},confirm:true});
    expect(r).toMatchObject({done:true,status:'applied'});
    const put=w.gh.calls.find(x=>x.route===routes.workflowPut);
    expect(put.body).toMatchObject({default_workflow_permissions:'write',
      can_approve_pull_request_reviews:false});
    expect(w.gh.invalid).toEqual([]);
  });
  it('read policy failure never turns into invented defaults',async()=>{
    const w=await makeWorld({mode:'preview',profile:'full'});
    arrangeWorkflow(w.gh,'ok');
    w.gh.when(routes.retention).reply(403,{message:'not allowed'});
    const r=await call(w,'github_actions_get_settings',{repo:'hello'});
    expect(r.done).not.toBe(true);
  });
});

describe('H-4 private vulnerability reporting (its own GitHub endpoint)',()=>{
  const run=(w,args)=>call(w,'github_security_set_feature',{repo:'hello',feature:'private_vulnerability_reporting',...args});
  it('turns reporting on with PUT and verifies by reading it back, leaving every other feature alone',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(routes.repo).reply(200,security());
    w.gh.when(routes.pvr).replySequence([{status:200,body:{enabled:false}},{status:200,body:{enabled:true}}]);
    w.gh.when(routes.pvrPut).reply(204,null);
    const out=await run(w,{enabled:true,confirm:true});
    expect(out).toMatchObject({status:'applied',confirmed:true,result:{feature:'private_vulnerability_reporting',enabled:true}});
    expect(w.gh.calls.filter(c=>c.method!=='GET').map(c=>c.route)).toEqual([routes.pvrPut]);
    expect(w.gh.invalid).toEqual([]);
  });
  it('turns reporting off with DELETE',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(routes.repo).reply(200,security());
    w.gh.when(routes.pvr).replySequence([{status:200,body:{enabled:true}},{status:200,body:{enabled:false}}]);
    w.gh.when(routes.pvrDelete).reply(204,null);
    expect(await run(w,{enabled:false,confirm:true})).toMatchObject({status:'applied',confirmed:true,result:{enabled:false}});
    expect(w.gh.calls.filter(c=>c.method!=='GET').map(c=>c.route)).toEqual([routes.pvrDelete]);
  });
  it('refuses to guess when the reporting status cannot be read, and sends nothing',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(routes.repo).reply(200,security());
    w.gh.when(routes.pvr).reply(404,{message:'Not Found'});
    const out=await run(w,{enabled:true,confirm:true});
    expect(out.done).toBe(false);
    expect(w.gh.calls.filter(c=>c.method!=='GET')).toEqual([]);
  });
  it('is not a paid feature: private repositories are not refused for cost',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(routes.repo).reply(200,security('disabled',true));
    w.gh.when(routes.pvr).replySequence([{status:200,body:{enabled:false}},{status:200,body:{enabled:true}}]);
    w.gh.when(routes.pvrPut).reply(204,null);
    expect(await run(w,{enabled:true,confirm:true})).toMatchObject({status:'applied'});
  });
});
runWriteContract({
  label:'github_security_set_feature private vulnerability reporting',definition:pvrDefForContract(),
  args:{repo:'hello',feature:'private_vulnerability_reporting',enabled:true},
  production:true,needsConfirm:true,profile:'full',arrange(gh,result){
    gh.when(routes.repo).reply(200,security());
    gh.when(routes.pvr).replySequence([{status:200,body:{enabled:false}},{status:200,body:{enabled:result==='ok'}}]);
    gh.when(routes.pvrPut).reply(204,null);
  }});
function pvrDefForContract(){return {tool:settings.securitySetFeature.tool,handler:settings.securitySetFeature.handler};}
