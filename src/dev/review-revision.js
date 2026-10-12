// Revisions to run-owned review fixtures: exact HEAD and Contents SHA compare before updating.
// A new revision is recorded independently; the prior file object is never overwritten in the ledger.
import {runDevMutationOnce} from './execute.js';
import {isOwnedFixtureBranch} from './fixtures.js';
import {refusal} from '../tools/github-write.js';

const SHA=/^[a-f0-9]{40}$/;
const pathFor=id=>`rtc/${id}/review.md`;
export async function reviseOwnedReviewFixture(ctx,{github,run,branch,stepId,
  expectedCommitSha,newContent}){
  const path=pathFor(run?.runId);
  if(!run?.owner||run.owner!==run.account||!run.connection||!run.repo||
    !isOwnedFixtureBranch(run.runId,branch)||
    !/^[a-z0-9][a-z0-9-]{0,70}$/.test(stepId??'')||
    !SHA.test(expectedCommitSha??'')||typeof newContent!=='string'||
    !newContent.startsWith(`RTC review fixture rtc_run=${run.runId}\n`)||
    Buffer.byteLength(newContent)>16384)
    throw new TypeError('Review revision requires a run-owned branch, recorded commit and marked content.');
  const rows=await ctx.db.listDevObjects({runId:run.runId,account:run.account,
    connection:run.connection,limit:50});
  if(!rows.some(x=>x.object_type==='branch'&&x.object_id===branch&&x.repo===run.repo)||
    !rows.some(x=>x.object_type==='fixture_file'&&x.object_id===path&&
      x.created_sha===expectedCommitSha&&x.repo===run.repo))
    throw new TypeError('Review revision requires a recorded branch and original file commit.');
  const p={owner:run.owner,repo:run.repo};
  const [head,current]=await Promise.all([
    github.request('GET /repos/{owner}/{repo}/git/ref/{ref}',{...p,ref:`heads/${branch}`}).then(x=>x.data),
    github.request('GET /repos/{owner}/{repo}/contents/{path}',{...p,path,ref:branch}).then(x=>x.data)
  ]);
  if(head?.ref!==`refs/heads/${branch}`||head.object?.sha!==expectedCommitSha||
    current?.path!==path||!SHA.test(current.sha??''))
    throw refusal('Review fixture HEAD or Contents blob changed since the recorded original.');
  return runDevMutationOnce(ctx,{...run,stepId,type:'fixture_revision',objectName:path,
    create:async()=>{
      const data=(await github.request('PUT /repos/{owner}/{repo}/contents/{path}',{
        ...p,path,branch,sha:current.sha,message:`test: revise rtc_run=${run.runId} review fixture`,
        content:Buffer.from(newContent).toString('base64')
      })).data;
      if(data?.content?.path!==path||!SHA.test(data?.commit?.sha??'')||
        data.commit.sha===expectedCommitSha)
        throw refusal('GitHub did not confirm a new run-owned review revision commit.');
      return {objectId:`${path}@${data.commit.sha}`,createdSha:data.commit.sha};
    }});
}
export async function verifyOwnedReviewRevision({github,run,branch,createdSha,content}){
  if(!SHA.test(createdSha??'')||!isOwnedFixtureBranch(run.runId,branch))return false;
  const p={owner:run.owner,repo:run.repo};
  const [head,file]=await Promise.all([
    github.request('GET /repos/{owner}/{repo}/git/ref/{ref}',{...p,ref:`heads/${branch}`}).then(x=>x.data),
    github.request('GET /repos/{owner}/{repo}/contents/{path}',{
      ...p,path:pathFor(run.runId),ref:branch}).then(x=>x.data)
  ]);
  return head?.ref===`refs/heads/${branch}`&&head.object?.sha===createdSha&&
    file?.path===pathFor(run.runId)&&typeof file.content==='string'&&
    Buffer.from(file.content.replace(/\s/g,''),'base64').toString('utf8')===content;
}
