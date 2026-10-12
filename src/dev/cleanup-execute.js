// V-2: never delete on a tag search. A recorded run owns one exact private scratch repository.
import { missing, octo, refusal } from '../tools/github-write.js';
import { listAll } from '../github/client.js';
import { requireScratchOrg } from './scratch.js';
import { planDevCleanup } from './cleanup.js';
import { matchesRunDescription, matchesRunFooter } from './run-marker.js';
import { inspectTestResources, cleanupTestResources } from './cleanup-non-scratch.js';

const equal = (a,b) => String(a??'').toLowerCase() === String(b??'').toLowerCase();
const getRepo = (github,owner,repo) => missing(async()=>(await github.request('GET /repos/{owner}/{repo}',{owner,repo})).data);
const getPull = (github,owner,repo,n) => missing(async()=>(await github.request('GET /repos/{owner}/{repo}/pulls/{pull_number}',{owner,repo,pull_number:n})).data);

export function requireExactScratchRepo(repo,run,owner,name) {
  if(repo && (!equal(repo.full_name,`${owner}/${name}`) || repo.private!==true ||
    !matchesRunDescription(repo.description,run.id)))
    throw refusal('The live repository is not the exact private, run-marked scratch repository. Deletion refused.');
}

// A run-marked repository can be repurposed by someone else after creation.
// Refuse whole-repository deletion when independently listed PRs, issues or
// non-default branches are absent from the durable run journal. The bounded
// lists are complete or deletion is denied; no search-by-marker authorizes it.
export async function inspectScratchArtifacts(github,{owner,repo,run,objects,defaultBranch}) {
  if(typeof defaultBranch!=='string'||!defaultBranch||
    !Array.isArray(objects)||!run?.id)
    throw refusal('Scratch repository default branch and exact run journal are required.');
  const common={owner,repo,per_page:100};
  const [branches,pulls,issues,tags,releases,rulesets,hooks]=await Promise.all([
    listAll(github,'GET /repos/{owner}/{repo}/branches',common,{max:100}),
    listAll(github,'GET /repos/{owner}/{repo}/pulls',{...common,state:'all'},{max:100}),
    listAll(github,'GET /repos/{owner}/{repo}/issues',{...common,state:'all'},{max:100}),
    listAll(github,'GET /repos/{owner}/{repo}/tags',common,{max:100}),
    listAll(github,'GET /repos/{owner}/{repo}/releases',common,{max:100}),
    listAll(github,'GET /repos/{owner}/{repo}/rulesets',{...common,includes_parents:false},{max:100}),
    listAll(github,'GET /repos/{owner}/{repo}/hooks',common,{max:100})
  ]);
  const inventories=[branches,pulls,issues,tags,releases,rulesets,hooks];
  if(inventories.some(x=>x.capped||!Array.isArray(x.items)))
    throw refusal('Scratch inventory is incomplete; repository deletion refused.');
  const owns=(type,id)=>objects.some(x=>x.object_type===type&&
    x.object_id===String(id)&&x.owner.toLowerCase()===owner.toLowerCase()&&x.repo===repo);
  // A SHA belonging to another fixture or branch is not evidence for this branch.
  // A run may advance its own branch with one exact fixture file, and the review
  // scenario may subsequently record one explicit revision of that same file.
  const branchTip=new Map();
  for(const b of branches.items.filter(x=>x?.name!==defaultBranch)) {
    const saved=objects.filter(x=>x.object_type==='branch'&&x.owner.toLowerCase()===owner.toLowerCase()&&
      x.repo===repo&&x.object_id===b.name);
    if(saved.length!==1)throw refusal('A scratch branch has no unique run-owned journal identity.');
    const suffix=b.name.startsWith(`rtc/${run.id}/`)?b.name.slice(`rtc/${run.id}/`.length):'';
    const path=`rtc/${run.id}/${suffix}.md`;
    const files=objects.filter(x=>x.object_type==='fixture_file'&&x.object_id===path&&x.repo===repo);
    const revisions=objects.filter(x=>x.object_type==='fixture_revision'&&x.repo===repo&&
      x.object_id.startsWith(`${path}@`));
    if(files.length>1||revisions.length>1||(revisions.length>0&&files.length!==1))
      throw refusal('A scratch branch has ambiguous fixture-commit evidence.');
    const revised=revisions[0];
    if(revised&&revised.object_id!==`${path}@${revised.created_sha}`)
      throw refusal('A recorded fixture revision does not bind to its exact commit.');
    const tip=revised?.created_sha??files[0]?.created_sha??saved[0].created_sha;
    if(!/^[a-f0-9]{40}$/.test(tip??''))
      throw refusal('A scratch branch has no valid recorded tip commit.');
    branchTip.set(b.name,tip);
  }
  if(!branches.items.some(x=>x.name===defaultBranch))
    throw refusal('The scratch default branch could not be independently listed.');
  for(const b of branches.items) {
    if(b?.name===defaultBranch)continue;
    if(typeof b?.name!=='string'||!b.name.startsWith(`rtc/${run.id}/`)||
      !owns('branch',b.name)||b.commit?.sha!==branchTip.get(b.name))
      throw refusal('An unrecorded or changed branch exists in the scratch repository. Deletion refused.');
  }
  const numbers=new Set();
  for(const p of pulls.items) {
    const head=p?.head?.ref,base=p?.base?.ref;
    const saved=objects.filter(x=>x.object_type==='pr'&&x.object_id===String(p?.number)&&
      x.owner.toLowerCase()===owner.toLowerCase()&&x.repo===repo);
    if(!Number.isSafeInteger(p?.number)||p.number<1||numbers.has(p.number)||
      saved.length!==1||p.merged===true||p.merged_at!=null||p.draft!==true||
      !['open','closed'].includes(p.state)||
      !matchesRunFooter(p.body,run.id)||
      typeof head!=='string'||!head.startsWith(`rtc/${run.id}/`)||
      !branchTip.has(head)||p.head?.sha!==branchTip.get(head)||
      !equal(p.head?.repo?.full_name,`${owner}/${repo}`)||
      (base!==defaultBranch&&!branchTip.has(base))||
      !equal(p.base?.repo?.full_name,`${owner}/${repo}`))
      throw refusal('A pull request changed draft state, repository, base or exact run-owned head; deletion refused.');
    numbers.add(p.number);
  }
  for(const i of issues.items) {
    if(!Number.isSafeInteger(i?.number)||i.number<1||
      (i.pull_request? !numbers.has(i.number):
        !owns('issue',i.number)||!matchesRunFooter(i.body,run.id)))
      throw refusal('An unrecorded or changed issue exists in the scratch repository. Deletion refused.');
  }
  // A recorded release does not give the run permission to destroy later
  // published releases or independently created Git tags in the same repo.
  // The release-train seed creates only three lightweight tags and one draft.
  const names=new Set();
  for(const t of tags.items) {
    const saved=objects.filter(x=>x.object_type==='tag'&&x.object_id===t?.name&&
      x.owner.toLowerCase()===owner.toLowerCase()&&x.repo===repo);
    if(typeof t?.name!=='string'||names.has(t.name)||saved.length!==1||
      !/^[a-f0-9]{40}$/.test(saved[0].created_sha??'')||
      t.commit?.sha!==saved[0].created_sha)
      throw refusal('An unrecorded or retargeted Git tag exists in the scratch repository. Deletion refused.');
    names.add(t.name);
  }
  const ids=new Set();
  for(const release of releases.items) {
    const id=release?.id;
    const saved=objects.filter(x=>x.object_type==='release'&&x.object_id===String(id)&&
      x.owner.toLowerCase()===owner.toLowerCase()&&x.repo===repo);
    if(!Number.isSafeInteger(id)||id<=0||ids.has(id)||saved.length!==1||
      release.draft!==true||release.published_at!=null||
      !matchesRunDescription(release.body,run.id)||
      !names.has(release.tag_name)||!Array.isArray(release.assets)||release.assets.length!==0)
      throw refusal('An unrecorded, published or changed release exists in the scratch repository. Deletion refused.');
    ids.add(id);
  }
  // V-4 webhook-target has not been implemented, so not even a run-marked
  // webhook is safe to silently destroy with its parent scratch repository.
  if(hooks.items.length>0)
    throw refusal('A repository webhook exists. V-4 webhook cleanup is not verified; scratch deletion refused.');
  const idsOfRules=new Set();
  for(const s of rulesets.items) {
    if(!Number.isSafeInteger(s?.id)||s.id<=0||idsOfRules.has(s.id)||
      !objects.some(x=>x.object_type==='ruleset'&&x.object_id===String(s.id)&&
        x.owner.toLowerCase()===owner.toLowerCase()&&x.repo===repo)||
      s.name!==`rtc-run-${run.id}`||s.source_type!=='Repository')
      throw refusal('A foreign or changed scratch ruleset exists; deletion refused.');
    idsOfRules.add(s.id);
    const live=(await github.request('GET /repos/{owner}/{repo}/rulesets/{ruleset_id}',{
      owner,repo,ruleset_id:s.id,includes_parents:false})).data;
    const rule=live?.rules?.[0],params=rule?.parameters;
    if(live?.id!==s.id||live.name!==s.name||live.target!=='branch'||live.enforcement!=='active'||
      live.source_type!=='Repository'||live.rules?.length!==1||
      live.conditions?.ref_name?.include?.length!==1||
      live.conditions.ref_name.include[0]!=='~DEFAULT_BRANCH'||
      !Array.isArray(live.conditions.ref_name.exclude)||live.conditions.ref_name.exclude.length!==0||
      rule.type!=='required_status_checks'||params?.strict_required_status_checks_policy!==true||
      params.required_status_checks?.length!==1||
      params.required_status_checks[0]?.context!=='ci'||
      !Array.isArray(live.bypass_actors)||live.bypass_actors.length!==0)
      throw refusal('A run-owned scratch ruleset was modified after creation; deletion refused.');
  }
  return {branch_count:branches.items.length,pr_count:pulls.items.length,issue_count:issues.items.length,tag_count:tags.items.length,release_count:releases.items.length,
    ruleset_count:rulesets.items.length,webhook_count:0};
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
    await inspectScratchArtifacts(github,{owner,repo,run:snapshot.run,objects:snapshot.objects,
      defaultBranch:live.default_branch});
    for(const item of snapshot.objects.filter(x=>x.object_type==='pr'&&!x.cleaned)){
      const number=Number(item.object_id);
      if(!Number.isSafeInteger(number)||number<=0)throw refusal('Invalid recorded pull-request number.');
      const pull=await getPull(github,owner,repo,number);
      if(!pull||pull.merged===true||!matchesRunFooter(pull.body,runId)||
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
    await inspectScratchArtifacts(github,{owner,repo,run:snapshot.run,objects:snapshot.objects,
      defaultBranch:latest.default_branch});
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
