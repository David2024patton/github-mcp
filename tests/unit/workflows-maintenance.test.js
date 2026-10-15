import {describe,it,expect} from 'vitest';
import {registry} from '../../src/tools/index.js';
import {validateArgs} from '../../src/core/validate.js';
import {repoHealth,securityReview,accessReview} from '../../src/tools/workflows-health.js';
import {release,cleanup,nextVersion} from '../../src/tools/workflows-release.js';
import {makeWorld,doorsFor,parse} from '../../test/helpers/write-contract.js';
import * as branches from '../../src/tools/branches.js';
import * as releases from '../../src/tools/releases-write.js';
const A='a'.repeat(40),B='b'.repeat(40),owner='example-org',repo='hello';
const wrapped=v=>({structuredContent:v,content:[{type:'text',text:JSON.stringify(v)}]});
function world(extra={}){
  let clock=Date.parse('2026-10-15T12:00:00Z');const calls=[];
  const outputs={
    github_repo_get:{default_branch:'main'},github_repo_list:{items:[{name:repo}]},
    github_protection_get:{protected:true,classic_protection_readable:true},github_ruleset_list:{items:[],complete:true},
    github_actions_list_runs:{items:[]},github_pr_list:{items:[]},
    github_security_list_alerts:{items:[],complete:true},
    github_security_get_settings:{security_and_analysis:{secret_scanning:'enabled',secret_scanning_push_protection:'enabled',dependabot_security_updates:'enabled'}},
    github_actions_get_settings:{workflow:{default_workflow_permissions:'read'}},
    github_org_list_members:{members:[],outside_collaborators:[],complete:true},github_team_list:{teams:[],complete:true},
    github_app_list_installations:{installations:[],complete:true},github_tokenpolicy_list_tokens:{tokens:[],complete:true},github_tokenpolicy_list_requests:{requests:[],complete:true},
    github_collab_list:{collaborators:[],pending_invitations:[],complete:true},github_deploykey_list:{keys:[],complete:true},
    github_release_list:{items:[]},github_release_get:{not_found:'latest'},
    github_release_create:{status:'preview'},github_release_update:{status:'preview'},
    github_branch_list:{items:[{name:'feature',protected:false,commit:{sha:A}}]},
    github_branch_get:{head:A,protected:false,rules:[]},github_branch_delete:{status:'preview'},...extra
  };
  const c={connection:{accounts:[owner],default_account:owner,profile:'full',mode:'preview'},now:()=>clock,
    db:{profileForRepository:async()=>null,getSetting:async()=>null},callTool:async(name,args)=>{
      const tool=registry.tools.find(x=>x.name===name);expect(tool,name).toBeDefined();expect(validateArgs(tool.inputSchema,args),name).toBeNull();
      calls.push({name,args});const value=typeof outputs[name]==='function'?await outputs[name](args,calls):outputs[name];
      if(value?.isError)return value;return wrapped(value);
    }};
  return {c,calls,outputs,advance:ms=>{clock+=ms;}};
}
const run=(fn,args,w)=>fn({repo,...args},w.c);
const data=x=>x.structuredContent;
const mutations=w=>w.calls.filter(x=>['github_release_create','github_release_update','github_branch_delete'].includes(x.name));
describe('W-5 complete bounded read reviews',()=>{
  it('reports normal/empty health without changing policy',async()=>{
    const w=world(),r=await run(repoHealth,{},w);expect(r.complete).toBe(true);expect(r.ci.pass_rate).toBeNull();expect(r.findings).toEqual([]);expect(mutations(w)).toEqual([]);
  });
  it('computes CI pass rate and stale PRs from full objects',async()=>{
    const w=world({github_actions_list_runs:{items:[{status:'completed',conclusion:'success'},{status:'completed',conclusion:'failure'},{status:'in_progress'}]},github_pr_list:{items:[{number:4,updated_at:'2026-01-01T00:00:00Z'}]}});
    const r=await run(repoHealth,{},w);expect(r.ci.pass_rate).toBe(.5);expect(r.open_prs.stale[0].number).toBe(4);expect(r.status).toBe('needs_attention');
  });
  it('keeps plan denial and missing classic protection distinct from clean',async()=>{
    const w=world({github_protection_get:{isError:true,content:[{type:'text',text:'HTTP403 Upgrade to GitHub Pro'}]}});
    const r=await run(repoHealth,{},w);expect(r.complete).toBe(false);expect(r.evidence.find(x=>x.id==='default-protection').status).toBe('not_available_on_plan');expect(r.security_features).not.toBeNull();
  });
  it('reports alert severity/bypasses and disabled features across two repositories',async()=>{
    const w=world({github_repo_list:{items:[{name:repo},{name:'second'}]},github_security_list_alerts:a=>({complete:true,items:[{number:1,state:'open',severity:a.kind==='dependabot'?'critical':null,push_protection_bypassed:a.kind==='secret'}]}),github_security_get_settings:{security_and_analysis:{secret_scanning:'disabled',secret_scanning_push_protection:null,dependabot_security_updates:'enabled'}}});
    const r=await securityReview({},w.c);expect(r.repositories).toHaveLength(2);expect(r.repositories[0].severity.critical).toBe(1);expect(r.repositories[0].inventories[2].push_protection_bypasses).toHaveLength(1);expect(r.complete).toBe(false);expect(mutations(w)).toEqual([]);
  });
  it('includes resolved bypasses while preserving unknown provider fields',async()=>{
    const w=world({github_security_list_alerts:a=>({complete:true,items:a.kind==='secret'?[{number:1,state:'resolved',push_protection_bypassed:true},{number:2,state:'open',push_protection_bypassed:null}]:[]})});
    const r=await run(securityReview,{},w),secret=r.repositories[0].inventories[2];
    expect(secret.count).toBe(1);expect(secret.push_protection_bypasses[0].number).toBe(1);expect(secret.unknown_bypass_fields).toBe(1);expect(r.complete).toBe(false);
    expect(w.calls.find(x=>x.name==='github_security_list_alerts'&&x.args.kind==='secret').args.state).toBeUndefined();
  });
  it('retains capped inventory and denies foreign accounts before dispatch',async()=>{
    const w=world({github_repo_list:{items:[{name:repo}],more_exist:true}});expect((await securityReview({},w.c)).complete).toBe(false);
    await expect(securityReview({owner:'foreign'},w.c)).rejects.toThrow(/not enrolled/);
  });
  it('flags outside/admin/write-key/app/token exposure without inventing unauthorized intent',async()=>{
    const w=world({github_org_list_members:{outside_collaborators:[{login:'guest'}],complete:true},github_collab_list:{collaborators:[{login:'a',role_name:'admin'},{login:'b',permissions:{admin:true}}],pending_invitations:[{id:1}],complete:true},github_deploykey_list:{keys:[{id:2,read_only:false}],complete:true},github_app_list_installations:{installations:[{id:3,repository_selection:'all'}],complete:true},github_tokenpolicy_list_tokens:{tokens:[{id:4}],complete:true}});
    const r=await run(accessReview,{},w);expect(r.findings).toHaveLength(6);expect(mutations(w)).toEqual([]);
  });
  it.each([repoHealth,securityReview,accessReview])('stops each read workflow at the time budget and reports partial',async fn=>{
    const w=world({github_repo_get:()=>{w.advance(47000);return {default_branch:'main'};},github_repo_list:()=>{w.advance(47000);return {items:[{name:repo}]};},github_org_list_members:()=>{w.advance(47000);return {complete:true};},github_security_list_alerts:()=>{w.advance(47000);return {items:[],complete:true};}});
    const r=await run(fn,{},w);expect(r.complete).toBe(false);expect(r.next).toMatch(/Resume/);expect(mutations(w)).toEqual([]);
  });
});
describe('W-6 staged release lifecycle',()=>{
  it('calculates stable versions but requires explicit target on execution',async()=>{
    expect(nextVersion('v1.2.3','minor')).toBe('v1.3.0');expect(nextVersion('1.2.3','major')).toBe('2.0.0');expect(nextVersion('v1.2.3-rc1','patch')).toBeNull();
    const w=world({github_release_get:{tag_name:'v1.2.3'}});
    expect(data(await run(release,{tag:'next-patch'},w)).tag).toBe('v1.2.4');
    expect(data(await run(release,{tag:'next-patch',confirm:true},w)).status).toBe('refused');expect(mutations(w)).toEqual([]);
  });
  it('creates only a draft, preserves explicit previous tag and pins recovery key',async()=>{
    const w=world({github_release_create:{status:'applied'}});
    expect(data(await run(release,{tag:'v2.0.0',from:'v1.0.0',confirm:true,requestKey:'release-intent'},w)).status).toBe('draft_created');
    expect(mutations(w)[0].args).toMatchObject({draft:true,previousTag:'v1.0.0',confirm:true});expect(mutations(w)).toHaveLength(1);
  });
  it('binds the stable child journal key to the actual default account',async()=>{
    const w=world();await run(release,{tag:'v2',requestKey:'same-intent'},w);const first=mutations(w)[0].args.requestKey;
    w.c.connection.default_account='another-org';await run(release,{tag:'v2',requestKey:'same-intent'},w);
    expect(mutations(w)[1].args.requestKey).not.toBe(first);
  });
  it('scans more than one release page and returns existing draft without duplicate',async()=>{
    const w=world({github_release_list:a=>a.page===1?{items:[],next_page_possible:2}:{items:[{id:42,tag_name:'v2.0.0'}]},github_release_get:{id:42,tag_name:'v2.0.0',draft:true}});
    expect(data(await run(release,{tag:'v2.0.0'},w)).status).toBe('draft_ready');expect(mutations(w)).toEqual([]);
  });
  it('refuses ambiguous/unreadable/incomplete inventory and never creates on publish',async()=>{
    for(const list of [{items:[],kept_result:{}},{items:[{id:1,tag_name:'v1'},{id:2,tag_name:'v1'}]}]){
      const w=world({github_release_list:list});expect(data(await run(release,{tag:'v1'},w)).status).toBe('refused');expect(mutations(w)).toEqual([]);
    }
    const w=world();expect(data(await run(release,{tag:'v1',publish:true,confirm:true},w)).status).toBe('refused');
  });
  it('requires exact draft ID, confirmation and independently observes publication',async()=>{
    let published=false;const w=world({github_release_list:{items:[{id:42,tag_name:'v2'}]},github_release_get:()=>({id:42,tag_name:'v2',draft:!published}),github_release_update:a=>{published=!a.dryRun;return {status:a.dryRun?'preview':'applied'};}});
    expect(data(await run(release,{tag:'v2',publish:true},w)).status).toBe('refused');
    expect(data(await run(release,{tag:'v2',publish:true,releaseId:42,requestKey:'publish',confirm:true},w)).status).toBe('published');
    expect(mutations(w)[0].args).toMatchObject({expectedTag:'v2',draft:false});
    expect(data(await run(release,{tag:'v2',publish:true,releaseId:42,requestKey:'publish',confirm:true},w)).status).toBe('already_published');expect(mutations(w)).toHaveLength(1);
  });
  it('stops on ambiguous publication and respects deadline/profile',async()=>{
    const w=world({github_release_list:{items:[{id:42,tag_name:'v2'}]},github_release_get:{id:42,tag_name:'v2',draft:true},github_release_update:{status:'uncertain'}});
    expect(data(await run(release,{tag:'v2',publish:true,releaseId:42,requestKey:'publish',confirm:true},w)).status).toBe('not_published');
    w.c.connection.profile='read_only';expect(data(await run(release,{tag:'v2'},w)).status).toBe('refused');
    const timed=world({github_release_list:()=>{timed.advance(47000);return {items:[],next_page_possible:2};}});expect(data(await run(release,{tag:'v2'},timed)).status).toBe('pending');expect(mutations(timed)).toEqual([]);
  });
});
const closed={number:4,state:'closed',head:{ref:'feature',sha:A,repo:{full_name:owner+'/'+repo}}};
describe('W-6 branch lifecycle proof',()=>{
  it('previews only an unchanged branch with a closed PR; no name guessing',async()=>{
    const w=world({github_pr_list:{items:[closed]}});const r=data(await run(cleanup,{},w));expect(r.status).toBe('preview');expect(mutations(w)[0].args).toMatchObject({expectedHeadSha:A,cleanupPrNumber:4,dryRun:true});
  });
  it.each([{...closed,state:'open'},{...closed,head:{...closed.head,sha:B}},{...closed,head:{...closed.head,repo:{full_name:'foreign/hello'}}}])('preserves open, advanced and fork branches',async pr=>{
    const w=world({github_pr_list:{items:[pr]}});await run(cleanup,{},w);expect(mutations(w)).toEqual([]);
  });
  it('never deletes default/protected/profile-owned/production/rules branches',async()=>{
    for(const kind of ['default','protected','owned','production','rules']){
      const w=world({github_pr_list:{items:[closed]}});
      if(kind==='default')w.outputs.github_repo_get={default_branch:'feature'};
      if(kind==='protected')w.outputs.github_branch_list.items[0].protected=true;
      if(kind==='owned')w.c.db.profileForRepository=async()=>({ownedRefs:[{pattern:'feature'}]});
      if(kind==='production')w.c.db.profileForRepository=async()=>({productionBranches:['feature']});
      if(kind==='rules')w.outputs.github_branch_get.rules=[{type:'deletion'}];
      await run(cleanup,{},w);expect(mutations(w),kind).toEqual([]);
    }
  });
  it('reports partial failure and leaves dependent deletions untouched',async()=>{
    const w=world({github_branch_list:{items:[{name:'feature',protected:false,commit:{sha:A}},{name:'other',protected:false,commit:{sha:A}}]},github_pr_list:{items:[closed]},github_branch_delete:{status:'uncertain'}});
    const r=data(await run(cleanup,{confirm:true,requestKey:'cleanup'},w));expect(r.status).toBe('stopped');expect(mutations(w)).toHaveLength(1);
  });
  it('refuses capped branch or PR inventories and exhausted time before writes',async()=>{
    const w=world({github_branch_list:{items:[],more_exist:true}});expect(data(await run(cleanup,{},w)).status).toBe('refused');
    const timed=world({github_branch_list:()=>{timed.advance(47000);return {items:[{name:'feature',protected:false,commit:{sha:A}}]};}});expect(data(await run(cleanup,{},timed)).status).toBe('pending');expect(mutations(timed)).toEqual([]);
  });
});
const def=(mod,name)=>({tool:mod.tools.find(x=>x.name===name),handler:mod.handlers[name]});
async function low(mod,name,w,args){return parse(await doorsFor(def(mod,name))[0].call(w,args));}
function cleanupProvider(w){
  w.gh.when('GET /repos/{owner}/{repo}').reply(200,{default_branch:'main'});
  w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200,{object:{sha:A}});
  w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200,{protected:false});
  w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200,[]);
  w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200,closed);
  w.gh.when('GET /repos/{owner}/{repo}/pulls').reply(200,[]);
}
describe('writer boundary request-shape and race regressions',()=>{
  it('rechecks branch head after confirmation immediately before DELETE',async()=>{
    const w=await makeWorld({mode:'production'});cleanupProvider(w);
    w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').replySequence([{status:200,body:{object:{sha:A}}},{status:200,body:{object:{sha:B}}}]);
    const r=await low(branches,'github_branch_delete',w,{repo,branch:'feature',expectedHeadSha:A,cleanupPrNumber:4,confirm:true});
    expect(r.status).not.toBe('applied');expect(w.gh.calls.some(x=>x.method==='DELETE')).toBe(false);expect(w.gh.invalid).toEqual([]);
  });
  it('deletes the proven exact branch once and independently confirms absence',async()=>{
    const w=await makeWorld({mode:'production'});cleanupProvider(w);
    w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').replySequence([
      ...[1,2,3].map(()=>({status:200,body:{object:{sha:A}}})),{status:404,body:{message:'Not Found'}}]);
    w.gh.when('DELETE /repos/{owner}/{repo}/git/refs/{ref}').reply(204,null);
    const r=await low(branches,'github_branch_delete',w,{repo,branch:'feature',expectedHeadSha:A,cleanupPrNumber:4,confirm:true});
    expect(r.status).toBe('applied');expect(w.gh.calls.filter(x=>x.method==='DELETE')).toHaveLength(1);expect(w.gh.invalid).toEqual([]);
  });
  it.each(['open','new-head','owned','rules'])('writer independently refuses %s cleanup despite confirmation',async kind=>{
    const w=await makeWorld({mode:'production'});cleanupProvider(w);
    if(kind==='open')w.gh.when('GET /repos/{owner}/{repo}/pulls').reply(200,[closed]);
    if(kind==='new-head')w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200,{...closed,head:{...closed.head,sha:B}});
    if(kind==='owned')w.db.profileForRepository=async()=>({ownedRefs:[{pattern:'feature'}]});
    if(kind==='rules')w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200,[{type:'deletion'}]);
    expect((await low(branches,'github_branch_delete',w,{repo,branch:'feature',expectedHeadSha:A,cleanupPrNumber:4,confirm:true})).status).not.toBe('applied');
    expect(w.gh.calls.some(x=>x.method==='DELETE')).toBe(false);expect(w.gh.invalid).toEqual([]);
  });
  it('refuses tag drift at guarded publication boundary',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when('GET /repos/{owner}/{repo}/releases/{release_id}').reply(200,{id:42,tag_name:'different',draft:true});
    expect((await low(releases,'github_release_update',w,{repo,releaseId:42,expectedTag:'v2',draft:false,confirm:true})).status).not.toBe('applied');
    expect(w.gh.calls.some(x=>x.method==='PATCH')).toBe(false);
  });
  it('builds notes with previous_tag_name and never forwards it to release creation',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    const draft={id:42,tag_name:'v2',name:'Generated',body:'Since previous',draft:true,prerelease:false};
    w.gh.when('GET /repos/{owner}/{repo}/releases/tags/{tag}').reply(404,{message:'Not Found'});
    w.gh.when('POST /repos/{owner}/{repo}/releases/generate-notes').reply(200,{name:draft.name,body:draft.body});
    w.gh.when('POST /repos/{owner}/{repo}/releases').reply(201,draft);
    w.gh.when('GET /repos/{owner}/{repo}/releases/{release_id}').reply(200,draft);
    const r=await low(releases,'github_release_create',w,{repo,tag:'v2',previousTag:'v1',confirm:true});expect(r.status).toBe('applied');
    expect(w.gh.calls.find(x=>x.route.endsWith('/generate-notes')).body.previous_tag_name).toBe('v1');
    const body=w.gh.calls.find(x=>x.route==='POST /repos/{owner}/{repo}/releases').body;
    expect(body).toMatchObject({draft:true,body:'Since previous',generate_release_notes:false});expect(body.previous_tag_name).toBeUndefined();expect(w.gh.invalid).toEqual([]);
  });
});
