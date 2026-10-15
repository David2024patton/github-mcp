import {describe,it,expect} from 'vitest';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {createGates} from '../../src/tools/gates.js';
import {registry} from '../../src/tools/index.js';
import {composeProjectDraft,STANDARD_PROJECT_LABELS} from '../../src/data/project-draft.js';
import {planProjectSetup,tools,handlers} from '../../src/tools/project-setup.js';

const input={
  id:'new-product',name:'New Product',owner:'example-org',repo:'new-product',
  description:'Synthetic new software project',visibility:'private',
  requiredChecks:['ci'],productionBranch:'live',environments:['staging'],
  findings:{workflows:[{file:'ci.yml',maxPermissions:{contents:'read'},
    forbiddenTriggers:['pull_request_target'],ownsWrites:false}],
    sourceSha:null}
};
const REPO='GET /repos/{owner}/{repo}';
const RULES='GET /repos/{owner}/{repo}/rulesets';
const DETAIL='GET /repos/{owner}/{repo}/rulesets/{ruleset_id}';
const LABELS='GET /repos/{owner}/{repo}/labels';
const ENV='GET /repos/{owner}/{repo}/environments/{environment_name}';
const profile=()=>composeProjectDraft(input,Date.parse('2026-10-15T00:00:00Z'));
const state=(overrides={})=>({
  full_name:'example-org/new-product',private:true,visibility:'private',
  size:0,allow_merge_commit:true,archived:false,disabled:false,
  security_and_analysis:{secret_scanning:{status:'enabled'},
    secret_scanning_push_protection:{status:'enabled'}},...overrides
});
const ruleset=(p)=>({
  id:12,name:'project-setup-new-product',target:'branch',enforcement:'active',
  conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}},
  rules:[{type:'required_status_checks',parameters:{
    required_status_checks:p.requiredChecks.map(context=>({context}))}},
    {type:'non_fast_forward'},{type:'deletion'}],
  bypass_actors:[]
});
const fakeRule=(w,r)=>{w.gh.when(RULES).reply(200,[{id:12,name:r.name}]);
  w.gh.when(DETAIL).reply(200,r);};
const fakeLabels=(w)=>w.gh.when(LABELS).reply(200,STANDARD_PROJECT_LABELS);
const call=async(w,args)=>{
  const dispatch=createDispatch({env:w.ctx.env,credentials:w.credentials,
    fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:createGates()});
  return parse(await dispatch({registry,name:'github_workflow_project_setup',args,
    connection:w.connection,db:w.db}));
};

describe('P-3 pure draft contract and source-evidence discipline',()=>{
  it('returns a validated, explicitly inactive draft and human owner checklist',()=>{
    const x=profile();
    expect(x.profile.id).toBe('new-product');
    expect(x.profile.status).toBe('draft');
    expect(x.profile.source.verifiedMainSha).toBeNull();
    expect(x.profile.requiredChecks).toEqual(['ci']);
    expect(x.profile.productionBranches).toEqual(['live']);
    expect(x.review.join(' ')).toMatch(/source SHA|production branch/i);
    expect(x.doc).toContain('DRAFT');
    expect(x.doc).toContain('Do not commit this draft');
  });
  it('reports unknown evidence fields and malformed/duplicated inputs instead of guessing',()=>{
    for(const changes of [
      {findings:{secrets:'unsafe'}},
      {findings:{sourceSha:'abc'}},
      {productionBranch:'bad branch'},
      {requiredChecks:['ci','ci']},
      {repo:'../other'},
      {secret:'do-not-store'}
    ])expect(()=>composeProjectDraft({...input,...changes})).toThrow();
  });
  it('pure github_profile_draft never reaches GitHub or persists a profile',async()=>{
    const w=await makeWorld({profile:'full'});
    const result=await handlers.github_profile_draft(input,w.ctx);
    expect(result.read_only).toBe(true);
    expect(result.profile.status).toBe('draft');
    expect(w.gh.calls).toHaveLength(0);
    expect(await w.db.getKnownProject('new-product')).toBeNull();
    expect(tools.map(x=>x.name)).toEqual([
      'github_profile_draft','github_workflow_project_setup']);
    for(const x of tools)expect(registry.tools.some(y=>y.name===x.name)).toBe(true);
  });
  it('creates a draft only when explicitly approved, then preserves it through reseeding and conflicts',async()=>{
    const w=await makeWorld({profile:'full'});
    w.gh.when(REPO).reply(404,{message:'Not Found'});
    const preview=await call(w,input);
    expect(preview.status).toBe('preview');
    expect(await w.db.getKnownProject('new-product')).toBeNull();
    expect(w.gh.calls.every(c=>c.method==='GET')).toBe(true);
    const done=await call(w,{...input,confirm:true});
    expect(done.status).toBe('draft_saved');
    expect((await w.db.getKnownProject('new-product')).profile.status).toBe('draft');
    await w.db.initSchema();
    expect((await w.db.getKnownProject('new-product')).version).toBe(1);
    expect(await w.db.createKnownProject(profile().profile)).toBeNull();
  });
  it('refuses takeover of a nonempty unprofiled repository BEFORE saving a draft',async()=>{
    const w=await makeWorld({profile:'full'});
    w.gh.when(REPO).reply(200,state({size:20}));
    const x=await call(w,{...input,confirm:true});
    expect(x.stage).toBe('needs_owner_review');
    expect(await w.db.getKnownProject('new-product')).toBeNull();
    expect(w.gh.calls.filter(c=>c.method!=='GET')).toHaveLength(0);
  });
  it('never lets an unconnected account create even a profile draft checkpoint',async()=>{
    const w=await makeWorld({profile:'full'});
    const x=await call(w,{...input,owner:'outsider',confirm:true});
    expect(x.status).toBe('refused');
    expect(w.gh.calls).toHaveLength(0);
  });
});

