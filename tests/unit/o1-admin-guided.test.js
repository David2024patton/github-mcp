import {describe,it,expect} from 'vitest';
import {SETTINGS,fill} from '../../src/data/dashboard-map.js';
import {makeWorld} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';

const routes={
  org:'GET /orgs/{org}',
  owners:'GET /orgs/{org}/members',
  outside:'GET /orgs/{org}/outside_collaborators',
  invitations:'GET /orgs/{org}/invitations',
  repos:'GET /orgs/{org}/repos',
  repo:'GET /repos/{owner}/{repo}',
  policy:'GET /repos/{owner}/{repo}/actions/permissions/workflow',
  keys:'GET /repos/{owner}/{repo}/keys',
  apps:'GET /orgs/{org}/installations',
  pats:'GET /orgs/{org}/personal-access-token-requests'
};
const org=(twoFactor=true)=>({
  login:'example-org',name:'Example Org',description:'A safe test org',
  two_factor_requirement_enabled:twoFactor,default_repository_permission:'read',
  plan:{name:'free'}});
const fakeRepo=(secret='enabled')=>({
  id:42,name:'hello',full_name:'example-org/hello',private:false,
  security_and_analysis:{
    secret_scanning:{status:secret},
    secret_scanning_push_protection:{status:'enabled'},
    dependabot_security_updates:{status:'enabled'}}});
