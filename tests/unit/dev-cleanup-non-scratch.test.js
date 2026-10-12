import {describe,expect,it} from 'vitest';
import {makeWorld,parse,runWriteContract} from '../../test/helpers/write-contract.js';
import * as mod from '../../src/tools/dev-cleanup-write.js';
const RUN='run-branch-204',BR=`rtc/${RUN}/change`,REPO='host-project',OWNER='example-org',SHA='a'.repeat(40);
const host={full_name:`${OWNER}/${REPO}`,private:true,default_branch:'main'};
const branch={name:BR,protected:false,commit:{sha:SHA}};
const def={tool:mod.tools[0],handler:mod.handlers.github_dev_cleanup};
async function prepare(w) {
 await w.db.createDevRun({id:RUN,account:OWNER,connection:'client-1'});
 await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
   type:'branch',owner:OWNER,repo:REPO,objectId:BR,createdSha:SHA});
}
function arrange(gh,kind) {
 gh.when('GET /repos/{owner}/{repo}').reply(200,host);
 gh.when('GET /repos/{owner}/{repo}/branches/{branch}').replySequence([
   {status:200,body:branch},{status:200,body:branch},{status:200,body:branch},
   {status:200,body:branch},{status:200,body:branch},
   kind==='mismatch'?{status:200,body:branch}:{status:404,body:{message:'Not Found'}},
   kind==='mismatch'?{status:200,body:branch}:{status:404,body:{message:'Not Found'}}
 ]);
 gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200,[]);
 gh.when('DELETE /repos/{owner}/{repo}/git/refs/{ref}').reply(204);
}
runWriteContract({label:'github_dev_cleanup standalone exact branch',definition:def,
  args:{runId:RUN,repo:REPO},needsConfirm:true,previewOnly:true,expectedWrites:1,prepare,arrange});
