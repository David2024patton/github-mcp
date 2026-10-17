import {describe,expect,it} from 'vitest';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';
import * as mod from '../../src/tools/dev-cleanup-write.js';
const RUN='run-label-001',OWNER='example-org',REPO='host-project',BR=`rtc/${RUN}/one`,SHA='c'.repeat(40),LABEL=`rtc-run-${RUN}`;
const def=mod.handlers.github_dev_cleanup;
async function make(){
 const w=await makeWorld();
 await w.db.createDevRun({id:RUN,account:OWNER,connection:'client-1'});
 await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',type:'branch',owner:OWNER,repo:REPO,objectId:BR,createdSha:SHA});
 await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',type:'label',owner:OWNER,repo:REPO,objectId:LABEL});
 w.gh.when('GET /repos/{owner}/{repo}').reply(200,{full_name:`${OWNER}/${REPO}`,default_branch:'main',private:true});
 w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').replySequence([
  ...Array.from({length:6},()=>({status:200,body:{name:BR,protected:false,commit:{sha:SHA}}})),
  {status:404,body:{message:'Not Found'}}
 ]);
 w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200,[]);
 w.gh.when('DELETE /repos/{owner}/{repo}/git/refs/{ref}').reply(204);
 w.gh.when('GET /repos/{owner}/{repo}/labels/{name}').replySequence([
  ...Array.from({length:3},()=>({status:200,body:{name:LABEL,description:`rtc_run=${RUN}`}})),
  {status:404,body:{message:'Not Found'}}
 ]);
 w.gh.when('GET /repos/{owner}/{repo}/issues').reply(200,[]);
 w.gh.when('DELETE /repos/{owner}/{repo}/labels/{name}').reply(204);
 return w;
}
describe('V-2 reserved run-label cleanup',()=>{
 it('removes only a recorded label after its exact owned branch and no foreign label users',async()=>{
   const w=await make();
   const out=parse(await def({runId:RUN,repo:REPO,confirm:true},w.ctx));
   expect(out.status).toBe('applied');
   expect(w.gh.calls.filter(c=>c.method==='DELETE').map(c=>c.route)).toEqual([
    'DELETE /repos/{owner}/{repo}/git/refs/{ref}','DELETE /repos/{owner}/{repo}/labels/{name}'
   ]);
   expect(w.gh.invalid).toEqual([]);
 });
 it('refuses to remove a run-label used by an unrelated issue or PR',async()=>{
   const w=await make();
   w.gh.when('GET /repos/{owner}/{repo}/issues').reply(200,[{number:71}]);
   const out=parse(await def({runId:RUN,repo:REPO,confirm:true},w.ctx));
   expect(out.done).toBe(false);
   expect(w.gh.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
 });
 it('refuses a label whose description was repurposed after recording',async()=>{
   const w=await make();
   w.gh.when('GET /repos/{owner}/{repo}/labels/{name}').reply(200,{name:LABEL,description:'ordinary team label'});
   const out=parse(await def({runId:RUN,repo:REPO,confirm:true},w.ctx));
   expect(out.done).toBe(false);
   expect(w.gh.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
 });
});


describe('V-2 exact PR label readback against the pinned GitHub REST contract',()=>{
 async function recordedPr(){
  const w=await make();
  await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
   type:'pr',owner:OWNER,repo:REPO,objectId:'12',createdSha:SHA});
  await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
   type:'pr_label',owner:OWNER,repo:REPO,objectId:'12:'+LABEL});
  const pr={id:87,number:12,merged:false,merged_at:null,state:'open',draft:true,
   body:'<!-- rtc_run='+RUN+' -->',
   head:{ref:BR,sha:SHA,repo:{full_name:OWNER+'/'+REPO}},
   base:{ref:'main',repo:{full_name:OWNER+'/'+REPO}}};
  w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200,pr);
  w.gh.when('GET /repos/{owner}/{repo}/issues').reply(200,[{number:12}]);
  return w;
 }
 const route='GET /repos/{owner}/{repo}/issues/{issue_number}/labels';
 it('previews an exact present association through the actual GitHub label-list endpoint',async()=>{
  const w=await recordedPr();
  w.gh.when(route).reply(200,[{name:LABEL,id:49,description:'rtc_run='+RUN}]);
  const out=parse(await def({runId:RUN,repo:REPO,dryRun:true},w.ctx));
  expect(out.status).toBe('preview');
  expect(w.gh.calls.some(c=>c.route===route)).toBe(true);
  expect(w.gh.calls.some(c=>c.route==='GET /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}')).toBe(false);
  expect(w.gh.calls.filter(c=>['DELETE','PATCH','POST'].includes(c.method))).toHaveLength(0);
  expect(w.gh.invalid).toEqual([]);
 });
 it('refuses a vanished recorded label instead of deleting a branch or its PR',async()=>{
  const w=await recordedPr();w.gh.when(route).reply(200,[]);
  const out=parse(await def({runId:RUN,repo:REPO,confirm:true},w.ctx));
  expect(out.done).toBe(false);
  expect(w.gh.calls.some(c=>['DELETE','PATCH','POST'].includes(c.method))).toBe(false);
  expect(w.gh.invalid).toEqual([]);
 });
 it('fails closed on unreadable, malformed, duplicated and capped label inventory',async()=>{
  const huge=Array.from({length:100},(_,i)=>({name:i===0?LABEL:'label-'+i}));
  for(const variation of [
   {status:403,body:{message:'Forbidden'}},
   {status:404,body:{message:'Not Found'}},
   {status:200,body:{labels:[{name:LABEL}]}},
   {status:200,body:[{name:LABEL},{name:LABEL}]},
   {status:200,body:[{name:LABEL},{id:3}]},
   {status:200,body:huge,headers:{link:'<https://api.github.com/repos/example-org/host-project/issues/12/labels?page=2>; rel="next"'}}
  ]){
   const w=await recordedPr();
   w.gh.when(route).reply(variation.status,variation.body,variation.headers);
   const out=parse(await def({runId:RUN,repo:REPO,dryRun:true},w.ctx));
   expect(out.done,JSON.stringify(variation).slice(0,90)).toBe(false);
   expect(w.gh.calls.some(c=>['DELETE','PATCH','POST'].includes(c.method))).toBe(false);
  }
 });
});