function arrange(w,opts={}){
  w.gh.when(routes.org).reply(200,org(opts.twoFactor??true));
  w.gh.when(routes.owners).reply(200,[{login:'example-owner',id:1}]);
  w.gh.when(routes.outside).reply(200,opts.outside?[{login:'outsider'}]:[]);
  w.gh.when(routes.invitations).reply(200,[]);
  w.gh.when(routes.repos).reply(200,[fakeRepo()]);
  w.gh.when(routes.repo).reply(200,fakeRepo(opts.scanning??'enabled'));
  w.gh.when(routes.policy).reply(200,{default_workflow_permissions:opts.token??'read',
    can_approve_pull_request_reviews:false});
  w.gh.when(routes.keys).reply(200,opts.writeKey?[{id:7,read_only:false}]:[]);
  w.gh.when(routes.apps).reply(200,{total_count:0,installations:[]});
  w.gh.when(routes.pats).reply(200,[]);
}
async function call(w,name,args={}){
  const dispatch=createDispatch({credentials:w.credentials,env:w.ctx.env,
    fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:[]});
  const r=await dispatch({registry,name,args,connection:w.connection,db:w.db});
  return r.structuredContent??(r.isError?{error:r.content?.[0]?.text}:
    JSON.parse(r.content[0].text));
}
describe('O-1 full guided GitHub settings inventory and verification',()=>{
  it('covers repository, org and user pages with unique IDs, actionable steps and clear incomplete status',()=>{
    const ids=new Set();
    for(const s of SETTINGS){
      expect(ids.has(s.id),s.id).toBe(false);ids.add(s.id);
      expect(s.url).toMatch(/^https:\/\/github.com\//);
      expect(s.steps.length).toBeGreaterThan(0);
      expect(['repo','org','user']).toContain(s.scope);
      expect(s.expected).toBeTruthy();
      expect(s.verifyWith?.tool==='github_org_get').toBe(false);
    }
    for(const scope of ['repo','org','user'])
      expect(SETTINGS.filter(x=>x.scope===scope).length).toBeGreaterThanOrEqual(15);
  });
  it('finds repository Actions and substitutes org/repo deeply without claiming UI completion',async()=>{
    const w=await makeWorld({profile:'read_only'});
    const guides=await call(w,'github_admin_list_guided_settings',{
      scope:'repo',owner:'example-org',repo:'hello',query:'Actions',max:20});
    expect(guides.settings.length).toBeGreaterThan(0);
    expect(guides.settings.some(x=>x.url.includes('/example-org/hello/settings'))).toBe(true);
    expect(guides.settings.every(x=>x.status===(x.verification?'can_check_with_provider':'manual_confirmation_required'))).toBe(true);
    const where=await call(w,'github_where_is_setting',{
      query:'deploy keys',org:'example-org',repo:'hello',detail:'full'});
    expect(where.settings.some(x=>x.url.endsWith('/hello/settings/keys'))).toBe(true);
    expect(w.gh.calls).toHaveLength(0);
    expect(fill({url:'{org}/{repo}',steps:['{user}/{repo}']},{
      org:'example-org',user:'owner',repo:'hello'}))
      .toEqual({url:'example-org/hello',steps:['owner/hello']});
  });
  it('paginates the entire approved guide inventory without dropping pages',async()=>{
    const w=await makeWorld({profile:'read_only'});
    const all=[];
    for(let i=0;i<3;i++){
      const page=await call(w,'github_admin_list_guided_settings',{
        scope:'org',max:20,offset:i*20});
      all.push(...page.settings.map(x=>x.id));
    }
    const unique=new Set(all);
    expect(unique.size).toBe(all.length);
    expect(unique.size).toBeGreaterThan(20);
  });
  it('independently verifies organization 2FA and refuses to infer provider-disabled status',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when(routes.org).reply(200,org(false));
    const r=await call(w,'github_admin_check_setting',{
      owner:'example-org',settingId:'org-require-2fa',expectedBoolean:true});
    expect(r).toMatchObject({verified:false,status:'differs',observed:false,expected:true});
    const noApi=await call(w,'github_admin_check_setting',{
      settingId:'user-password'});
    expect(noApi).toMatchObject({verified:false,status:'not_readable'});
    expect(w.gh.invalid).toEqual([]);
  });
  it('cannot read outside enrolled account or turn browser navigation into verified completion',async()=>{
    const w=await makeWorld({profile:'read_only'});
    const bad=await call(w,'github_admin_check_setting',{
      owner:'outsider',settingId:'org-require-2fa',expectedBoolean:true});
    expect(bad.verified).not.toBe(true);
    const guided=await call(w,'github_admin_check_setting',{
      owner:'example-org',settingId:'org-page-billing'});
    expect(guided).toMatchObject({verified:false,status:'manual_confirmation_required'});
    expect(w.gh.calls).toHaveLength(0);
  });
});
describe('O-1 actual owner and security overview',()=>{
  it('categorizes verified service, organization and security state without a false all-clear',async()=>{
    const w=await makeWorld({profile:'read_only'});
    arrange(w);
    const r=await call(w,'github_admin_overview',{maxRepositories:10});
    expect(r.owner).toBe('example-org');
    expect(r.server).toMatchObject({production_enabled:false,spend_limit_cents:0});
    expect(r.checks.find(c=>c.id==='require-2fa')).toMatchObject({status:'ok'});
    expect(r.checks.find(c=>c.id==='security-feature-coverage')).toMatchObject({status:'ok'});
    expect(r.checks.find(c=>c.id==='actions-token-rights')).toMatchObject({status:'ok'});
    expect(r.checks.find(c=>c.id==='billing-usage')).toMatchObject({status:'not_readable'});
    expect(r.checks.find(c=>c.id==='sso')).toMatchObject({status:'not_available_on_plan'});
    expect(r.repo_inventory_complete).toBe(true);
    expect(w.gh.invalid).toEqual([]);
    expect(w.gh.calls.filter(c=>c.method!=='GET')).toHaveLength(0);
  });
  it('identifies missing 2FA, scanning and write-capable keys as attention, not permission denial',async()=>{
    const w=await makeWorld({profile:'read_only'});
    arrange(w,{twoFactor:false,scanning:'disabled',token:'write',writeKey:true});
    const r=await call(w,'github_admin_review_security',{maxRepositories:10});
    expect(r.summary.needs_attention).toBeGreaterThanOrEqual(3);
    expect(r.priority_actions.some(x=>x.check==='security-feature-coverage')).toBe(true);
    expect(r.priority_actions.some(x=>x.check==='write-capable-deploy-keys')).toBe(true);
    expect(r.checks.find(x=>x.id==='actions-token-rights')).toMatchObject({status:'needs_attention'});
    expect(w.gh.invalid).toEqual([]);
  });
  it('keeps GitHub API refusal as not_readable without fabricating complete coverage',async()=>{
    const w=await makeWorld({profile:'read_only'});
    arrange(w);
    w.gh.when(routes.keys).reply(403,{message:'Resource not accessible'});
    const r=await call(w,'github_admin_overview',{maxRepositories:10});
    expect(r.checks.find(x=>x.id==='write-capable-deploy-keys')).toMatchObject({
      status:'not_readable'});
    expect(r.summary.not_readable).toBeGreaterThan(0);
    expect(w.gh.calls.filter(c=>c.method!=='GET')).toHaveLength(0);
  });
});
