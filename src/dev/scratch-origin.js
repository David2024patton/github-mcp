// V-1: capture the immutable initial scratch default-branch commit in the run ledger.
// Reads happen after the exact private repo POST and before a recorded intent completes.
// A failed/ambiguous read freezes this step for reconciliation, never a blind replay.
import { refusal } from '../tools/github-write.js';
import { matchesRunDescription } from './run-marker.js';

const SHA=/^[a-f0-9]{40}$/;
export async function captureScratchOrigin(github,{owner,repo,runId,created}) {
  const branch=created?.default_branch;
  if(created?.private!==true||
    created.full_name?.toLowerCase()!==`${owner}/${repo}`.toLowerCase()||
    !matchesRunDescription(created.description,runId)||
    typeof branch!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(branch)||
    branch.includes('..')||branch.includes('//'))
    throw refusal('The exact private scratch repository and default branch were not confirmed.');
  const ref=(await github.request('GET /repos/{owner}/{repo}/git/ref/{ref}',{
    owner,repo,ref:`heads/${branch}`
  })).data;
  if(ref?.ref!==`refs/heads/${branch}`||!SHA.test(ref.object?.sha??''))
    throw refusal('The initial scratch repository commit could not be independently verified.');
  return ref.object.sha;
}

// V-1 interrupted-seed replay gate. A run marker or matching repository name
// cannot establish that the original private repository is still unchanged.
// This validates the journalled initial/default-branch commit immediately
// before another claimed mutation, including a recorded workflow advancement.
export async function verifySeedResumeOrigin(github,{owner,repo,runId,existing,repoIntent,workflowIntent}){
  const full=`${owner}/${repo}`;
  if(existing?.private!==true||existing.full_name?.toLowerCase()!==full.toLowerCase()||
    !matchesRunDescription(existing.description,runId)||
    typeof existing.default_branch!=='string'||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(existing.default_branch)||
    existing.default_branch.includes('..')||existing.default_branch.includes('//'))
    throw refusal('A resumed seed has no exact verified private scratch repository/default branch.');
  if(repoIntent?.status!=='recorded'||repoIntent.object_type!=='repo'||
    repoIntent.object_id?.toLowerCase()!==full.toLowerCase()||
    repoIntent.owner?.toLowerCase()!==owner.toLowerCase()||
    repoIntent.repo!==repo||repoIntent.object_name!==repo||
    !SHA.test(repoIntent.created_sha??''))
    throw refusal('A resumed seed has no exact recorded original repository commit.');
  let expected=repoIntent.created_sha;
  if(workflowIntent){
    if(workflowIntent.status!=='recorded'||workflowIntent.object_type!=='workflow_file'||
      workflowIntent.owner?.toLowerCase()!==owner.toLowerCase()||
      workflowIntent.repo!==repo||
      workflowIntent.object_name!==`.github/workflows/rtc-${runId}.yml`||
      workflowIntent.object_id!==workflowIntent.object_name||
      !SHA.test(workflowIntent.created_sha??''))
      throw refusal('A workflow step is incomplete or lacks exact commit evidence; never retry blindly.');
    expected=workflowIntent.created_sha;
  }
  const ref=`heads/${existing.default_branch}`;
  const current=(await github.request('GET /repos/{owner}/{repo}/git/ref/{ref}',{owner,repo,ref})).data;
  if(current?.ref!==`refs/${ref}`||current.object?.sha!==expected)
    throw refusal('The scratch default branch moved from its recorded seed commit; no further writes allowed.');
  return {initial_sha:repoIntent.created_sha,expected_default_sha:expected,verified:true};
}
