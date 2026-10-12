// Exact run-owned GraphQL review-thread identity. Comments are not threads.
// Bound all reads: GitHub's first 100 must cover all threads/comments, else fail closed.
import {graphql} from '../github/client.js';
import {runDevMutationOnce} from './execute.js';
import {refusal} from '../tools/github-write.js';

const QUERY=`query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){pullRequest(number:$number){
    reviewThreads(first:100){totalCount nodes{
      id isResolved isOutdated path
      comments(first:100){totalCount nodes{databaseId}}
    }}
  }}
}`;
export async function listExactReviewThreads({github,run,prNumber}){
  if(!Number.isSafeInteger(prNumber)||prNumber<1||!run?.owner||!run?.repo)
    throw new TypeError('An exact PR and repository are required.');
  const value=await graphql(github,QUERY,{owner:run.owner,repo:run.repo,number:prNumber});
  const threads=value?.repository?.pullRequest?.reviewThreads;
  if(!Array.isArray(threads?.nodes)||!Number.isSafeInteger(threads.totalCount)||
    threads.totalCount!==threads.nodes.length||threads.totalCount>100)
    throw refusal('GitHub returned incomplete review-thread pagination.');
  for(const node of threads.nodes){
    if(!node?.id||!Array.isArray(node?.comments?.nodes)||
      node.comments.totalCount!==node.comments.nodes.length||node.comments.totalCount>100)
      throw refusal('GitHub returned incomplete review-comment pagination.');
  }
  return threads.nodes;
}
export async function recordExactReviewThread(ctx,{github,run,stepId,prNumber,commentId}){
  if(!Number.isSafeInteger(commentId)||commentId<=0||
    !/^[a-z0-9][a-z0-9-]{0,70}$/.test(stepId??''))
    throw new TypeError('Exact review comment ID and stable step are required.');
  const objects=await ctx.db.listDevObjects({runId:run.runId,account:run.account,
    connection:run.connection,limit:50});
  if(!objects.some(x=>x.object_type==='pr'&&x.object_id===String(prNumber)&&x.repo===run.repo)||
    !objects.some(x=>x.object_type==='review_comment'&&x.object_id===String(commentId)&&x.repo===run.repo))
    throw new TypeError('Review thread requires a run-owned PR and exact recorded review comment.');
  const nodes=await listExactReviewThreads({github,run,prNumber});
  const matches=nodes.filter(node=>node.comments.nodes.some(c=>c.databaseId===commentId));
  if(matches.length!==1||typeof matches[0].id!=='string'||!matches[0].id.length)
    throw refusal('GitHub did not identify a unique thread for the recorded review comment.');
  const thread=matches[0];
  const saved=await runDevMutationOnce(ctx,{...run,stepId,type:'review_thread',
    objectName:`${prNumber}:${commentId}`,create:async()=>({objectId:thread.id})});
  return {...saved,outdated:thread.isOutdated===true};
}
export async function verifyExactReviewThread({github,run,prNumber,commentId,threadId,outdated}){
  const nodes=await listExactReviewThreads({github,run,prNumber});
  return nodes.some(n=>n.id===threadId&&n.isOutdated===outdated&&
    n.comments.nodes.some(c=>c.databaseId===commentId));
}
