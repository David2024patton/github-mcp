// V-2: never delete on a tag search. A recorded run owns one exact private scratch repository.
import { missing, octo, refusal } from '../tools/github-write.js';
import { listAll } from '../github/client.js';
import { requireScratchOrg } from './scratch.js';
import { planDevCleanup } from './cleanup.js';
import { matchesRunDescription, matchesRunFooter } from './run-marker.js';
import { inspectTestResources, cleanupTestResources } from './cleanup-non-scratch.js';
import { inspectScratchComments } from './cleanup-comments.js';
import { assertScratchJournalCoverage } from './cleanup-inventory.js';
import { assertScenarioResourceBounds } from './scenario-ownership.js';
import { withCleanupExecution } from './cleanup-execution.js';
import { baselineScratchLabels } from './cleanup-birth-labels.js';

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
export async function inspectScratchArtifacts(github,{owner,repo,run,objects,defaultBranch,intents=[],birth=null}) {
  if(typeof defaultBranch!=='string'||!defaultBranch||
    !Array.isArray(objects)||!run?.id)
    throw refusal('Scratch repository default branch and exact run journal are required.');
  const common={owner,repo,per_page:100};
  const [branches,pulls,issues,tags,releases,rulesets,hooks,milestones,deployments,environments,labels,workflowRuns,artifacts,workflows]=await Promise.all([
    listAll(github,'GET /repos/{owner}/{repo}/branches',common,{max:100}),
    listAll(github,'GET /repos/{owner}/{repo}/pulls',{...common,state:'all'},{max:100}),
    listAll(github,'GET /repos/{owner}/{repo}/issues',{...common,state:'all'},{max:100}),
    listAll(github,'GET /repos/{owner}/{repo}/tags',common,{max:100}),
    listAll(github,'GET /repos/{owner}/{repo}/releases',common,{max:100}),
    listAll(github,'GET /repos/{owner}/{repo}/rulesets',{...common,includes_parents:false},{max:100}),
    listAll(github,'GET /repos/{owner}/{repo}/hooks',common,{max:100}),
    // These are not V-1 scenario resources. A foreign milestone or deployment
    // would be erased with its parent repository; never silently consume it.
    listAll(github,'GET /repos/{owner}/{repo}/milestones',{...common,state:'all'},{max:100}),
    listAll(github,'GET /repos/{owner}/{repo}/deployments',common,{max:100}),
    github.request('GET /repos/{owner}/{repo}/environments',common),
    listAll(github,'GET /repos/{owner}/{repo}/labels',common,{max:100}),
    github.request('GET /repos/{owner}/{repo}/actions/runs',common),
    github.request('GET /repos/{owner}/{repo}/actions/artifacts',common),
    github.request('GET /repos/{owner}/{repo}/actions/workflows',common)
  ]);
  const inventories=[branches,pulls,issues,tags,releases,rulesets,hooks,milestones,deployments,labels];
  if(inventories.some(x=>x.capped||!Array.isArray(x.items)))
    throw refusal('Scratch inventory is incomplete; repository deletion refused.');
  if(milestones.items.length||deployments.items.length)
    throw refusal('Scratch repository has foreign milestones or deployments; deletion refused.');
  // Environment records can own secrets, deployment rules and reviewers. V-1
  // never creates an environment, so the only admissible exact inventory is
  // an independently returned empty array and authoritative total_count=0.
  const env=environments?.data;
  if(env?.total_count!==0||!Array.isArray(env?.environments)||env.environments.length!==0)
    throw refusal('Scratch repository has foreign or unverified deployment environments; deletion refused.');
  // V-1 creates workflow definitions but does not dispatch real CI.
  // Repository deletion would silently erase unjournaled runs, logs and
  // artifacts. An exact zero count AND empty response is required; a denied,
  // missing or inconsistent inventory cannot be interpreted as empty.
  const actions=workflowRuns?.data,stored=artifacts?.data;
  if(actions?.total_count!==0||!Array.isArray(actions?.workflow_runs)||
    actions.workflow_runs.length!==0||stored?.total_count!==0||
    !Array.isArray(stored?.artifacts)||stored.artifacts.length!==0)
    throw refusal('Scratch repository has foreign or unverified Actions runs or artifacts; deletion refused.');
  const trackedWorkflows=objects.filter(x=>x.object_type==='workflow_file');
  const definitions=workflows?.data;
  if(!Array.isArray(definitions?.workflows)||
    definitions.total_count!==definitions.workflows.length||
    definitions.workflows.length!==trackedWorkflows.length)
    throw refusal('The scratch Actions workflow inventory does not match the run journal.');
  const workflowIds=new Set();
  for(const w of definitions.workflows) {
    if(!Number.isSafeInteger(w?.id)||w.id<1||workflowIds.has(w.id)||
      w.state!=='active'||typeof w.path!=='string'||
      trackedWorkflows.filter(o=>o.owner.toLowerCase()===owner.toLowerCase()&&
        o.repo===repo&&o.object_id===w.path&&
        o.object_id===`.github/workflows/rtc-${run.id}.yml`&&
        /^[a-f0-9]{40}$/.test(o.created_sha??'')).length!==1)
      throw refusal('A foreign or changed Actions workflow exists in the scratch repository.');
    workflowIds.add(w.id);
  }
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
  // A run marker is not authority over future default-branch commits. #102
  // journals the original exact commit, and only the single run-owned workflow
  // mutation is permitted to advance the default branch after creation.
  const roots=objects.filter(o=>o.object_type==='repo'&&o.owner.toLowerCase()===owner.toLowerCase()&&
    o.repo===repo&&o.object_id.toLowerCase()===`${owner}/${repo}`.toLowerCase());
  const workflow=objects.filter(o=>o.object_type==='workflow_file');
  const recorded=(o)=>/^[a-f0-9]{40}$/.test(o?.created_sha??'');
  if(roots.length!==1||!recorded(roots[0])||workflow.length>1||
    workflow.some(o=>o.repo!==repo||o.owner.toLowerCase()!==owner.toLowerCase()||
      o.object_id!==`.github/workflows/rtc-${run.id}.yml`||!recorded(o)))
    throw refusal('The scratch default-branch commit lacks exact origin/workflow journal evidence.');
  const expectedDefault=workflow[0]?.created_sha??roots[0].created_sha;
  const defaults=branches.items.filter(x=>x?.name===defaultBranch);
  if(defaults.length!==1||defaults[0].commit?.sha!==expectedDefault)
    throw refusal('The scratch default branch moved outside its recorded run-owned commits. Deletion refused.');
  for(const b of branches.items) {
    if(b?.name===defaultBranch)continue;
    if(typeof b?.name!=='string'||!b.name.startsWith(`rtc/${run.id}/`)||
      !owns('branch',b.name)||b.commit?.sha!==branchTip.get(b.name))
      throw refusal('An unrecorded or changed branch exists in the scratch repository. Deletion refused.');
  }
  const numbers=new Set(),verifiedPulls=[];
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
    // A third-party formal review is a distinct GitHub resource: the inline
    // comment journal never authorizes silently destroying review decisions.
    // V-1 creates inline comments, not submitted pull-request reviews.
    const {items:formalReviews,capped:reviewsCapped}=await listAll(github,
      'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
      {owner,repo,pull_number:p.number,per_page:100},{max:100});
    if(reviewsCapped||formalReviews.length!==0)
      throw refusal('Scratch PR has submitted reviews or incomplete review inventory; deletion refused.');
    verifiedPulls.push({number:p.number,state:p.state,body:p.body,
      head_ref:head,head_sha:p.head.sha,base_ref:base});
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
  await inspectScratchComments(github,{owner,repo,run,objects});
  // V-4 test webhooks are the only webhooks a scratch run may hold. Each live hook must be one the run recorded by exact
  // ID; any other (an app, a person, a look-alike) is never destroyed with its parent repository.
  const hookIds=new Set();
  for(const hook of hooks.items) {
    const saved=objects.filter(x=>x.object_type==='webhook'&&x.object_id===String(hook?.id)&&
      x.owner.toLowerCase()===owner.toLowerCase()&&x.repo===repo);
    if(!Number.isSafeInteger(hook?.id)||hook.id<=0||hookIds.has(hook.id)||saved.length!==1||hook.type!=='Repository')
      throw refusal('An unrecorded or foreign repository webhook exists in the scratch repository. Deletion refused.');
    hookIds.add(hook.id);
  }
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
  // A recorded run label or PR-label association can be reused or stripped
  // independently of the PR's immutable head. Verify their exact live forms
  // before a whole-repository delete, rather than trusting journal IDs alone.
  const savedLabels=objects.filter(x=>x.object_type==='label');
  // Confirmed disposal covers the exact unchanged first-create label baseline;
  // it does not assert label creator provenance or authorize standalone deletion.
  const baseline=baselineScratchLabels({run,objects,intents,birth,owner,repo,
    labels:labels.items,savedLabels});
  const listedLabels=new Set();
  for(const label of labels.items){
    const name=label?.name;
    if(typeof name!=='string'||!name||listedLabels.has(name)||
      !baseline.has(name)&&savedLabels.filter(x=>x.object_id===name&&x.repo===repo&&
        x.owner.toLowerCase()===owner.toLowerCase()).length!==1)
      throw refusal('Scratch repository contains an unrecorded or ambiguous label; deletion refused.');
    listedLabels.add(name);
  }
  if(listedLabels.size!==savedLabels.length+baseline.size||
    savedLabels.some(x=>!listedLabels.has(x.object_id)))
    throw refusal('The recorded scratch labels do not match the complete live label inventory.');
  for(const label of savedLabels) {
    const name=label.object_id;
    if(label.repo!==repo||label.owner.toLowerCase()!==owner.toLowerCase()||
      (name!=='rtc-run'&&name!==`rtc-run-${run.id}`))
      throw refusal('A recorded scratch label is not exact run-owned metadata.');
    const live=(await github.request('GET /repos/{owner}/{repo}/labels/{name}',{owner,repo,name})).data;
    if(live?.name!==name||live.description!==`rtc_run=${run.id}`||
      String(live.color??'').toLowerCase()!=='0969da')
      throw refusal('A recorded scratch label was repurposed; deletion refused.');
  }
  for(const relation of objects.filter(x=>x.object_type==='pr_label')) {
    const match=/^([1-9][0-9]*):(rtc-run(?:-[a-z0-9-]+)?)$/.exec(relation.object_id??'');
    const n=Number(match?.[1]),name=match?.[2];
    if(relation.repo!==repo||relation.owner.toLowerCase()!==owner.toLowerCase()||
      !Number.isSafeInteger(n)||!numbers.has(n)||
      !savedLabels.some(x=>x.object_id===name))
      throw refusal('A recorded scratch PR label has no exact run-owned PR and label.');
    const linked=(await github.request('GET /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}',{
      owner,repo,issue_number:n,name
    })).data;
    if(linked?.name!==name)
      throw refusal('An exact recorded scratch PR-label association disappeared; deletion refused.');
  }
  // Independently prove that every *recorded* resource remains in the full
  // inventory. The earlier checks prove listed -> journal; this verifies the
  // reverse direction. Missing run resources can indicate foreign deletion,
  // stale journal data or incomplete remote pagination; none authorizes DELETE.
  assertScratchJournalCoverage({owner,repo,objects,live:{
    branch:branches.items.filter(x=>x.name!==defaultBranch).map(x=>x.name),
    pr:pulls.items.map(x=>String(x.number)),
    issue:issues.items.filter(x=>!x.pull_request).map(x=>String(x.number)),
    tag:tags.items.map(x=>x.name),
    release:releases.items.map(x=>String(x.id)),
    ruleset:rulesets.items.map(x=>String(x.id)),
    webhook:hooks.items.map(x=>String(x.id))
  }});
  return {branch_count:branches.items.length,pr_count:pulls.items.length,issue_count:issues.items.length,tag_count:tags.items.length,release_count:releases.items.length,
    ruleset_count:rulesets.items.length,webhook_count:hooks.items.length,milestone_count:0,
    deployment_count:0,environment_count:0,action_run_count:0,artifact_count:0,workflow_count:workflowIds.size,label_count:listedLabels.size,verified_pulls:verifiedPulls};
}

