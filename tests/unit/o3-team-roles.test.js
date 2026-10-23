import {describe,it,expect} from 'vitest';
import {makeWorld,runWriteContract,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import * as defs from '../../src/tools/team-role-write.js';

const R={
  teamList:'GET /orgs/{org}/teams',
  team:'GET /orgs/{org}/teams/{team_slug}',
  members:'GET /orgs/{org}/teams/{team_slug}/members',
  teamRepos:'GET /orgs/{org}/teams/{team_slug}/repos',
  save:'POST /orgs/{org}/teams',
  patch:'PATCH /orgs/{org}/teams/{team_slug}',
  delete:'DELETE /orgs/{org}/teams/{team_slug}',
  member:'GET /orgs/{org}/teams/{team_slug}/memberships/{username}',
  orgMember:'GET /orgs/{org}/memberships/{username}',
  memberSet:'PUT /orgs/{org}/teams/{team_slug}/memberships/{username}',
  memberDel:'DELETE /orgs/{org}/teams/{team_slug}/memberships/{username}',
  repo:'GET /repos/{owner}/{repo}',
  repoPut:'PUT /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}',
  repoDel:'DELETE /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}',
  roleList:'GET /orgs/{org}/organization-roles',
  roleUsers:'GET /orgs/{org}/organization-roles/{role_id}/users',
  roleAssign:'PUT /orgs/{org}/organization-roles/users/{username}/{role_id}',
  roleRemove:'DELETE /orgs/{org}/organization-roles/users/{username}/{role_id}'
};
const team=(name='Maintainers')=>({
  id:44,slug:'maintainers',name,privacy:'closed',
  description:'Operations team',notification_setting:'notifications_enabled',
  parent:null,organization:{login:'example-org'}
});
const repo=(role=null)=>({
  id:98,name:'hello',full_name:'example-org/hello',private:true,
  permissions:role?{admin:role==='admin',maintain:role==='maintain',
    push:role==='push',triage:role==='triage',pull:true}:null});
const activeOrg={role:'member',state:'active'};
const mem=(role='maintainer')=>({state:'active',role});
const role={id:7,name:'security_manager',description:'Scoped security reviewer'};
const roleList={total_count:1,roles:[role]};
const seq=(gh,route,a,b)=>gh.when(route).replySequence([
  {status:200,body:a},{status:200,body:b}]);
function save(gh,result){
  seq(gh,R.teamList,[],[team()]);
  gh.when(R.save).reply(201,team());
  gh.when(R.team).reply(200,
    result==='ok'?team():{...team(),name:'Wrong'});
}
function removeTeam(gh,result){
  gh.when(R.team).replySequence([
    {status:200,body:team()},
    result==='ok'?{status:404,body:{message:'Not Found'}}:
      {status:200,body:team()}
  ]);
  gh.when(R.delete).reply(204,null);
}
function member(gh,result){
  gh.when(R.team).reply(200,team());
  gh.when(R.member).replySequence([
    {status:404,body:{message:'Not Found'}},
    {status:200,body:mem(result==='ok'?'maintainer':'member')}]);
  gh.when(R.orgMember).reply(200,activeOrg);
  gh.when(R.memberSet).reply(200,mem());
}
function access(gh,result){
  gh.when(R.team).reply(200,team());
  gh.when(R.repo).reply(200,repo());
  seq(gh,R.teamRepos,[],[repo(result==='ok'?'push':'pull')]);
  gh.when(R.repoPut).reply(204,null);
}
function roles(gh,result,action='assign'){
  gh.when(R.roleList).reply(200,roleList);
  gh.when(R.orgMember).reply(200,activeOrg);
  seq(gh,R.roleUsers,action==='assign'?[]:[{login:'alice'}],
    result==='ok'?(action==='assign'?[{login:'alice'}]:[]):
      (action==='assign'?[]:[{login:'alice'}]));
  gh.when(action==='assign'?R.roleAssign:R.roleRemove).reply(204,null);
}
const definition=name=>({tool:defs.tools.find(x=>x.name===name),
  handler:defs.handlers[name]});
const work=[
  {name:'github_team_save',args:{action:'create',name:'Maintainers'},
    arrange:save,production:true},
  {name:'github_team_delete',args:{teamSlug:'maintainers'},
    arrange:removeTeam,production:true},
  {name:'github_team_set_member',
    args:{teamSlug:'maintainers',username:'alice',action:'set',role:'maintainer'},
    arrange:member,accessWidening:true,notifies:['alice']},
  {name:'github_team_set_repo_access',
    args:{teamSlug:'maintainers',repo:'hello',action:'set',permission:'push'},
    arrange:access,production:true,accessWidening:true},
  {name:'github_role_assign',
    args:{roleId:7,subjectType:'user',username:'alice'},
    arrange:(gh,result)=>roles(gh,result,'assign'),accessWidening:true},
  {name:'github_role_remove',
    args:{roleId:7,subjectType:'user',username:'alice'},
    arrange:(gh,result)=>roles(gh,result,'remove')}
];
for(const x of work)
  runWriteContract({label:x.name,definition:definition(x.name),args:x.args,
    arrange:x.arrange,profile:'full',needsConfirm:true,
    production:x.production??false,accessWidening:x.accessWidening??false,
    notifies:x.notifies??[]});
async function call(w,name,args={}){
  const dispatch=createDispatch({env:w.ctx.env,credentials:w.credentials,
    fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:[]});
  const result=await dispatch({registry,name,args,connection:w.connection,db:w.db});
  return result.structuredContent??(result.isError?{done:false,
    error:result.content?.[0]?.text}:parse(result));
}
describe('O-3 team/role catalog and provider-regression cases',()=>{
  it('presents real teams, exact members and repo grants without any write',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when(R.teamList).reply(200,[team()]);
    w.gh.when(R.team).reply(200,team());
    w.gh.when(R.members).reply(200,[{login:'alice',id:9}]);
    w.gh.when(R.teamRepos).reply(200,[repo('push')]);
    w.gh.when(R.roleList).reply(200,roleList);
    const teams=await call(w,'github_team_list');
    const current=await call(w,'github_team_get',{teamSlug:'maintainers'});
    const assigned=await call(w,'github_role_list');
    expect(teams.teams[0].slug).toBe('maintainers');
    expect(current.members[0].login).toBe('alice');
    expect(current.repositories[0].permissions.push).toBe(true);
    expect(assigned.roles[0].name).toBe('security_manager');
    expect(assigned.availability).toBe('available');
    expect(w.gh.invalid).toEqual([]);
    expect(w.gh.calls.filter(x=>x.method!=='GET')).toHaveLength(0);
  });
  it('treats role-plan 422 as unavailable, never silently empty-success',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when(R.roleList).reply(422,{message:'Role feature unavailable'});
    const result=await call(w,'github_role_list');
    expect(result).toMatchObject({availability:'not_available_on_plan',
      complete:false,roles:[]});
    expect(w.gh.calls.filter(c=>c.method!=='GET')).toHaveLength(0);
  });
  it('refuses a cross-organization repository without changing grants',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(R.team).reply(200,team());
    w.gh.when(R.repo).reply(200,{...repo(),full_name:'outsider/hello'});
    const result=await call(w,'github_team_set_repo_access',{
      teamSlug:'maintainers',repo:'hello',action:'set',
      permission:'admin',confirm:true});
    expect(result.done).toBe(false);
    expect(w.gh.calls.filter(c=>c.method!=='GET')).toHaveLength(0);
  });
  describe('org owners are always team maintainers (seen live 2026-10-23)',()=>{
    const run=async(orgRole,readBackRole)=>{
      const w=await makeWorld({mode:'production',profile:'full'});
      w.gh.when(R.team).reply(200,team());
      w.gh.when(R.member).replySequence([{status:404,body:{message:'Not Found'}},
        {status:200,body:{role:readBackRole,state:'active'}}]);
      w.gh.when(R.orgMember).reply(200,{state:'active',role:orgRole});
      w.gh.when(R.memberSet).reply(200,{role:readBackRole,state:'active'});
      return call(w,'github_team_set_member',{teamSlug:'maintainers',username:'alice',
        action:'set',role:'member',confirm:true});
    };
    it('accepts maintainer read-back for an organization owner asked to be a member',async()=>{
      expect(await run('admin','maintainer')).toMatchObject({done:true,status:'applied'});
    });
    it('does not accept it for an ordinary member',async()=>{
      expect(await run('member','maintainer')).toMatchObject({done:false});
    });
  });
  it('does not invite a non-member via team membership operations',async()=>{
    const w=await makeWorld({mode:'preview',profile:'full'});
    w.gh.when(R.team).reply(200,team());
    w.gh.when(R.member).reply(404,{message:'Not Found'});
    w.gh.when(R.orgMember).reply(404,{message:'Not Found'});
    const result=await call(w,'github_team_set_member',{
      teamSlug:'maintainers',username:'outsider',action:'set',
      role:'maintainer',confirm:true});
    expect(result.done).toBe(false);
    expect(w.gh.calls.filter(c=>c.method!=='GET')).toHaveLength(0);
  });
  it('refuses non-member and unavailable role assignment without provider writes',async()=>{
    const w=await makeWorld({mode:'preview',profile:'full'});
    w.gh.when(R.roleList).reply(200,roleList);
    w.gh.when(R.orgMember).reply(404,{message:'Not Found'});
    const result=await call(w,'github_role_assign',{
      roleId:7,subjectType:'user',username:'alice',confirm:true});
    expect(result.done).toBe(false);
    expect(w.gh.calls.filter(c=>c.method!=='GET')).toHaveLength(0);
  });
});
