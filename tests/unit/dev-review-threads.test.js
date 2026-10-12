import {describe,it,expect} from 'vitest';
import {makeWorld} from '../../test/helpers/write-contract.js';
import {octo} from '../../src/tools/github-write.js';
import {recordExactReviewThread,verifyExactReviewThread,listExactReviewThreads} from '../../src/dev/review-threads.js';

const run={runId:'run-thread-101',owner:'example-org',account:'example-org',repo:'scratch',
 connection:'client-1',scenarios:['pr-with-threads']},prNumber=30,commentId=540;
async function fixture(){
 const w=await makeWorld({scratchAccount:true}),github=await octo(w.ctx,run.owner);
 await w.db.createDevRun({id:run.runId,account:run.account,connection:run.connection,scenarios:run.scenarios});
 for(const [type,id] of [['pr',String(prNumber)],['review_comment',String(commentId)]])
   await w.db.recordDevObject({runId:run.runId,account:run.account,
     connection:run.connection,type,owner:run.owner,repo:run.repo,objectId:id});
 return {w,github};
}
function arrange(gh,nodes,totalCount=nodes.length){
 gh.when('POST /graphql').reply(200,{data:{repository:{pullRequest:{
   reviewThreads:{totalCount,nodes}
 }}}});
}
const a={id:'PRRT_fake_101',isOutdated:false,path:`rtc/${run.runId}/review.md`,
 comments:{totalCount:1,nodes:[{databaseId:commentId}]}};
describe('V-1 exact GraphQL review thread identity',()=>{
 it('records real thread node IDs, not numeric review-comment IDs',async()=>{
   const {w,github}=await fixture();arrange(w.gh,[a]);
   const out=await recordExactReviewThread(w.ctx,{github,run,stepId:'thread-1',prNumber,commentId});
   expect(out).toMatchObject({objectId:'PRRT_fake_101',outdated:false});
   expect(await verifyExactReviewThread({github,run,prNumber,commentId,
     threadId:out.objectId,outdated:false})).toBe(true);
   const rows=await w.db.listDevObjects({runId:run.runId,account:run.account,connection:run.connection});
   expect(rows.some(x=>x.object_type==='review_thread'&&x.object_id==='PRRT_fake_101')).toBe(true);
   expect(w.gh.invalid).toEqual([]);
 });
 it('refuses incomplete pages, foreign comments and ambiguous identities',async()=>{
   const {w,github}=await fixture();arrange(w.gh,[a],101);
   await expect(listExactReviewThreads({github,run,prNumber})).rejects.toThrow(/incomplete/);
   arrange(w.gh,[a,{...a,id:'PRRT_other'}]);
   await expect(recordExactReviewThread(w.ctx,{github,run,stepId:'thread-1',
     prNumber,commentId})).rejects.toThrow(/unique/);
   expect((await w.db.listDevObjects({runId:run.runId,account:run.account,
     connection:run.connection})).filter(x=>x.object_type==='review_thread')).toEqual([]);
 });
 it('detects outdated-state transitions without changing the identity',async()=>{
   const {w,github}=await fixture();
   arrange(w.gh,[{...a,isOutdated:true}]);
   expect(await verifyExactReviewThread({github,run,prNumber,commentId,
     threadId:a.id,outdated:true})).toBe(true);
   expect(await verifyExactReviewThread({github,run,prNumber,commentId,
     threadId:a.id,outdated:false})).toBe(false);
 });
});
