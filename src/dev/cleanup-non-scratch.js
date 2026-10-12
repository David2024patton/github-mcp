// V-2 standalone branch/PR run cleanup: never delete the host repository.
import { missing, refusal, octo } from '../tools/github-write.js';
import { productionReason } from '../tools/production-guard.js';
const eq=(a,b)=>String(a??'').toLowerCase()===String(b??'').toLowerCase();
const marker=id=>`rtc_run=${id}`;
const ownRef=(runId,ref)=>typeof ref==='string'&&ref.startsWith(`rtc/${runId}/`)&&
  ref.length<250&&!ref.includes('..')&&!ref.endsWith('/')&&!ref.includes('//');
const getBranch=(gh,owner,repo,branch)=>missing(async()=>(await gh.request('GET /repos/{owner}/{repo}/branches/{branch}',{owner,repo,branch})).data);
const getPr=(gh,owner,repo,n)=>missing(async()=>(await gh.request('GET /repos/{owner}/{repo}/pulls/{pull_number}',{owner,repo,pull_number:n})).data);
const branchIsSafe=async(ctx,gh,run,owner,repo,o,initial)=>{
  const b=await getBranch(gh,owner,repo,o.object_id);
  if(!b) {
    if(initial)throw refusal('Unrecorded external branch disappearance requires manual reconciliation.');
    return null;
  }
  const foundSha=b.commit?.sha;
  if(b.name!==o.object_id||b.protected!==false||!ownRef(run.id,b.name)||
    (o.created_sha&&foundSha!==o.created_sha))
    throw refusal('Recorded branch is protected, renamed or changed; cleanup refused.');
  const reason=await productionReason(ctx,{owner,repo,ref:b.name,scope:'repo'});
  if(reason)throw refusal(`The test branch is production-controlled (${reason}); cleanup refused.`);
  return b;
};
const prIsSafe=async(gh,run,owner,repo,objects,o,initial)=>{
  const num=Number(o.object_id);
  if(!Number.isSafeInteger(num)||num<1)throw refusal('Invalid recorded PR number.');
  const p=await getPr(gh,owner,repo,num);
  if(!p) {
    if(initial)throw refusal('Recorded PR is missing; reconcile its exact identity.');
    return null;
  }
  if(p.merged===true||!['open','closed'].includes(p.state)||
    !String(p.body??'').includes(marker(run.id))||
    !ownRef(run.id,p.head?.ref)||!eq(p.head?.repo?.full_name,`${owner}/${repo}`)||
    !objects.some(b=>b.object_type==='branch'&&b.object_id===p.head.ref))
    throw refusal('PR does not match its recorded run-owned draft branch; cleanup refused.');
  return p;
};
// Preflight checks every action before beginning any mutation. A rerun still checks its uncleaned objects.
export async function inspectTestResources(ctx,{run,owner,repo,objects}) {
  if(objects.length===0||objects.some(o=>o.repo!==repo||!['pr','branch'].includes(o.object_type)))
    throw refusal('Standalone cleanup currently accepts only recorded PRs and test branches in one existing repository.');
  if(!objects.some(o=>o.object_type==='branch'))
    throw refusal('Standalone cleanup requires an exact recorded run-owned branch.');
  const gh=await octo(ctx,owner),initial=run.status==='active';
  for(const o of objects.filter(x=>!x.cleaned)) {
    if(o.object_type==='branch') {
      if(!ownRef(run.id,o.object_id))throw refusal('Foreign ref cannot be cleaned as a developer-run branch.');
      await branchIsSafe(ctx,gh,run,owner,repo,o,initial);
    } else await prIsSafe(gh,run,owner,repo,objects,o,initial);
  }
  return true;
}
export async function cleanupTestResources(ctx,{owner,repo,runId,before}) {
  const account=owner,connection=ctx.connection.client_id,db=ctx.db;
  if(!(await db.beginDevCleanup({runId,account,connection})))
    throw refusal('Cleanup freeze refused; resolve unfinished claims first.');
  // Full read/authorization after freeze. No branch in a changed/foreign repo may be touched.
  const run=await db.getDevRun({id:runId,account,connection});
  const objects=await db.listDevObjects({runId,account,connection,limit:50});
  if(objects.length>=50)throw refusal('Truncated cleanup ledger; no GitHub writes allowed.');
  const gh=await octo(ctx,owner);
  // Independent no-foreign/preflight readback, plus before preview checks by the calling tool.
  await inspectTestResources(ctx,{run,owner,repo,objects});
  let processed=0;
  for(const o of objects.filter(x=>!x.cleaned&&x.object_type==='pr')) {
    const n=Number(o.object_id);
    const p=await prIsSafe(gh,run,owner,repo,objects,o,before.run.status==='active');
    if(p?.state==='open')await gh.request('PATCH /repos/{owner}/{repo}/pulls/{pull_number}',{owner,repo,pull_number:n,state:'closed'});
    const after=await getPr(gh,owner,repo,n);
    if(!after||after.state!=='closed'||after.merged===true)throw refusal('Closed PR could not be read back.');
    if(!(await db.markDevObjectCleaned({runId,account,connection,type:o.object_type,owner:o.owner,objectId:o.object_id})))
      throw refusal('PR cleanup identity was not recorded.');
    processed++;
  }
  for(const o of objects.filter(x=>!x.cleaned&&x.object_type==='branch')) {
    const live=await branchIsSafe(ctx,gh,run,owner,repo,o,before.run.status==='active');
    if(live)await gh.request('DELETE /repos/{owner}/{repo}/git/refs/{ref}',{owner,repo,ref:`heads/${o.object_id}`});
    if(await getBranch(gh,owner,repo,o.object_id))
      return {verified:false,remaining:true,run_id:runId};
    if(!(await db.markDevObjectCleaned({runId,account,connection,type:o.object_type,owner:o.owner,objectId:o.object_id})))
      throw refusal('Branch cleanup identity was not recorded.');
    processed++;
  }
  if(!(await db.completeDevCleanup({runId,account,connection})))
    throw refusal('Not all exact run objects were cleaned; inspect before retry.');
  return {verified:true,deleted_repository:false,objects_cleaned:processed,run_id:runId};
}
