// V-1 run-owned inline review comments. Must be called behind the scratch/preview gate.
// A review-comment ID is NOT a thread ID; thread resolution is a separate GraphQL read.
import {runDevMutationOnce} from './execute.js';
import {RUN_ID} from './ledger.js';
import {refusal} from '../tools/github-write.js';
import {matchesRunFooter} from './run-marker.js';

const SHA=/^[a-f0-9]{40}$/;
const pathFor=id=>`rtc/${id}/review.md`;
function check(run,stepId,prNumber,sha,line,body){
  if(!RUN_ID.test(run?.runId??'')||!run.owner||!run.repo||run.account!==run.owner||
    !run.connection||!/^[a-z0-9][a-z0-9-]{0,70}$/.test(stepId??'')||
    !Number.isSafeInteger(prNumber)||prNumber<=0||!SHA.test(sha??'')||
    !Number.isSafeInteger(line)||line<1||line>100||
    typeof body!=='string'||!body.startsWith(`rtc_run=${run.runId} `)||
    body.length>500)throw new TypeError('Run-owned inline comment requires exact PR, SHA, diff line and marker.');
}
export async function createOwnedReviewComment(ctx,{github,run,stepId,prNumber,commitSha,line,body}){
  check(run,stepId,prNumber,commitSha,line,body);
  const rows=await ctx.db.listDevObjects({runId:run.runId,account:run.account,
    connection:run.connection,limit:50});
  if(!rows.some(x=>x.object_type==='pr'&&x.repo===run.repo&&x.object_id===String(prNumber))||
    !rows.some(x=>x.object_type==='fixture_file'&&x.repo===run.repo&&x.created_sha===commitSha))
    throw new TypeError('Review comments require a recorded run-owned PR and fixture commit.');
  const p={owner:run.owner,repo:run.repo,pull_number:prNumber};
  const pr=(await github.request('GET /repos/{owner}/{repo}/pulls/{pull_number}',p)).data;
  if(pr?.number!==prNumber||pr.draft!==true||pr.state!=='open'||
    pr.head?.sha!==commitSha||!matchesRunFooter(pr.body,run.runId))
    throw refusal('Draft PR head no longer matches the run-owned fixture commit.');
  return runDevMutationOnce(ctx,{...run,stepId,type:'review_comment',
    objectName:`${prNumber}:${line}`,create:async()=>{
      const c=(await github.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/comments',{
        ...p,commit_id:commitSha,path:pathFor(run.runId),line,side:'RIGHT',body
      })).data;
      if(!Number.isSafeInteger(c?.id)||c.id<=0||c.body!==body||
        c.path!==pathFor(run.runId)||c.commit_id!==commitSha||c.line!==line)
        throw refusal('GitHub did not confirm the exact review comment ID, position and commit.');
      return {objectId:String(c.id),createdSha:commitSha};
    }});
}
export async function verifyOwnedReviewComment({github,run,prNumber,commentId,commitSha,line,body}){
  check(run,'verify-comment',prNumber,commitSha,line,body);
  if(!Number.isSafeInteger(commentId)||commentId<=0)return false;
  const c=(await github.request('GET /repos/{owner}/{repo}/pulls/comments/{comment_id}',{
    owner:run.owner,repo:run.repo,comment_id:commentId})).data;
  return c?.id===commentId&&c.body===body&&c.path===pathFor(run.runId)&&
    c.commit_id===commitSha&&c.original_line===line;
}
