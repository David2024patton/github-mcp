import {describe,it,expect} from 'vitest';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
const routes={
 repoList:'GET /repos/{owner}/{repo}/hooks',
 repoOne:'GET /repos/{owner}/{repo}/hooks/{hook_id}',
 deliveries:'GET /repos/{owner}/{repo}/hooks/{hook_id}/deliveries',
 delivery:'GET /repos/{owner}/{repo}/hooks/{hook_id}/deliveries/{delivery_id}',
 orgList:'GET /orgs/{org}/hooks'
};
const secret='example-SIGNING-VALUE-DO-NOT-RETURN';
const record={id:7,name:'web',active:true,events:['push'],updated_at:'2026-10-14T12:00:00Z',
 config:{url:'https://receiver.example/secret-in-path',content_type:'json',secret,
  insecure_ssl:'0'}};
async function call(w,name,args){
 const dispatch=createDispatch({credentials:w.credentials,fetch:w.gh.fetch,
  now:w.ctx.now,sleep:w.ctx.sleep,gates:[]});
 const r=await dispatch({registry,name,args,connection:w.connection,db:w.db});
 return r.structuredContent??(r.isError?{error:r.content?.[0]?.text}:parse(r));
}
describe('H-2 webhook reads use exact scoped contracts and never return credentials',()=>{
 it('lists bounded repository webhooks and excludes configured secret/url path',async()=>{
  const w=await makeWorld();
  w.gh.when(routes.repoList).reply(200,[record]);
  const r=await call(w,'github_webhook_list',{repo:'hello'});
  expect(r.items).toHaveLength(1);
  expect(r.items[0].config).toMatchObject({url_host:'receiver.example',content_type:'json'});
  expect(JSON.stringify(r)).not.toContain(secret);
  expect(JSON.stringify(r)).not.toContain('secret-in-path');
  expect(w.gh.calls.filter(c=>c.route===routes.repoList)).toHaveLength(1);
  expect(w.gh.invalid).toEqual([]);
 });
 it('verifies exact hook ID when requesting detail',async()=>{
  const w=await makeWorld();
  w.gh.when(routes.repoOne).reply(200,{...record,id:10});
  const r=await call(w,'github_webhook_get',{repo:'hello',hookId:7});
  expect(r.error??JSON.stringify(r)).toMatch(/identity|mismatch/i);
 });
 it('lists delivery health and omits webhook request/response bodies and headers',async()=>{
  const w=await makeWorld();
  w.gh.when(routes.repoOne).reply(200,record);
  w.gh.when(routes.deliveries).reply(200,[{id:9,event:'push',status:'OK',status_code:200,
   request:{payload:{token:secret},headers:{Authorization:secret}},
   response:{status:200,payload:{access_token:secret}}}]);
  const r=await call(w,'github_webhook_list_deliveries',{repo:'hello',hookId:7});
  expect(r.items).toHaveLength(1);
  expect(r.items[0].request).toMatchObject({headers_present:true,payload_present:true});
  expect(JSON.stringify(r)).not.toContain(secret);
  expect(w.gh.invalid).toEqual([]);
 });
 it('reads a single exact delivery without exposing webhook payload',async()=>{
  const w=await makeWorld();
  w.gh.when(routes.repoOne).reply(200,record);
  w.gh.when(routes.delivery).reply(200,{id:9,event:'push',
   request:{headers:{authorization:secret},payload:{value:secret}}});
  const r=await call(w,'github_webhook_list_deliveries',{repo:'hello',hookId:7,deliveryId:9});
  expect(r.item).toMatchObject({id:9,event:'push'});
  expect(JSON.stringify(r)).not.toContain(secret);
  expect(w.gh.invalid).toEqual([]);
 });
 it('refuses cross-scope org and repo mixtures before a provider request',async()=>{
  const w=await makeWorld();
  const r=await call(w,'github_webhook_list',{repo:'hello',scope:'org'});
  expect(r.error??JSON.stringify(r)).toMatch(/organization webhooks/i);
  expect(w.gh.calls).toHaveLength(0);
 });
 it('lists explicitly scoped organization hooks without passing a repository name',async()=>{
  const w=await makeWorld();
  w.gh.when(routes.orgList).reply(200,[record]);
  const r=await call(w,'github_webhook_list',{scope:'org'});
  expect(r.scope).toBe('org');
  expect(r.items).toHaveLength(1);
  expect(w.gh.invalid).toEqual([]);
 });
});
