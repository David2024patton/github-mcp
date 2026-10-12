// V-1 shared scratch-fixture draft PR and label creation, behind the caller's scratch/preview gate.
// Every created PR and label association receives an exact intent and recorded object ID.
import { RUN_ID } from './ledger.js';
import { runDevMutationOnce } from './execute.js';
import { isOwnedFixtureBranch } from './fixtures.js';
import { refusal } from '../tools/github-write.js';
import { matchesRunFooter } from './run-marker.js';

const SHA=/^[a-f0-9]{40}$/;
const LABEL='rtc-run';
const goodRef=name=>typeof name==='string'&&/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(name)&&
  !name.split('/').some(x=>x==='.'||x==='..')&&!name.includes('..');
function validRun(run,stepId) {
  if(!RUN_ID.test(run?.runId??'')||!run?.owner||!run?.repo||
    run.owner!==run.account||!run.connection||
    !/^[a-z0-9][a-z0-9-]{0,70}$/.test(stepId??''))
    throw new TypeError('A scoped run and stable step ID are required.');
}
function params(run){return {owner:run.owner,repo:run.repo};}
function objects(ctx,run){return ctx.db.listDevObjects({
  runId:run.runId,account:run.account,connection:run.connection,limit:50
});}
export async function createOwnedDraftPr(ctx,{github,run,stepId,head,base,defaultBranch,expectedHeadSha,title}) {
  validRun(run,stepId);
  if(!isOwnedFixtureBranch(run.runId,head)||!goodRef(base)||!goodRef(defaultBranch)||
    (base!==defaultBranch&&!isOwnedFixtureBranch(run.runId,base))||
    base===head||!SHA.test(expectedHeadSha??'')||
    typeof title!=='string'||title.length<1||title.length>256)
    throw new TypeError('Draft PR needs a recorded run-owned head, safe base and exact expected commit SHA.');
  const saved=await objects(ctx,run);
  if(!saved.some(x=>x.object_type==='branch'&&x.object_id===head&&x.repo===run.repo)||
    !saved.some(x=>x.object_type==='fixture_file'&&x.created_sha===expectedHeadSha&&x.repo===run.repo)||
    (base!==defaultBranch&&!saved.some(x=>x.object_type==='branch'&&x.object_id===base&&x.repo===run.repo)))
    throw new TypeError('Draft PR requires recorded run-owned branch and head commit; base must be scratch default or run-owned.');
  const ref=(await github.request('GET /repos/{owner}/{repo}/git/ref/{ref}',{
    ...params(run),ref:`heads/${head}`
  })).data;
  if(ref?.ref!==`refs/heads/${head}`||ref.object?.sha!==expectedHeadSha)
    throw refusal('The draft PR head changed after the run recorded its exact commit.');
  return runDevMutationOnce(ctx,{...run,stepId,type:'pr',objectName:head,
    create:async()=>{
      const body=`Run-owned draft review fixture.\n\n<!-- rtc_run=${run.runId} -->`;
      const p=(await github.request('POST /repos/{owner}/{repo}/pulls',{
        ...params(run),head,base,title,body,draft:true
      })).data;
      if(!Number.isSafeInteger(p?.number)||p.number<=0||p.draft!==true||
        p.state!=='open'||p.head?.ref!==head||p.base?.ref!==base||
        !matchesRunFooter(p.body,run.runId))
        throw refusal('GitHub did not confirm the exact run-owned draft PR.');
      return {objectId:String(p.number),createdSha:expectedHeadSha};
    }});
}
export async function createOwnedRunLabel(ctx,{github,run,stepId='seed-pr-label'}) {
  validRun(run,stepId);
  return runDevMutationOnce(ctx,{...run,stepId,type:'label',objectName:LABEL,
    create:async()=>{
      const data=(await github.request('POST /repos/{owner}/{repo}/labels',{
        ...params(run),name:LABEL,color:'0969da',description:`rtc_run=${run.runId}`
      })).data;
      if(data?.name!==LABEL||data.description!==`rtc_run=${run.runId}`)
        throw refusal('GitHub did not confirm the exact run-owned label.');
      return {objectId:LABEL};
    }});
}
export async function labelOwnedDraftPr(ctx,{github,run,stepId,prNumber}) {
  validRun(run,stepId);
  if(!Number.isSafeInteger(prNumber)||prNumber<1)
    throw new TypeError('An exact numeric run-owned PR number is required.');
  const saved=await objects(ctx,run);
  if(!saved.some(x=>x.object_type==='pr'&&x.object_id===String(prNumber)&&x.repo===run.repo)||
    !saved.some(x=>x.object_type==='label'&&x.object_id===LABEL&&x.repo===run.repo))
    throw new TypeError('Cannot label an unrecorded PR or with an unrecorded run label.');
  return runDevMutationOnce(ctx,{...run,stepId,type:'pr_label',
    objectName:`${prNumber}:${LABEL}`,create:async()=>{
      const data=(await github.request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels',{
        ...params(run),issue_number:prNumber,labels:[LABEL]
      })).data;
      if(!Array.isArray(data)||!data.some(x=>x.name===LABEL))
        throw refusal('GitHub did not confirm the exact PR label association.');
      return {objectId:`${prNumber}:${LABEL}`};
    }});
}
