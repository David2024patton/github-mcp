// V-1 real three-thread fixture: all objects are exact, durable, private scratch only.
// Two threads remain current; replacing only the annotated last line makes one outdated.
import {createOwnedFixtureBranch,commitOwnedFixtureFile} from './fixtures.js';
import {createOwnedDraftPr,createOwnedRunLabel,labelOwnedDraftPr} from './pull-fixtures.js';
import {createOwnedReviewComment} from './review-fixtures.js';
import {recordExactReviewThread,listExactReviewThreads} from './review-threads.js';
import {reviseOwnedReviewFixture} from './review-revision.js';
import {refusal} from '../tools/github-write.js';

const SHA=/^[a-f0-9]{40}$/;
export const reviewBranch=id=>`rtc/${id}/review`;
export const reviewPath=id=>`rtc/${id}/review.md`;
export const initialReview=id=>`RTC review fixture rtc_run=${id}\nkeep alpha\nkeep beta\nobsolete line\n`;
export const updatedReview=id=>`RTC review fixture rtc_run=${id}\nkeep alpha\nkeep beta\nreplacement line\n`;
export const commentText=(id,i)=>`rtc_run=${id} review discussion ${i}`;
export async function seedReviewScenario(ctx,{github,run}){
 const p={owner:run.owner,repo:run.repo},id=run.runId;
 const repo=(await github.request('GET /repos/{owner}/{repo}',p)).data;
 const base=repo?.default_branch;
 if(repo?.private!==true||!String(repo.description??'').includes(`rtc_run=${id}`)||
   !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(base??'')||base.includes('..'))
   throw refusal('A private run-marked scratch repository is required.');
 const head=(await github.request('GET /repos/{owner}/{repo}/git/ref/{ref}',{
   ...p,ref:`heads/${base}`})).data;
 if(head?.ref!==`refs/heads/${base}`||!SHA.test(head.object?.sha??''))
   throw refusal('GitHub did not confirm the scratch base commit.');
 const label=await createOwnedRunLabel(ctx,{github,run});
 const branch=await createOwnedFixtureBranch(ctx,{github,run,stepId:'seed-review-branch',
   name:reviewBranch(id),sha:head.object.sha});
 const file=await commitOwnedFixtureFile(ctx,{github,run,stepId:'seed-review-file',
   path:reviewPath(id),branch:reviewBranch(id),content:initialReview(id)});
 const pr=await createOwnedDraftPr(ctx,{github,run,stepId:'seed-review-pr',
   head:reviewBranch(id),base,defaultBranch:base,expectedHeadSha:file.createdSha,
   title:`RTC ${id} thread fixture`});
 const association=await labelOwnedDraftPr(ctx,{github,run,stepId:'seed-review-label',
   prNumber:Number(pr.objectId)});
 const objects=[label,branch,file,pr,association];
 for(let i=1;i<=3;i++){
   const c=await createOwnedReviewComment(ctx,{github,run,stepId:`seed-review-comment-${i}`,
     prNumber:Number(pr.objectId),commitSha:file.createdSha,
     line:i+1,body:commentText(id,i)});
   const thread=await recordExactReviewThread(ctx,{github,run,stepId:`seed-review-thread-${i}`,
     prNumber:Number(pr.objectId),commentId:Number(c.objectId)});
   objects.push(c,thread);
 }
 const revision=await reviseOwnedReviewFixture(ctx,{github,run,branch:reviewBranch(id),
   stepId:'seed-review-revision',expectedCommitSha:file.createdSha,newContent:updatedReview(id)});
 return [...objects,revision];
}
export async function readReviewScenario({github,id,owner,repo,response}){
 const p={owner,repo},o=response?.data?.objects;
 if(o?.length!==13)throw refusal('Incomplete recorded review scenario.');
 const number=Number(o[4].objectId);
 const [repository,label,branch,file,pr,labels,comments,threads]=await Promise.all([
  github.request('GET /repos/{owner}/{repo}',p).then(x=>x.data),
  github.request('GET /repos/{owner}/{repo}/labels/{name}',{...p,name:'rtc-run'}).then(x=>x.data),
  github.request('GET /repos/{owner}/{repo}/git/ref/{ref}',{
    ...p,ref:`heads/${reviewBranch(id)}`}).then(x=>x.data),
  github.request('GET /repos/{owner}/{repo}/contents/{path}',{
    ...p,path:reviewPath(id),ref:reviewBranch(id)}).then(x=>x.data),
  github.request('GET /repos/{owner}/{repo}/pulls/{pull_number}',{
    ...p,pull_number:number}).then(x=>x.data),
  github.request('GET /repos/{owner}/{repo}/issues/{issue_number}/labels',{
    ...p,issue_number:number}).then(x=>x.data),
  Promise.all([1,2,3].map(i=>github.request(
    'GET /repos/{owner}/{repo}/pulls/comments/{comment_id}',{
      ...p,comment_id:Number(o[6+(i-1)*2].objectId)
    }).then(x=>x.data))),
  listExactReviewThreads({github,run:{owner,repo},prNumber:number})
 ]);
 return {repository,label,branch,file,pr,labels,comments,threads};
}
export function verifyReviewScenario({id,after,response}){
 const o=response?.data?.objects;
 if(o?.length!==13||after?.label?.name!=='rtc-run'||
    after.label.description!==`rtc_run=${id}`||!after.repository?.default_branch)return false;
 const number=Number(o[4]?.objectId),first=o[3]?.createdSha,rev=o[12]?.createdSha;
 if(!Number.isSafeInteger(number)||number<1||!SHA.test(first??'')||!SHA.test(rev??'')||
    o[1]?.objectId!=='rtc-run'||o[2]?.objectId!==reviewBranch(id)||
    o[3]?.objectId!==reviewPath(id)||o[5]?.objectId!==`${number}:rtc-run`||
    o[12]?.objectId!==`${reviewPath(id)}@${rev}`||
    after.branch?.ref!==`refs/heads/${reviewBranch(id)}`||
    after.branch.object?.sha!==rev||
    after.pr?.number!==number||after.pr.draft!==true||after.pr.state!=='open'||
    after.pr.head?.ref!==reviewBranch(id)||after.pr.head?.sha!==rev||
    after.pr.base?.ref!==after.repository.default_branch||
    !String(after.pr.body??'').includes(`rtc_run=${id}`)||
    !after.labels?.some(x=>x.name==='rtc-run')||
    after.file?.path!==reviewPath(id)||typeof after.file.content!=='string'||
    Buffer.from(after.file.content.replace(/\s/g,''),'base64').toString('utf8')!==updatedReview(id)||
    after.comments?.length!==3||!Array.isArray(after.threads))return false;
 for(let i=1;i<=3;i++){
   const c=o[6+(i-1)*2],t=o[7+(i-1)*2],actual=after.comments[i-1];
   const matched=after.threads.filter(x=>x.id===t?.objectId&&
     x.comments?.nodes?.some(y=>y.databaseId===Number(c?.objectId)));
   if(!Number.isSafeInteger(Number(c?.objectId))||actual?.id!==Number(c.objectId)||
     actual.body!==commentText(id,i)||actual.path!==reviewPath(id)||
     actual.commit_id!==first||actual.original_line!==i+1||
     matched.length!==1||matched[0].isOutdated!==(i===3))return false;
 }
 return true;
}
