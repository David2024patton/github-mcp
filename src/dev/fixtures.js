// V-1 run-owned GitHub fixture operations. Call only after the preview/scratch trust gates.
// An exact durable claim precedes every write, and unknown outcomes never automatically replay.
import { RUN_ID } from './ledger.js';
import { runDevMutationOnce } from './execute.js';
import { refusal } from '../tools/github-write.js';

const SHA=/^[a-f0-9]{40}$/;
const FILE=/^[a-z][a-z0-9-]{0,38}\.md$/;
function identity(run) {
  if(!run||!RUN_ID.test(run.runId??'')||!run.owner||!run.repo||
    !run.account||!run.connection||run.owner!==run.account)
    throw new TypeError('A scoped run identity is required for fixture mutations.');
}
function step(stepId) {
  if(typeof stepId!=='string'||!/^[a-z0-9][a-z0-9-]{0,70}$/.test(stepId))
    throw new TypeError('An exact, stable step ID is required.');
}
export function isOwnedFixtureBranch(runId,name) {
  return RUN_ID.test(runId??'')&&typeof name==='string'&&
    name.startsWith(`rtc/${runId}/`)&&
    /^[a-z][a-z0-9-]{0,40}$/.test(name.slice(`rtc/${runId}/`.length));
}
export async function createOwnedFixtureBranch(ctx,{github,run,stepId,name,sha}) {
  identity(run);step(stepId);
  if(!isOwnedFixtureBranch(run.runId,name)||!SHA.test(sha??''))
    throw new TypeError('A run-owned test branch and exact Git commit SHA are required.');
  return runDevMutationOnce(ctx,{...run,stepId,type:'branch',objectName:name,
    create:async()=>{
      const result=(await github.request('POST /repos/{owner}/{repo}/git/refs',{
        owner:run.owner,repo:run.repo,ref:`refs/heads/${name}`,sha
      })).data;
      if(result?.ref!==`refs/heads/${name}`||result.object?.sha!==sha)
        throw refusal('GitHub did not confirm the exact test branch and SHA.');
      return {objectId:name,createdSha:sha};
    }
  });
}
export async function commitOwnedFixtureFile(ctx,{github,run,stepId,path,content,branch=null}) {
  identity(run);step(stepId);
  const workflow=path===`.github/workflows/rtc-${run.runId}.yml`;
  const fixture=typeof path==='string'&&path.startsWith(`rtc/${run.runId}/`)&&
    FILE.test(path.slice(`rtc/${run.runId}/`.length));
  if(!workflow&&!fixture)throw new TypeError('Fixture files must be scoped to the run.');
  if(typeof content!=='string'||!content.length||Buffer.byteLength(content)>16_384)
    throw new TypeError('Fixture content must be nonempty and at most 16 KB.');
  if(branch!==null&&!isOwnedFixtureBranch(run.runId,branch))
    throw new TypeError('Fixture commits may only target this run\'s branches.');
  return runDevMutationOnce(ctx,{...run,stepId,type:workflow?'workflow_file':'fixture_file',
    objectName:path,create:async()=>{
      const params={owner:run.owner,repo:run.repo,path,
        message:`test: add rtc_run=${run.runId} fixture`,
        content:Buffer.from(content).toString('base64')};
      if(branch!==null)params.branch=branch;
      const result=(await github.request('PUT /repos/{owner}/{repo}/contents/{path}',params)).data;
      if(result?.content?.path!==path||!SHA.test(result?.commit?.sha??''))
        throw refusal('GitHub did not confirm the exact fixture file and commit.');
      return {objectId:path,createdSha:result.commit.sha};
    }});
}
