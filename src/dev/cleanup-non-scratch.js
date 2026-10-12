// V-2 standalone branch/PR run cleanup: never delete the host repository.
import { missing, refusal, octo } from '../tools/github-write.js';
import { listAll } from '../github/client.js';
import { productionReason } from '../tools/production-guard.js';
import { matchesRunFooter } from './run-marker.js';
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
    (!/^[a-f0-9]{40}$/.test(o.created_sha??'')||foundSha!==o.created_sha))
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
  const head=objects.find(b=>b.object_type==='branch'&&b.object_id===p?.head?.ref);
  if(p.number!==num||p.merged===true||p.merged_at!=null||
    !['open','closed'].includes(p.state)||p.draft!==true||
    !matchesRunFooter(p.body,run.id)||
    !ownRef(run.id,p.head?.ref)||!eq(p.head?.repo?.full_name,`${owner}/${repo}`)||
    !eq(p.base?.repo?.full_name,`${owner}/${repo}`)||
    typeof p.base?.ref!=='string'||!p.base.ref||p.base.ref===p.head.ref||
    !head||!/^[a-f0-9]{40}$/.test(head.created_sha??'')||
    p.head?.sha!==head.created_sha)
    throw refusal('PR does not match its recorded run-owned draft branch; cleanup refused.');
  return p;
};

const ownedLabel=(id,name)=>typeof name==='string'&&
  (name==='rtc-run'||name===`rtc-run-${id}`);
