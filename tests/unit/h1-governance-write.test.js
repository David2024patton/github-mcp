import {describe,it,expect} from 'vitest';
import {makeWorld,runWriteContract,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import * as h from '../../src/tools/governance-write.js';
import {registry} from '../../src/tools/index.js';
const base={id:42,name:'Guard main',target:'branch',source:'example-org/hello',
 source_type:'Repository',enforcement:'active',conditions:{
  ref_name:{include:['refs/heads/main'],exclude:[]}},
 rules:[{type:'non_fast_forward'}],bypass_actors:[]};
const routes={
 list:'GET /repos/{owner}/{repo}/rulesets',
 get:'GET /repos/{owner}/{repo}/rulesets/{ruleset_id}',
 post:'POST /repos/{owner}/{repo}/rulesets',
 put:'PUT /repos/{owner}/{repo}/rulesets/{ruleset_id}',
 del:'DELETE /repos/{owner}/{repo}/rulesets/{ruleset_id}',
 checks:'GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks',
 add:'POST /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks/contexts',
 rem:'DELETE /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks/contexts'
};
const def=n=>({tool:h.tools.find(x=>x.name===n),handler:h.handlers[n]});
function arrangeRule(gh,outcome,action){
 let applied=false,deleted=false;
 gh.when(routes.list).reply(200,[]);
 if(action==='delete'){
  gh.when(routes.get).replySequence([
   {status:200,body:base},
   {status:outcome==='ok'?404:200,body:outcome==='ok'?{message:'Not Found'}:base}
  ]);
 }else gh.when(routes.get).reply(200,()=>{
  if(!applied)return base;
  const now=action==='create'?base:{...base,enforcement:'evaluate'};
  return outcome==='ok'?now:{...now,name:'Wrong'};
 });
 gh.when(routes.post).reply(201,()=>{applied=true;return base});
 gh.when(routes.put).reply(200,()=>{applied=true;return {...base,enforcement:'evaluate'}});
 gh.when(routes.del).reply(204,()=>{deleted=true;return null});
}
function arrangeCheck(gh,outcome,action){
 let changed=false;
 gh.when(routes.checks).reply(200,()=>({
  strict:true,contexts:changed&&outcome==='ok'?
   action==='add'?['ci','security']:[]:['ci'],
  checks:[]}));
 gh.when(routes.add).reply(200,()=>{changed=true;return ['ci','security']});
 gh.when(routes.rem).reply(200,()=>{changed=true;return []});
}
runWriteContract({
 label:'github_ruleset_save create',definition:def('github_ruleset_save'),
 args:{repo:'hello',name:'Guard main',target:'branch',
  enforcement:'active',conditions:base.conditions,rules:base.rules},
 production:true,needsConfirm:true,arrange:(gh,o)=>arrangeRule(gh,o,'create')
});
runWriteContract({
 label:'github_ruleset_save update',definition:def('github_ruleset_save'),
 args:{repo:'hello',rulesetId:42,enforcement:'evaluate'},
 production:true,needsConfirm:true,arrange:(gh,o)=>arrangeRule(gh,o,'update')
});
runWriteContract({
 label:'github_ruleset_delete',definition:def('github_ruleset_delete'),
 args:{repo:'hello',rulesetId:42},
 production:true,needsConfirm:true,arrange:(gh,o)=>arrangeRule(gh,o,'delete')
});
runWriteContract({
 label:'github_protection_set_required_checks',definition:def('github_protection_set_required_checks'),
 args:{repo:'hello',branch:'main',action:'add',context:'security'},
 production:true,needsConfirm:true,arrange:(gh,o)=>arrangeCheck(gh,o,'add')
});
async function call(w,name,args){
 const d=createDispatch({credentials:w.credentials,fetch:w.gh.fetch,
  now:w.ctx.now,sleep:w.ctx.sleep,gates:[]});
 const x=await d({registry,name,args,connection:w.connection,db:w.db});
 return x.structuredContent??parse(x);
}
describe('H-1 governance mutations fail closed',()=>{
 it('refuses incomplete existing bypass visibility before any PUT',async()=>{
  const w=await makeWorld({mode:'production',profile:'full'});
  w.gh.when(routes.get).reply(200,{...base,bypass_actors:undefined});
  const x=await call(w,'github_ruleset_save',{
   repo:'hello',rulesetId:42,enforcement:'evaluate',confirm:true});
  expect(x.done).toBe(false);expect(w.gh.calls.filter(q=>q.route===routes.put)).toHaveLength(0);
 });
 it('marks addition of new bypass actor as access widening',async()=>{
  const w=await makeWorld({mode:'production',profile:'full'});
  w.gh.when(routes.get).reply(200,base);
  const x=await call(w,'github_ruleset_save',{repo:'hello',rulesetId:42,
   bypassActors:[{actor_id:99,actor_type:'Team',bypass_mode:'always'}],dryRun:true});
  expect(x.preview).toMatch(/ACCESS CHANGE/);expect(x.preview).toMatch(/PRODUCTION/);
 });
 it('does not send an add when a required check is already present',async()=>{
  const w=await makeWorld({mode:'production'});
  arrangeCheck(w.gh,'ok','add');
  const x=await call(w,'github_protection_set_required_checks',{
   repo:'hello',branch:'main',action:'add',context:'ci',confirm:true});
  expect(x.done).toBe(false);expect(w.gh.calls.filter(q=>q.route===routes.add)).toHaveLength(0);
 });
 it('rejects changing a ruleset in a foreign account',async()=>{
  const w=await makeWorld({mode:'production'});
  const x=await call(w,'github_ruleset_delete',{
   owner:'foreign',repo:'hello',rulesetId:42,confirm:true});
  expect(x.done).toBe(false);expect(w.gh.calls).toHaveLength(0);
 });
});