describe('P-3 resumed desired-state setup and guarded actions',()=>{
  it('plans repo creation from a durable draft and does not write a README or other file',async()=>{
    const w=await makeWorld({profile:'full'});
    await w.db.createKnownProject(profile().profile);
    w.gh.when(REPO).reply(404,{message:'Not Found'});
    const plan=await planProjectSetup(w.ctx,profile(),
      await w.db.getKnownProject('new-product'));
    expect(plan.status).toBe('change');
    expect(plan.tool).toBe('github_repo_create');
    expect(plan.args).toMatchObject({owner:'example-org',name:'new-product',
      auto_init:false,visibility:'private'});
    expect(w.gh.calls.filter(q=>q.method!=='GET')).toHaveLength(0);
  });
  it('plans merge fix and an exact, no-bypass required-checks ruleset',async()=>{
    const w=await makeWorld({profile:'full'});
    await w.db.createKnownProject(profile().profile);
    w.gh.when(REPO).reply(200,state({allow_merge_commit:false}));
    let result=await planProjectSetup(w.ctx,profile(),await w.db.getKnownProject('new-product'));
    expect(result.tool).toBe('github_repo_update_settings');
    expect(result.args).toMatchObject({allow_merge_commit:true});
    w.gh.when(REPO).reply(200,state());
    w.gh.when(RULES).reply(200,[]);
    result=await planProjectSetup(w.ctx,profile(),await w.db.getKnownProject('new-product'));
    expect(result.tool).toBe('github_ruleset_save');
    expect(result.args.rules.map(r=>r.type))
      .toEqual(['required_status_checks','non_fast_forward','deletion']);
    expect(result.args.rules[0].parameters.required_status_checks)
      .toEqual([{context:'ci'}]);
    expect(result.args).not.toHaveProperty('bypassActors');
    expect(w.gh.calls.filter(q=>q.method!=='GET')).toHaveLength(0);
  });
  it('selects missing labels before missing environments and never overwrites existing labels',async()=>{
    const w=await makeWorld({profile:'full'});
    await w.db.createKnownProject(profile().profile);
    w.gh.when(REPO).reply(200,state());
    fakeRule(w,ruleset(profile().profile));
    w.gh.when(LABELS).reply(200,[]);
    let result=await planProjectSetup(w.ctx,profile(),await w.db.getKnownProject('new-product'));
    expect(result.tool).toBe('github_label_save');
    expect(result.args.name).toBe('bug');
    fakeLabels(w);
    w.gh.when(ENV).reply(404,{message:'Not Found'});
    result=await planProjectSetup(w.ctx,profile(),await w.db.getKnownProject('new-product'));
    expect(result.tool).toBe('github_env_save');
    expect(result.args).toMatchObject({environment:'staging',waitTimer:0});
  });
  it('conservatively separates paid private scanning, protected production env and completed draft',async()=>{
    const w=await makeWorld({profile:'full'});
    await w.db.createKnownProject(profile().profile);
    fakeRule(w,ruleset(profile().profile));
    fakeLabels(w);
    w.gh.when(REPO).reply(200,state({
      security_and_analysis:{secret_scanning:{status:'disabled'},
        secret_scanning_push_protection:{status:'enabled'}}}));
    w.gh.when(ENV).reply(200,{name:'staging'});
    let result=await planProjectSetup(w.ctx,profile(),await w.db.getKnownProject('new-product'));
    expect(result.status).toBe('needs_owner_review');
    expect(result.detail).toMatch(/pricing|cost|Private/i);
    w.gh.when(REPO).reply(200,state());
    result=await planProjectSetup(w.ctx,profile(),await w.db.getKnownProject('new-product'));
    expect(result.status).toBe('complete');
    const prodSpec={...input,environments:['production']};
    const prodDraft=composeProjectDraft(prodSpec,Date.parse('2026-10-15T00:00:00Z'));
    w.gh.when(ENV).reply(404,{message:'Not Found'});
    result=await planProjectSetup(w.ctx,prodDraft,await w.db.getKnownProject('new-product'));
    expect(result.status).toBe('needs_owner_review');
    expect(result.detail).toContain('branch policy');
  });
});