const getLabel=(gh,owner,repo,name)=>missing(async()=>(await gh.request('GET /repos/{owner}/{repo}/labels/{name}',{owner,repo,name})).data);
const getPrLabel=(gh,owner,repo,n,name)=>missing(async()=>(await gh.request('GET /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}',{
  owner,repo,issue_number:n,name
})).data);
function association(objects,run,o) {
  const m=/^([1-9][0-9]*):(rtc-run(?:-[a-z0-9-]+)?)$/.exec(o.object_id??'');
  if(!m||!Number.isSafeInteger(Number(m[1]))||!ownedLabel(run.id,m[2])||
    !objects.some(p=>p.object_type==='pr'&&p.object_id===m[1])||
    !objects.some(l=>l.object_type==='label'&&l.object_id===m[2]))
    throw refusal('PR-label association has no exact run-owned PR and label.');
  return {number:Number(m[1]),name:m[2]};
}
const getIssue=(gh,owner,repo,n)=>missing(async()=>(await gh.request('GET /repos/{owner}/{repo}/issues/{issue_number}',{
  owner,repo,issue_number:n
})).data);
async function inspectOwnedIssue(gh,run,owner,repo,o,initial) {
  const number=Number(o.object_id);
  if(!Number.isSafeInteger(number)||number<1)throw refusal('Invalid recorded issue number.');
  const issue=await getIssue(gh,owner,repo,number);
  if(!issue) {
    if(initial)throw refusal('Recorded issue was deleted or moved; reconcile before cleanup.');
    throw refusal('The issue cannot be read back. No result will be assumed.');
  }
  if(issue.pull_request||!matchesRunFooter(issue.body,run.id)||
    !['open','closed'].includes(issue.state)||
    (issue.state==='closed'&&issue.state_reason!=='not_planned'))
    throw refusal('This issue is not the unmerged run-created issue recorded in the journal.');
  const cleanedLabel=await getLabel(gh,owner,repo,'rtc-cleaned');
  if(!cleanedLabel||cleanedLabel.name!=='rtc-cleaned')
    throw refusal('A repository-owned rtc-cleaned label must already exist for issue cleanup.');
  return {number,issue};
}
async function inspectLabel(gh,run,owner,repo,objects,o,initial) {
  if(!ownedLabel(run.id,o.object_id))throw refusal('Only reserved run-created labels may be deleted.');
  const label=await getLabel(gh,owner,repo,o.object_id);
  if(!label) {
    if(initial)throw refusal('The recorded label disappeared; reconcile before cleanup.');
    return null;
  }
  if(label.name!==o.object_id||label.description!==marker(run.id))
    throw refusal('Label name/description does not match the original run; do not modify it.');
  // Label deletion impacts every issue/PR using it, not just objects in this run.
  const {items,capped}=await listAll(gh,'GET /repos/{owner}/{repo}/issues',{
    owner,repo,state:'all',labels:o.object_id,per_page:100
  },{max:100});
  if(capped||items.some(i=>!objects.some(x=>['pr','issue'].includes(x.object_type)&&x.object_id===String(i.number))))
    throw refusal('A run label is used outside its recorded run; deletion refused.');
  return label;
}
async function inspectPrLabel(gh,run,owner,repo,objects,o,initial) {
  const {number,name}=association(objects,run,o);
  const label=await getPrLabel(gh,owner,repo,number,name);
  if(!label&&initial)throw refusal('The recorded PR label is missing; reconcile before cleanup.');
  if(label&&label.name!==name)throw refusal('PR label association does not match the journal.');
  return {number,name,label};
}
// Preflight checks every action before beginning any mutation. A rerun still checks its uncleaned objects.
export async function inspectTestResources(ctx,{run,owner,repo,objects}) {
  if(objects.length===0||objects.some(o=>o.repo!==repo||!['pr','branch','label','pr_label','issue'].includes(o.object_type)))
    throw refusal('Standalone cleanup accepts recorded issues, PRs, test branches and owned labels in one existing repository.');
  if(!objects.some(o=>o.object_type==='branch'))
    throw refusal('Standalone cleanup requires an exact recorded run-owned branch.');
  const gh=await octo(ctx,owner),initial=run.status==='active';
  for(const o of objects.filter(x=>!x.cleaned)) {
    if(o.object_type==='branch') {
      if(!ownRef(run.id,o.object_id))throw refusal('Foreign ref cannot be cleaned as a developer-run branch.');
      await branchIsSafe(ctx,gh,run,owner,repo,o,initial);
    } else if(o.object_type==='pr') await prIsSafe(gh,run,owner,repo,objects,o,initial);
    else if(o.object_type==='label') await inspectLabel(gh,run,owner,repo,objects,o,initial);
    else if(o.object_type==='issue') await inspectOwnedIssue(gh,run,owner,repo,o,initial);
    else await inspectPrLabel(gh,run,owner,repo,objects,o,initial);
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
  // GitHub cannot delete issues. Close only journaled run issues as not_planned,
  // apply an existing cleanup label and verify both effects independently.
  for(const o of objects.filter(x=>!x.cleaned&&x.object_type==='issue')) {
    const {number,issue}=await inspectOwnedIssue(gh,run,owner,repo,o,before.run.status==='active');
    if(issue.state==='open')await gh.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}',{
      owner,repo,issue_number:number,state:'closed',state_reason:'not_planned'
    });
    const closed=await getIssue(gh,owner,repo,number);
    if(closed?.state!=='closed'||closed?.state_reason!=='not_planned')
      throw refusal('Issue closure could not be independently verified.');
    if(!closed.labels?.some(x=>x.name==='rtc-cleaned'))
      await gh.request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels',{
        owner,repo,issue_number:number,labels:['rtc-cleaned']
      });
    const after=await getIssue(gh,owner,repo,number);
    if(after?.state!=='closed'||after?.state_reason!=='not_planned'||
      !after.labels?.some(x=>x.name==='rtc-cleaned'))
      throw refusal('The cleanup label and issue state were not verified.');
    if(!(await db.markDevObjectCleaned({runId,account,connection,type:o.object_type,owner:o.owner,objectId:o.object_id})))
      throw refusal('Recorded issue completion was not persisted.');
    processed++;
  }
  // Drop only recorded associations after their run PR has been safely closed.
  for(const o of objects.filter(x=>!x.cleaned&&x.object_type==='pr_label')) {
    const {number,name}=association(objects,run,o);
    const beforeLabel=await inspectPrLabel(gh,run,owner,repo,objects,o,before.run.status==='active');
    if(beforeLabel.label)await gh.request('DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}',{
      owner,repo,issue_number:number,name
    });
    if(await getPrLabel(gh,owner,repo,number,name))
      return {verified:false,remaining:true,run_id:runId};
    if(!(await db.markDevObjectCleaned({runId,account,connection,type:o.object_type,owner:o.owner,objectId:o.object_id})))
      throw refusal('PR label association cleanup was not journaled.');
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
  // A label can be shared across non-run PRs/issues; scan current use again before deletion.
  for(const o of objects.filter(x=>!x.cleaned&&x.object_type==='label')) {
    const label=await inspectLabel(gh,run,owner,repo,objects,o,before.run.status==='active');
    if(label)await gh.request('DELETE /repos/{owner}/{repo}/labels/{name}',{
      owner,repo,name:o.object_id
    });
    if(await getLabel(gh,owner,repo,o.object_id))
      return {verified:false,remaining:true,run_id:runId};
    if(!(await db.markDevObjectCleaned({runId,account,connection,type:o.object_type,owner:o.owner,objectId:o.object_id})))
      throw refusal('Label cleanup was not journaled.');
    processed++;
  }
  if(!(await db.completeDevCleanup({runId,account,connection})))
    throw refusal('Not all exact run objects were cleaned; inspect before retry.');
  return {verified:true,deleted_repository:false,objects_cleaned:processed,run_id:runId};
}