export async function readCleanupRun(ctx,owner,repo,runId) {
  const connection=ctx.connection.client_id, db=ctx.db;
  const run=await db.getDevRun({id:runId,account:owner,connection});
  if(!run)throw refusal('That development run does not belong to this connection.');
  const [objects,intents,birth]=await Promise.all([
    db.listDevObjects({runId,account:owner,connection,limit:50}),
    db.listDevIntents({runId,account:owner,connection,limit:50}),
    db.getDevBirthLabels({runId,account:owner,connection})
  ]);
  const plan=planDevCleanup({run,objects,intents});
  const root=objects.find(x=>x.object_type==='repo');
  if(root) {
    assertScenarioResourceBounds({run,objects,owner,repo});
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
  return {run,plan,objects,intents,birth,existing,deleteRepository:!!root};
}
export async function executeCleanup(ctx,{owner,repo,runId,before}) {
  return withCleanupExecution(ctx,{owner,runId},()=>executeExclusiveCleanup(ctx,{owner,repo,runId,before}));
}
async function executeExclusiveCleanup(ctx,{owner,repo,runId,before}) {
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
    const preflight=await inspectScratchArtifacts(github,{owner,repo,run:snapshot.run,objects:snapshot.objects,intents:snapshot.intents,birth:snapshot.birth,
      defaultBranch:live.default_branch});
    for(const item of snapshot.objects.filter(x=>x.object_type==='pr'&&!x.cleaned)){
      const number=Number(item.object_id);
      if(!Number.isSafeInteger(number)||number<=0)throw refusal('Invalid recorded pull-request number.');
      const pull=await getPull(github,owner,repo,number);
      const expected=preflight.verified_pulls.find(p=>p.number===number);
      // The individual pull GET immediately before a PATCH is a fresh trust
      // boundary. Refuse a retargeted, published or replaced PR even if the
      // earlier bounded list showed an exact run-owned draft.
      const exact=(candidate,state)=>candidate?.number===number&&
        candidate.merged!==true&&candidate.merged_at==null&&candidate.draft===true&&
        candidate.state===state&&candidate.body===expected?.body&&
        candidate.head?.ref===expected?.head_ref&&candidate.head?.sha===expected?.head_sha&&
        candidate.base?.ref===expected?.base_ref&&
        equal(candidate.head?.repo?.full_name,`${owner}/${repo}`)&&
        equal(candidate.base?.repo?.full_name,`${owner}/${repo}`);
      if(!expected||!exact(pull,expected.state))
        throw refusal(`PR #${number} changed since the independently verified scratch inventory; cleanup stopped.`);
      if(pull.state==='open') {
        await github.request('PATCH /repos/{owner}/{repo}/pulls/{pull_number}',{
          owner,repo,pull_number:number,state:'closed'
        });
      } else if(pull.state!=='closed') throw refusal('Unknown pull-request state.');
      const after=await getPull(github,owner,repo,number);
      if(!exact(after,'closed'))
        throw refusal('The exact PR closure or immutable run identity could not be verified; cleanup stopped.');
    }
    // No other repo is eligible: exact verified private full_name and marker are checked again.
    const latest=await getRepo(github,owner,repo);
    requireExactScratchRepo(latest,snapshot.run,owner,repo);
    if(!latest)throw refusal('The scratch repository disappeared before deletion; inspect the run.');
    await inspectScratchArtifacts(github,{owner,repo,run:snapshot.run,objects:snapshot.objects,intents:snapshot.intents,birth:snapshot.birth,
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
