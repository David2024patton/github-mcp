// V-2: never delete on a tag search. A recorded run owns one exact private scratch repository.
import { missing, octo, refusal } from '../tools/github-write.js';
import { requireScratchOrg } from './scratch.js';
import { planDevCleanup } from './cleanup.js';
import { inspectTestResources, cleanupTestResources } from './cleanup-non-scratch.js';

const marker = id => `rtc_run=${id}`;
const equal = (a,b) => String(a??'').toLowerCase() === String(b??'').toLowerCase();
const getRepo = (github,owner,repo) => missing(async()=>(await github.request('GET /repos/{owner}/{repo}',{owner,repo})).data);
const getPull = (github,owner,repo,n) => missing(async()=>(await github.request('GET /repos/{owner}/{repo}/pulls/{pull_number}',{owner,repo,pull_number:n})).data);

export function requireExactScratchRepo(repo,run,owner,name) {
  if(repo && (!equal(repo.full_name,`${owner}/${name}`) || repo.private!==true ||
    !String(repo.description??'').includes(marker(run.id))))
    throw refusal('The live repository is not the exact private, run-marked scratch repository. Deletion refused.');
}
export async function readCleanupRun(ctx,owner,repo,runId) {
  const connection=ctx.connection.client_id, db=ctx.db;
  const run=await db.getDevRun({id:runId,account:owner,connection});
  if(!run)throw refusal('That development run does not belong to this connection.');
  const [objects,intents]=await Promise.all([
    db.listDevObjects({runId,account:owner,connection,limit:50}),
    db.listDevIntents({runId,account:owner,connection,limit:50})
  ]);
  const plan=planDevCleanup({run,objects,intents});
  const root=objects.find(x=>x.object_type==='repo');
  if(root) {
    if(root.repo!==repo || !equal(root.object_id,`${owner}/${repo}`))
      throw refusal('Only an exact recorded scratch repository may be deleted.');
    await requireScratchOrg(ctx,owner);
  }
  const github=await octo(ctx,owner);
  const existing=await getRepo(github,owner,repo);
  if(root)requireExactScratchRepo(existing,run,owner,repo);
  else {
    if(!existing)throw refusal('The host repository disappeared. Refusing standalone resource cleanup.');
    if(!equal(existing.full_name,`${owner}/${repo}`))throw refusal('Unexpected host repository identity.');
    await inspectTestResources(ctx,{run,owner,repo,objects});
  }
  if(root&&!existing&&run.status!=='cleaning'&&run.status!=='cleaned')
    throw refusal('The repository is missing and the run is not already cleaning; reconcile before cleanup.');
  return {run,plan,objects,existing,deleteRepository:!!root};
}
export async function executeCleanup(ctx,{owner,repo,runId,before}) {
  if(!before.deleteRepository)return cleanupTestResources(ctx,{owner,repo,runId,before});
  await requireScratchOrg(ctx,owner);
  const connection=ctx.connection.client_id,db=ctx.db;
  if(before.run.status==='cleaned')
    throw refusal('Run cleanup is already complete. No deletion was attempted.');
  if(!(await db.beginDevCleanup({runId,account:owner,connection})))
    throw refusal('The cleanup freeze was refused. Reconcile unfinished writes before retrying.');
  // Re-read the exact recorded state after freeze: no new claimed seed can race this teardown.
  const snapshot=await readCleanupRun(ctx,owner,repo,runId);
  const github=await octo(ctx,owner);
  const live=await getRepo(github,owner,repo);
  requireExactScratchRepo(live,snapshot.run,owner,repo);
  // Missing after a prior partial cleanup is safe to reconcile, never a reason to delete a substitute.
  if(live) {
    for(const item of snapshot.objects.filter(x=>x.object_type==='pr'&&!x.cleaned)){
      const number=Number(item.object_id);
      if(!Number.isSafeInteger(number)||number<=0)throw refusal('Invalid recorded pull-request number.');
      const pull=await getPull(github,owner,repo,number);
      if(!pull||pull.merged===true||!String(pull.body??'').includes(marker(runId))||
        !equal(pull.head?.repo?.full_name,`${owner}/${repo}`))
        throw refusal(`PR #${number} was not verified as a run-owned unmerged pull request; cleanup stopped.`);
      if(pull.state==='open') {
        await github.request('PATCH /repos/{owner}/{repo}/pulls/{pull_number}',{
          owner,repo,pull_number:number,state:'closed'
        });
      } else if(pull.state!=='closed') throw refusal('Unknown pull-request state.');
      const after=await getPull(github,owner,repo,number);
      if(!after || after.state!=='closed'||after.merged===true)
        throw refusal('The exact PR closure could not be verified; cleanup stopped.');
    }
    // No other repo is eligible: exact verified private full_name and marker are checked again.
    const latest=await getRepo(github,owner,repo);
    requireExactScratchRepo(latest,snapshot.run,owner,repo);
    if(!latest)throw refusal('The scratch repository disappeared before deletion; inspect the run.');
    await github.request('DELETE /repos/{owner}/{repo}',{owner,repo});
  }
  const remaining=await getRepo(github,owner,repo);
  if(remaining)return {deleted:false,remaining:true,verified:false};
  // The recorded repository is independently absent, so all objects inside it are absent.
  for(const item of snapshot.objects.filter(x=>!x.cleaned)){
    const saved=await db.markDevObjectCleaned({runId,account:owner,connection,
      type:item.object_type,owner:item.owner,objectId:item.object_id});
    if(!saved)throw refusal('An exact cleanup journal row could not be updated. Inspect the run before retrying.');
  }
  if(!(await db.completeDevCleanup({runId,account:owner,connection})))
    throw refusal('The cleanup ledger is incomplete. Inspect the exact remaining rows.');
  return {deleted:true,verified:true,objects_cleaned:snapshot.objects.length,run_id:runId};
}
export async function readCleanupAfter(ctx,{owner,repo,runId}) {
  const connection=ctx.connection.client_id;
  const [run,objects,intents,github]=await Promise.all([
    ctx.db.getDevRun({id:runId,account:owner,connection}),
    ctx.db.listDevObjects({runId,account:owner,connection,limit:50}),
    ctx.db.listDevIntents({runId,account:owner,connection,limit:50}),
    octo(ctx,owner)
  ]);
  return {run,objects,intents,repo:await getRepo(github,owner,repo)};
}
