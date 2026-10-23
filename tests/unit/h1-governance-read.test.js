import {describe,it,expect} from 'vitest';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
async function call(w,name,args){
 const d=createDispatch({credentials:w.credentials,fetch:w.gh.fetch,
   now:w.ctx.now,sleep:w.ctx.sleep,gates:[]});
 const r=await d({registry,name,args,connection:w.connection,db:w.db});
 return r.isError?r:r.structuredContent??parse(r);
}
const rs={id:42,name:'Checks',target:'branch',source:'example-org/hello',
  source_type:'Repository',enforcement:'active',
  conditions:{ref_name:{include:['refs/heads/main'],exclude:[]}},
  bypass_actors:[],rules:[{type:'required_status_checks',
    parameters:{required_status_checks:[{context:'ci'}]}},{type:'non_fast_forward'}]};
describe('H-1 governance read-only provider routes',()=>{
 it('reads exact branch protection and preserved classic settings',async()=>{
  const w=await makeWorld();w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}')
    .reply(200,{name:'main',protected:true,commit:{sha:'a'.repeat(40)}});
  w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection').reply(200,{
    required_status_checks:{strict:true,contexts:['ci']},
    required_pull_request_reviews:{dismiss_stale_reviews:true},
    enforce_admins:{enabled:true},required_conversation_resolution:{enabled:true}});
  const x=await call(w,'github_protection_get',{repo:'hello',branch:'main'});
  expect(x).toMatchObject({protected:true,classic:{enforce_admins:true,
    required_conversation_resolution:true,required_status_checks:{contexts:['ci']}}});
  expect(w.gh.invalid).toEqual([]);
 });
 it('does not assert ruleset absence when classic protection is unavailable',async()=>{
  const w=await makeWorld();w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}')
    .reply(200,{name:'main',protected:true});
  w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection')
    .reply(404,{message:'Not Found'});
  const x=await call(w,'github_protection_get',{repo:'hello',branch:'main'});
  expect(x).toMatchObject({protected:true,classic_protection_readable:false});
  expect(x.warning).toMatch(/do not infer/i);
 });
 it('reports a readable absence when the branch is not protected and GitHub answers "Branch not protected"',async()=>{
  const w=await makeWorld();w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}')
    .reply(200,{name:'main',protected:false});
  w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection')
    .reply(404,{message:'Branch not protected'});
  const x=await call(w,'github_protection_get',{repo:'hello',branch:'main'});
  expect(x).toMatchObject({protected:false,classic_protection_readable:true,classic:null});
  expect(x.note).toMatch(/ruleset/i);expect(x.warning).toBeUndefined();
 });
 it('says plainly that branch protection is unavailable on a free plan for a private repository (real GitHub answer)',async()=>{
  const w=await makeWorld();w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}')
    .reply(200,{name:'main',protected:false});
  w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection')
    .reply(403,{message:'Upgrade to GitHub Pro or make this repository public to enable this feature.'});
  const x=await call(w,'github_protection_get',{repo:'hello',branch:'main'});
  expect(x).toMatchObject({protected:false,classic_protection_readable:false});
  expect(x.plan_limits[0]).toMatch(/not available.*plan/i);
 });
 it('still refuses any other 403 on the protection read instead of calling it a plan limit',async()=>{
  const w=await makeWorld();w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}')
    .reply(200,{name:'main',protected:true});
  w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection')
    .reply(403,{message:'Resource not accessible by integration'});
  const x=await call(w,'github_protection_get',{repo:'hello',branch:'main'});
  expect(x.plan_limits).toBeUndefined();
 });
 it('lists repository rulesets with clear named rules and enforcement',async()=>{
  const w=await makeWorld();
  w.gh.when('GET /repos/{owner}/{repo}/rulesets').reply(200,[rs]);
  const x=await call(w,'github_ruleset_list',{repo:'hello'});
  expect(x).toMatchObject({count:1,complete:true});
  expect(x.items[0]).toMatchObject({id:42,enforcement:'active'});
  expect(w.gh.invalid).toEqual([]);
 });
 it('lists organization rulesets on the distinct org path',async()=>{
  const w=await makeWorld();
  w.gh.when('GET /orgs/{org}/rulesets').reply(200,[rs]);
  const x=await call(w,'github_ruleset_list',{scope:'org'});
  expect(x).toMatchObject({scope:'org',count:1});
  expect(w.gh.invalid).toEqual([]);
 });
 it('gets an exact ruleset and bounded version history',async()=>{
  const w=await makeWorld();
  w.gh.when('GET /repos/{owner}/{repo}/rulesets/{ruleset_id}').reply(200,rs);
  w.gh.when('GET /repos/{owner}/{repo}/rulesets/{ruleset_id}/history')
    .reply(200,[{version_id:1,updated_at:'2026-10-14T00:00:00Z'}]);
  const x=await call(w,'github_ruleset_get',{repo:'hello',rulesetId:42,history:true});
  expect(x).toMatchObject({id:42,history:{count:1}});
  expect(x.rules[0].description).toContain('ci');
  expect(w.gh.invalid).toEqual([]);
 });
 it('reads a rejection suite with exact rule evaluation notes',async()=>{
  const w=await makeWorld();
  w.gh.when('GET /repos/{owner}/{repo}/rulesets/rule-suites/{rule_suite_id}')
    .reply(200,{id:7,result:'fail',rule_evaluations:[{rule_type:'pull_request',
      result:'fail',enforcement:'active',details:'PR required',
      rule_source:{type:'protected_branch'}}]});
  const x=await call(w,'github_ruleset_list_rule_suites',{
    repo:'hello',ruleSuiteId:7});
  expect(x.item).toMatchObject({id:7,rules:[{result:'fail',details:'PR required'}]});
  expect(w.gh.invalid).toEqual([]);
 });
 it('refuses organization rule paths when a repo is supplied',async()=>{
  const w=await makeWorld();
  const x=await call(w,'github_ruleset_list',{scope:'org',repo:'hello'});
  expect(x.isError).toBe(true);
  expect(w.gh.calls.filter(c=>c.route?.includes('rulesets'))).toHaveLength(0);
 });
});
