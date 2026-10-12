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
