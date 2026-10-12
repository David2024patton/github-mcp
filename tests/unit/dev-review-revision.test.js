import {describe,it,expect} from 'vitest';
import {makeWorld} from '../../test/helpers/write-contract.js';
import {octo} from '../../src/tools/github-write.js';
import {reviseOwnedReviewFixture,verifyOwnedReviewRevision} from '../../src/dev/review-revision.js';
const run={runId:'run-revision-101',owner:'example-org',repo:'scratch',
  account:'example-org',connection:'client-1',scenarios:['pr-with-threads']};
const branch=`rtc/${run.runId}/review`,path=`rtc/${run.runId}/review.md`,before='a'.repeat(40),after='b'.repeat(40),blob='c'.repeat(40);
const content=`RTC review fixture rtc_run=${run.runId}\nalpha\nbeta\nreplacement\n`;
async function world(){
 const w=await makeWorld({scratchAccount:true}),github=await octo(w.ctx,run.owner);
 await w.db.createDevRun({id:run.runId,account:run.account,connection:run.connection,
   scenarios:run.scenarios});
 for(const [type,id,sha] of [['branch',branch,before],['fixture_file',path,before]])
   await w.db.recordDevObject({runId:run.runId,account:run.account,
     connection:run.connection,type,owner:run.owner,repo:run.repo,objectId:id,createdSha:sha});
 w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').replySequence([
   {status:200,body:{ref:`refs/heads/${branch}`,object:{sha:before}}},
   {status:200,body:{ref:`refs/heads/${branch}`,object:{sha:after}}}
 ]);
 w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').replySequence([
   {status:200,body:{path,sha:blob}},
   {status:200,body:{path,content:Buffer.from(content).toString('base64')}}
 ]);
 w.gh.when('PUT /repos/{owner}/{repo}/contents/{path}').reply(200,{
   content:{path},commit:{sha:after}
 });
 return {w,github};
}
const args={run,branch,stepId:'revise-review',expectedCommitSha:before,newContent:content};
describe('V-1 exact recorded review diff revisions',()=>{
 it('updates only the owned file via Contents CAS and journals the new commit',async()=>{
  const {w,github}=await world();
  const saved=await reviseOwnedReviewFixture(w.ctx,{github,...args});
  expect(saved).toMatchObject({objectId:`${path}@${after}`,createdSha:after});
  expect(await verifyOwnedReviewRevision({github,run,branch,createdSha:after,content})).toBe(true);
  const put=w.gh.calls.find(x=>x.route==='PUT /repos/{owner}/{repo}/contents/{path}');
  expect(put.body).toMatchObject({sha:blob,branch});
  expect(w.gh.invalid).toEqual([]);
 });
 it('rejects foreign branches and stale ref before mutation',async()=>{
  const {w,github}=await world();
  await expect(reviseOwnedReviewFixture(w.ctx,{github,...args,branch:'main'})).rejects.toThrow();
  await expect(reviseOwnedReviewFixture(w.ctx,{github,...args,expectedCommitSha:'d'.repeat(40)})).rejects.toThrow(/recorded/);
  w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200,{
    ref:`refs/heads/${branch}`,object:{sha:'e'.repeat(40)}
  });
  await expect(reviseOwnedReviewFixture(w.ctx,{github,...args})).rejects.toThrow(/changed/);
  expect(w.gh.calls.filter(x=>x.method==='PUT')).toHaveLength(0);
 });
 it('blocks replay after unconfirmed write result',async()=>{
  const {w,github}=await world();
  w.gh.when('PUT /repos/{owner}/{repo}/contents/{path}').reply(200,{
    content:{path},commit:{sha:before}
  });
  await expect(reviseOwnedReviewFixture(w.ctx,{github,...args})).rejects.toThrow(/new run-owned/);
  await expect(reviseOwnedReviewFixture(w.ctx,{github,...args})).rejects.toThrow(/already claimed or uncertain/);
  expect(w.gh.calls.filter(x=>x.method==='PUT')).toHaveLength(1);
 });
});