describe('non-scratch safety hardening',()=>{
 it('refuses a second cleanup executor before any host mutation',async()=>{
  const w=await makeWorld();await prepare(w);arrange(w.gh,'ok');
  await w.db.claimDevCleanupExecution({runId:RUN,account:OWNER,connection:'client-1',
   executorId:'11111111-1111-4111-8111-111111111111'});
  expect(parse(await def.handler({runId:RUN,repo:REPO,confirm:true,requestKey:'different-request'},w.ctx)).done).toBe(false);
  expect(w.gh.calls.filter(c=>['PATCH','POST','DELETE'].includes(c.method))).toHaveLength(0);
 });
 it('stops after PR closure if any exact draft identity changes on readback',async()=>{
  for(const change of [
   {number:13},{id:99},{draft:false},{body:`Changed <!-- rtc_run=${RUN} -->`},
   {merged_at:'2026-10-12T00:00:00Z'},
   {head:{ref:BR,sha:'b'.repeat(40),repo:{full_name:`${OWNER}/${REPO}`}}},
   {base:{ref:'other',repo:{full_name:`${OWNER}/${REPO}`}}}
  ]){
   const w=await makeWorld();await prepare(w);arrange(w.gh,'ok');
   await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
    type:'pr',owner:OWNER,repo:REPO,objectId:'12',createdSha:SHA});
   const pr={id:98,number:12,merged:false,merged_at:null,state:'open',draft:true,
    body:`<!-- rtc_run=${RUN} -->`,head:{ref:BR,sha:SHA,repo:{full_name:`${OWNER}/${REPO}`}},
    base:{ref:'main',repo:{full_name:`${OWNER}/${REPO}`}}};
   w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').replySequence([
    ...Array.from({length:3},()=>({status:200,body:pr})),
    {status:200,body:{...pr,state:'closed',...change}}
   ]);
   w.gh.when('PATCH /repos/{owner}/{repo}/pulls/{pull_number}').reply(200,{...pr,state:'closed'});
   const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
   expect(out.done).toBe(false);
   expect(w.gh.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
   const objects=await w.db.listDevObjects({runId:RUN,account:OWNER,connection:'client-1'});
   expect(objects.every(o=>o.cleaned===false)).toBe(true);
   expect(w.gh.invalid).toEqual([]);
  }
 });
 it('does not delete the host repository and refuses foreign run refs',async()=>{
  const w=await makeWorld();await prepare(w);arrange(w.gh,'ok');
  const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
  expect(out.status).toBe('applied');
  expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(false);
  expect(w.gh.calls.filter(c=>c.method==='DELETE').map(c=>c.params.ref)).toEqual([`heads/${BR}`]);
 });
 it('does not touch a default or protected branch, even if journaled',async()=>{
  const w=await makeWorld();await prepare(w);arrange(w.gh,'ok');
  w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200,{...branch,protected:true});
  expect(parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx)).done).toBe(false);
  expect(w.gh.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
 });
 it('refuses a changed test branch SHA and never guesses ownership',async()=>{
  const w=await makeWorld();await prepare(w);arrange(w.gh,'ok');
  w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200,{...branch,commit:{sha:'b'.repeat(40)}});
  const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
  expect(out.done).toBe(false);
  expect(w.gh.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
 });
 it('closes only a recorded draft PR on the exact branch before deleting the branch',async()=>{
  const w=await makeWorld();await prepare(w);arrange(w.gh,'ok');
  await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
    type:'pr',owner:OWNER,repo:REPO,objectId:'12',createdSha:SHA});
  const pr={number:12,merged:false,state:'open',draft:true,body:`<!-- rtc_run=${RUN} -->`,
    head:{ref:BR,sha:SHA,repo:{full_name:`${OWNER}/${REPO}`}},
    base:{ref:'main',repo:{full_name:`${OWNER}/${REPO}`}}};
  w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').replySequence([
    {status:200,body:pr},{status:200,body:pr},{status:200,body:pr},
    {status:200,body:{...pr,state:'closed'}},
  ]);
  w.gh.when('PATCH /repos/{owner}/{repo}/pulls/{pull_number}').reply(200,{...pr,state:'closed'});
  const result=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
  expect(result.status).toBe('applied');
  expect(w.gh.calls.filter(c=>['PATCH','DELETE'].includes(c.method)).map(c=>c.route))
    .toEqual(['PATCH /repos/{owner}/{repo}/pulls/{pull_number}','DELETE /repos/{owner}/{repo}/git/refs/{ref}']);
 });
 it('refuses merged, retargeted and changed closed draft PRs before modifying a host',async()=>{
  for(const kind of ['merged_at','foreign_base','wrong_number','closed_not_draft','wrong_sha']){
   const w=await makeWorld();await prepare(w);arrange(w.gh,'ok');
   await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
     type:'pr',owner:OWNER,repo:REPO,objectId:'12',createdSha:SHA});
   const pr={number:kind==='wrong_number'?13:12,merged_at:kind==='merged_at'?'2026-10-12T00:00:00Z':null,
     state:'closed',draft:kind!=='closed_not_draft',body:`<!-- rtc_run=${RUN} -->`,
     head:{ref:BR,sha:kind==='wrong_sha'?'b'.repeat(40):SHA,repo:{full_name:`${OWNER}/${REPO}`}},
     base:{ref:'main',repo:{full_name:kind==='foreign_base'?'another/repository':`${OWNER}/${REPO}`}}};
   w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200,pr);
   const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
   expect(out.done).toBe(false);
   expect(w.gh.calls.filter(c=>['PATCH','DELETE'].includes(c.method))).toHaveLength(0);
  }
 });
 it('refuses deleting a test branch without a recorded immutable tip',async()=>{
  const w=await makeWorld();await w.db.createDevRun({id:RUN,account:OWNER,connection:'client-1'});
  await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
    type:'branch',owner:OWNER,repo:REPO,objectId:BR});
  arrange(w.gh,'ok');
  const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
  expect(out.done).toBe(false);
  expect(w.gh.calls.some(c=>c.method==='DELETE')).toBe(false);
 });
 it('refuses foreign PR footer prefix even when the branch SHA is recorded',async()=>{
  const w=await makeWorld();await prepare(w);arrange(w.gh,'ok');
  await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
    type:'pr',owner:OWNER,repo:REPO,objectId:'12',createdSha:SHA});
  w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200,{
    number:12,merged:false,state:'open',draft:true,body:'<!-- rtc_run='+RUN+'-other -->',
    head:{ref:BR,sha:SHA,repo:{full_name:OWNER+'/'+REPO}}
  });
  const result=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
  expect(result.done).toBe(false);
  expect(w.gh.calls.filter(c=>['PATCH','DELETE'].includes(c.method))).toHaveLength(0);
 });
 it('refuses a converted ready-for-review PR instead of closing someone else\'s active work',async()=>{
  const w=await makeWorld();await prepare(w);arrange(w.gh,'ok');
  await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
    type:'pr',owner:OWNER,repo:REPO,objectId:'12',createdSha:SHA});
  w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200,{
    number:12,state:'open',draft:false,merged:false,body:`<!-- rtc_run=${RUN} -->`,
    head:{ref:BR,sha:SHA,repo:{full_name:`${OWNER}/${REPO}`}}
  });
  const output=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
  expect(output.done).toBe(false);
  expect(w.gh.calls.filter(c=>['PATCH','DELETE'].includes(c.method))).toHaveLength(0);
 });

});
