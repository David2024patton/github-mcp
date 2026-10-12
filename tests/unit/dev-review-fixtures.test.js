import {describe,it,expect} from 'vitest';
import {makeWorld} from '../../test/helpers/write-contract.js';
import {octo} from '../../src/tools/github-write.js';
import {createOwnedReviewComment,verifyOwnedReviewComment} from '../../src/dev/review-fixtures.js';

const id='run-review-101',owner='example-org',repo='scratch',prNumber=31,sha='c'.repeat(40),path=`rtc/${id}/review.md`;
const run={runId:id,account:owner,connection:'client-1',owner,repo,scenarios:['pr-with-threads']};
const body=`rtc_run=${id} inspect this line`;
async function prepared(){
  const w=await makeWorld({scratchAccount:true});const github=await octo(w.ctx,owner);
  await w.db.createDevRun({id,account:owner,connection:run.connection,scenarios:run.scenarios});
  await w.db.recordDevObject({runId:id,account:owner,connection:run.connection,
    type:'pr',owner,repo,objectId:String(prNumber)});
  await w.db.recordDevObject({runId:id,account:owner,connection:run.connection,
    type:'fixture_file',owner,repo,objectId:path,createdSha:sha});
  w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200,{
    number:prNumber,draft:true,state:'open',head:{sha},body:`<!-- rtc_run=${id} -->`});
  return {w,github};
}
describe('run-owned inline review comment',()=>{
  it('records exact GitHub comment ID and independently verifies its original line and SHA',async()=>{
    const {w,github}=await prepared(),args={github,run,stepId:'review-comment-1',prNumber,
      commitSha:sha,line:2,body};
    const fixture={id:440,body,path,commit_id:sha,line:2,original_line:2};
    w.gh.when('POST /repos/{owner}/{repo}/pulls/{pull_number}/comments').reply(201,fixture);
    w.gh.when('GET /repos/{owner}/{repo}/pulls/comments/{comment_id}').reply(200,fixture);
    const created=await createOwnedReviewComment(w.ctx,args);
    expect(created).toMatchObject({objectId:'440',createdSha:sha});
    expect(await verifyOwnedReviewComment({github,run,prNumber,commentId:440,
      commitSha:sha,line:2,body})).toBe(true);
    const same=await createOwnedReviewComment(w.ctx,args);
    expect(same.replayed).toBe(true);
    expect(w.gh.calls.filter(x=>x.route==='POST /repos/{owner}/{repo}/pulls/{pull_number}/comments')).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
  it('rejects foreign commit, unrecorded PR and stale head before any comment mutation',async()=>{
    const {w,github}=await prepared();
    const a={github,run,stepId:'review-comment-1',prNumber,commitSha:'d'.repeat(40),line:2,body};
    await expect(createOwnedReviewComment(w.ctx,a)).rejects.toThrow(/recorded/);
    await expect(createOwnedReviewComment(w.ctx,{...a,commitSha:sha,prNumber:99})).rejects.toThrow(/recorded/);
    w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200,{
      number:prNumber,draft:true,state:'open',head:{sha:'d'.repeat(40)},
      body:`<!-- rtc_run=${id} -->`});
    await expect(createOwnedReviewComment(w.ctx,{...a,commitSha:sha})).rejects.toThrow(/head/);
    expect(w.gh.calls.filter(x=>x.method==='POST')).toEqual([]);
  });
  it('leaves unconfirmed GitHub response uncertain, without blind duplicate requests',async()=>{
    const {w,github}=await prepared(),a={github,run,stepId:'review-comment-1',prNumber,
      commitSha:sha,line:2,body};
    w.gh.when('POST /repos/{owner}/{repo}/pulls/{pull_number}/comments').reply(201,{
      id:440,body,path,commit_id:sha,line:99});
    await expect(createOwnedReviewComment(w.ctx,a)).rejects.toThrow(/exact review comment/);
    await expect(createOwnedReviewComment(w.ctx,a)).rejects.toThrow(/already claimed or uncertain/);
    expect((await w.db.getDevIntent({runId:id,account:owner,connection:run.connection,stepId:a.stepId})).status).toBe('uncertain');
  });
});
