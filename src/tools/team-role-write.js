// O-3: exact team/organization-role writes through the generic confirmation,
// request journal, protected-resource, people and independent readback gates.
import {listAll} from '../github/client.js';
import {defineGithubWrite} from './define-github-write.js';
import {octo,ownerOf,missing,refusal} from './github-write.js';
import {accessChange} from './people-guard.js';
import {rolesFor} from './team-role-read.js';

const OWNER={type:'string',maxLength:39};
const LOGIN={type:'string',minLength:1,maxLength:39,
  pattern:'^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'};
const SLUG={type:'string',minLength:1,maxLength:100,
  pattern:'^[A-Za-z0-9][A-Za-z0-9_-]*$'};
const REPO={type:'string',minLength:1,maxLength:100};
const ID={type:'integer',minimum:1};
const teamTarget=(a,c)=>({owner:ownerOf(a,c),scope:'org',kind:'org-team'});
const context=async(c,t)=>{
  const account=await c.db.getAccount(t.owner);
  if(account?.account_type!=='Organization')
    throw refusal('Teams and roles require an enrolled GitHub organization.');
  return octo(c,t.owner);
};
const call=async(c,t,route,p={})=>(await(await context(c,t)).request(route,
  {org:t.owner,...p})).data;
const limited=async(c,t,route,p={})=>{
  const res=await listAll(await context(c,t),route,
    {org:t.owner,per_page:100,...p},{max:500});
  if(res.capped)throw refusal('Incomplete organization access inventory; no mutation is safe.');
  return res.items;
};
const getTeam=(c,t,slug)=>missing(async()=>call(c,t,
  'GET /orgs/{org}/teams/{team_slug}',{team_slug:slug}));
const getMember=(c,t,slug,username)=>missing(async()=>call(c,t,
  'GET /orgs/{org}/teams/{team_slug}/memberships/{username}',
  {team_slug:slug,username}));
const getOrgMember=(c,t,username)=>missing(async()=>call(c,t,
  'GET /orgs/{org}/memberships/{username}',{username}));
const nameOf=x=>String(x?.name??'');
const teamParams=(t,slug)=>({org:t.owner,team_slug:slug});
const teamShape=x=>({
  id:x.id,slug:x.slug,name:x.name,description:x.description??null,
  privacy:x.privacy??null,notification_setting:x.notification_setting??null,
  parent_team_id:x.parent?.id??null
});
const boolEq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const ensureTeam=(team,t,slug)=>{
  if(!Number.isInteger(team?.id)||!team.slug||
    String(team.slug).toLowerCase()!==String(slug).toLowerCase()||
    team.organization?.login&&
    team.organization.login.toLowerCase()!==t.owner.toLowerCase())
    throw refusal('The requested team identity was not verified in the organization.');
  return teamShape(team);
};
const SAVE_PROPS={owner:OWNER,action:{type:'string',enum:['create','update']},
  teamSlug:SLUG,name:{type:'string',minLength:1,maxLength:100},
  description:{type:'string',maxLength:1024},
  privacy:{type:'string',enum:['secret','closed']},
  notificationSetting:{type:'string',enum:['notifications_enabled','notifications_disabled']},
  parentTeamId:ID};
const teamSaveTarget=(a,c)=>{
  if(a.action==='update'&&!a.teamSlug||a.action==='create'&&a.teamSlug)
    throw new TypeError('Update requires teamSlug; create must not supply it.');
  return teamTarget(a,c);
};
const getTeamNameAvailable=async(c,t,name)=>{
  const rows=await limited(c,t,'GET /orgs/{org}/teams');
  return rows.find(x=>nameOf(x).toLowerCase()===name.toLowerCase())??null;
};
export const teamSave=defineGithubWrite({
  name:'github_team_save',area:'team',audience:['O'],
  description:'Create or surgically update one organization team, preserving unreadable settings and confirming exact identity.',
  properties:SAVE_PROPS,required:['action','name'],
  declarations:{production:'never',profiles:['full']},target:teamSaveTarget,
  read:async(a,c,t)=>{
    const old=a.action==='update'?await getTeam(c,t,a.teamSlug):null;
    const alreadyExists=a.action==='create'&&!!(await getTeamNameAvailable(c,t,a.name));
    if(a.parentTeamId!==undefined){
      const parent=(await limited(c,t,'GET /orgs/{org}/teams'))
        .find(x=>x.id===a.parentTeamId);
      if(!parent||parent.slug===a.teamSlug)
        throw refusal('The named parent team is not verified or creates a cycle.');
    }
    return old?{team:ensureTeam(old,t,a.teamSlug),alreadyExists:false}:
      {team:null,alreadyExists};
  },
  classify:()=>({production:'organization team permissions and member inheritance can change'}),
  summarize:({args:a,target:t,before:b})=>
    (a.action==='create'?'CREATE':'UPDATE')+' team '+a.name+' in '+t.owner+
    (b?.team?'; existing team '+b.team.slug:'; no existing team')+
    '; nested team/visibility settings require owner review',
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(a.action==='update'&&!b?.team)throw refusal('Existing team baseline absent.');
    if(a.action==='create'&&(b?.team||b?.alreadyExists))
      throw refusal('New team already exists.');
    const body={org:t.owner,name:a.name,...(a.description!==undefined?{description:a.description}:{}),
      ...(a.privacy!==undefined?{privacy:a.privacy}:{}),
      ...(a.notificationSetting!==undefined?{notification_setting:a.notificationSetting}:{}),
      ...(a.parentTeamId!==undefined?{parent_team_id:a.parentTeamId}:{})};
    if(a.action==='update'){
      // PATCH updates only requested properties; GitHub owns all other fields.
      return (await context(ctx,t)).request('PATCH /orgs/{org}/teams/{team_slug}',
        {...body,team_slug:a.teamSlug});
    }
    return (await context(ctx,t)).request('POST /orgs/{org}/teams',body);
  },
  readAfter:async({ctx,target:t,response:r})=>{
    const slug=r?.data?.slug;
    if(!slug)throw refusal('GitHub did not return the saved team slug.');
    const x=await getTeam(ctx,t,slug);
    return ensureTeam(x,t,slug);
  },
  verify:({args:a,before:b,after:x})=>!!x&&x.name===a.name&&
    (a.action!=='update'||x.id===b.team.id)&&
    [['description','description'],['privacy','privacy'],
      ['notificationSetting','notification_setting'],['parentTeamId','parent_team_id']]
      .every(([k,p])=>a[k]!==undefined?boolEq(x[p],a[k]):
        a.action!=='update'||boolEq(x[p],b.team[p])),
  inverse:()=>null,present:({after:x})=>x
});
export const teamDelete=defineGithubWrite({
  name:'github_team_delete',area:'team',audience:['O'],
  description:'Delete a verified exact organization team after explicit approval and absence readback.',
  properties:{owner:OWNER,teamSlug:SLUG},required:['teamSlug'],
  declarations:{production:'never',confirm:'always',profiles:['full']},target:teamTarget,
  read:async(a,c,t)=>{
    const d=await getTeam(c,t,a.teamSlug);
    return d?ensureTeam(d,t,a.teamSlug):null;
  },
  classify:()=>({production:'deleting a team can revoke organization repository access'}),
  summarize:({args:a,before:b,target:t})=>
    'DELETE '+a.teamSlug+' in '+t.owner+
    ' (ID '+(b?.id??'not found')+'); memberships, inherited repository grants and review assignments may be lost',
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(!b)throw refusal('Team is already absent; no deletion permitted.');
    return (await context(ctx,t)).request('DELETE /orgs/{org}/teams/{team_slug}',
      teamParams(t,a.teamSlug));
  },
  readAfter:({args:a,ctx,target:t})=>getTeam(ctx,t,a.teamSlug),
  verify:({after:x})=>x===null,
  inverse:()=>null,present:({args:a})=>({team:a.teamSlug,deleted:true})
});
const MEMBER_PROPS={owner:OWNER,teamSlug:SLUG,username:LOGIN,
  action:{type:'string',enum:['set','remove']},
  role:{type:'string',enum:['member','maintainer']}};
export const teamSetMember=defineGithubWrite({
  name:'github_team_set_member',area:'team',audience:['O'],
  description:'Add, promote, demote or remove an exact existing organization member from a team with readback.',
  properties:MEMBER_PROPS,required:['teamSlug','username','action'],
  declarations:{production:'never',confirm:'always',accessWidening:true,
    notifies:true,profiles:['full']},target:teamTarget,
  read:async(a,c,t)=>{
    const team=ensureTeam(await getTeam(c,t,a.teamSlug),t,a.teamSlug);
    const membership=await getMember(c,t,a.teamSlug,a.username);
    const org=await getOrgMember(c,t,a.username);
    return {team,role:membership?.role??null,state:membership?.state??null,
      inOrg:org?.state==='active'};
  },
  classify:({args:a,before:b,target:t})=>{
    const grant=a.action==='set'&&
      (b?.role===null||a.role==='maintainer'&&b.role!=='maintainer');
    return {...(grant?accessChange({who:a.username,access:a.role,
      where:t.owner+'/'+a.teamSlug,before:b?.role??'none'}):{}),
      ...(a.action==='set'?{notifies:[a.username]}:{})};
  },
  summarize:({args:a,before:b,target:t})=>
    (a.action==='set'?'SET '+a.role:'REMOVE')+' team member '+a.username+
    ' of '+t.owner+'/'+a.teamSlug+'; previous '+(b?.role??'none'),
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(!b?.team)throw refusal('Team identity missing.');
    if(a.action==='set'&&(!a.role||!b.inOrg))
      throw refusal('A role and verified active organization membership are required; no invitation sent.');
    if(a.action==='remove'&&!b.role)
      throw refusal('The exact team membership is absent.');
    return (await context(ctx,t)).request(
      (a.action==='set'?'PUT ':'DELETE ')+
        '/orgs/{org}/teams/{team_slug}/memberships/{username}',
      {...teamParams(t,a.teamSlug),username:a.username,
        ...(a.action==='set'?{role:a.role}:{})});
  },
  readAfter:({args:a,ctx,target:t})=>getMember(ctx,t,a.teamSlug,a.username),
  verify:({args:a,after:x})=>a.action==='remove'?x===null:
    x?.role===a.role&&x.state==='active',
  inverse:()=>null,present:({args:a,after:x})=>({
    username:a.username,team:a.teamSlug,state:x?.state??'removed',
    role:x?.role??null})
});
const repoRole=x=>{
  if(['pull','triage','push','maintain','admin'].includes(x?.role_name))
    return x.role_name;
  const p=x?.permissions;
  if(!p)return null;
  for(const k of ['admin','maintain','push','triage','pull'])if(p[k]===true)return k;
  return null;
};
const getTeamRepos=(c,t,slug)=>limited(c,t,
  'GET /orgs/{org}/teams/{team_slug}/repos',{team_slug:slug});
const repoKey=(t,repo)=>t.owner+'/'+repo;
const REPO_PROPS={owner:OWNER,teamSlug:SLUG,repo:REPO,
  action:{type:'string',enum:['set','remove']},
  permission:{type:'string',enum:['pull','triage','push','maintain','admin']}};
export const teamRepoAccess=defineGithubWrite({
  name:'github_team_set_repo_access',area:'team',audience:['O'],
  description:'Set or revoke team access to one exact repository, preserving unrelated grants and checking effective role.',
  properties:REPO_PROPS,required:['teamSlug','repo','action'],
  declarations:{production:'never',confirm:'always',accessWidening:true,profiles:['full']},
  target:(a,c)=>({...teamTarget(a,c),repo:a.repo,scope:'repo',kind:'repo-settings'}),
  read:async(a,c,t)=>{
    const team=ensureTeam(await getTeam(c,t,a.teamSlug),t,a.teamSlug);
    const repo=(await (await context(c,t)).request('GET /repos/{owner}/{repo}',
      {owner:t.owner,repo:a.repo})).data;
    if(repo?.full_name?.toLowerCase()!==repoKey(t,a.repo).toLowerCase())
      throw refusal('Repository identity did not match enrolled team organization.');
    const all=await getTeamRepos(c,t,a.teamSlug);
    return {team,repo_id:repo.id,grants:all.map(x=>({
      name:x.full_name,role:repoRole(x)})),role:repoRole(all.find(x=>
      x.full_name?.toLowerCase()===repoKey(t,a.repo).toLowerCase()))};
  },
  classify:({args:a,before:b,target:t})=>{
    const ranks={pull:1,triage:2,push:3,maintain:4,admin:5};
    const access=a.action==='set'&&(!b?.role||ranks[a.permission]>ranks[b.role]);
    return {...(access?accessChange({who:'team '+a.teamSlug,
      access:a.permission,where:repoKey(t,a.repo),before:b?.role??'none'}):{}),
      production:'changes repository-team access rights'};
  },
  summarize:({args:a,before:b,target:t})=>
    (a.action==='set'?'GRANT '+a.permission:'REVOKE')+' to team '+a.teamSlug+
    ' on '+repoKey(t,a.repo)+'; current '+(b?.role??'none'),
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(!b?.team||!Number.isInteger(b.repo_id))
      throw refusal('A complete team/repository preflight is required.');
    if(a.action==='set'&&!a.permission)throw refusal('Set requires the requested role.');
    if(a.action==='remove'&&!b.role)throw refusal('Team repository grant is absent.');
    return (await context(ctx,t)).request(
      (a.action==='set'?'PUT ':'DELETE ')+
        '/orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}',
      {...teamParams(t,a.teamSlug),owner:t.owner,repo:a.repo,
        ...(a.action==='set'?{permission:a.permission}:{})});
  },
  readAfter:async({args:a,ctx,target:t})=>({
    grants:(await getTeamRepos(ctx,t,a.teamSlug)).map(x=>({
      name:x.full_name,role:repoRole(x)}))}),
  verify:({args:a,before:b,after:x,target:t})=>{
    if(!x?.grants)return false;
    const key=repoKey(t,a.repo).toLowerCase();
    const prev=new Map((b.grants??[]).map(x=>[x.name?.toLowerCase(),x.role]));
    const next=new Map(x.grants.map(q=>[q.name?.toLowerCase(),q.role]));
    if(!boolEq(next.get(key)??null,
      a.action==='set'?a.permission:null))return false;
    for(const [name,role] of prev)if(name!==key&&next.get(name)!==role)return false;
    for(const name of next.keys())if(name!==key&&!prev.has(name))return false;
    return true;
  },
  inverse:()=>null,present:({args:a,after:x})=>({
    team:a.teamSlug,repo:a.repo,role:x?.grants?.find(y=>
      y.name?.toLowerCase().endsWith('/'+a.repo.toLowerCase()))?.role??null})
});
const SUBJECT={type:'string',enum:['user','team']};
const roleTarget=(a,c)=>({...teamTarget(a,c),kind:'org-roles'});
const SUBJECT_PROPS={owner:OWNER,roleId:ID,subjectType:SUBJECT,
  username:LOGIN,teamSlug:SLUG};
const checkSubject=(a,c)=>{
  if(a.subjectType==='user'&&(!a.username||a.teamSlug)||
     a.subjectType==='team'&&(!a.teamSlug||a.username))
    throw new TypeError('Exactly one role subject matching user or team is required.');
  return roleTarget(a,c);
};
const rolePath=a=>a.subjectType==='user'?
  'users/{username}':'teams/{team_slug}';
const roleUserList=async(c,t,a)=>{
  const route='GET /orgs/{org}/organization-roles/{role_id}/'+
    (a.subjectType==='user'?'users':'teams');
  return limited(c,t,route,{role_id:a.roleId});
};
const subjectLogin=a=>a.subjectType==='user'?a.username:a.teamSlug;
const roleMembership=async(c,t,a)=>{
  if(a.subjectType==='user'){
    const membership=await getOrgMember(c,t,a.username);
    if(membership?.state!=='active')throw refusal('User must be an existing active organization member.');
  }else ensureTeam(await getTeam(c,t,a.teamSlug),t,a.teamSlug);
};
const roleRead=async(a,c,t)=>{
  const roles=await rolesFor(await context(c,t),t.owner,500);
  if(!roles.complete)throw refusal('Organization role inventory is capped.');
  const role=roles.roles.find(x=>x.id===a.roleId);
  if(!role)throw refusal('This role is not currently eligible or readable on the plan.');
  await roleMembership(c,t,a);
  const users=await roleUserList(c,t,a);
  const exists=users.some(x=>
    (a.subjectType==='user'?x.login:x.slug)?.toLowerCase()===
      subjectLogin(a).toLowerCase());
  return {role_id:role.id,name:role.name,alreadyAssigned:exists};
};
const roleReadback=async(a,c,t)=>{
  const users=await roleUserList(c,t,a);
  return users.some(x=>
    (a.subjectType==='user'?x.login:x.slug)?.toLowerCase()===
      subjectLogin(a).toLowerCase());
};
function roleSpec(action){
  const assign=action==='assign';
  return defineGithubWrite({
    name:'github_role_'+(assign?'assign':'remove'),area:'role',audience:['O'],
    description:(assign?'Assign':'Remove')+
      ' one verified organization role to an exact member or team with scope, approval and readback.',
    properties:SUBJECT_PROPS,required:['roleId','subjectType'],
    declarations:{production:'never',confirm:'always',
      accessWidening:assign,profiles:['full']},target:checkSubject,
    read:roleRead,
    classify:({args:a,before:b,target:t})=>assign?accessChange({
      who:a.subjectType+' '+subjectLogin(a),access:b?.name??'organization role',
      where:t.owner,before:b?.alreadyAssigned?'already assigned':'none'}):{},
    summarize:({args:a,before:b,target:t})=>(assign?'ASSIGN':'REMOVE')+
      ' role #'+a.roleId+' '+(b?.name??'unknown')+' for '+
      a.subjectType+' '+subjectLogin(a)+' in '+t.owner,
    apply:async({args:a,ctx,target:t,before:b})=>{
      if(!b)throw refusal('Role baseline missing.');
      if(assign&&b.alreadyAssigned)throw refusal('Role already assigned.');
      if(!assign&&!b.alreadyAssigned)throw refusal('Role already absent.');
      return (await context(ctx,t)).request(
        (assign?'PUT ':'DELETE ')+
          '/orgs/{org}/organization-roles/'+rolePath(a)+'/{role_id}',
        {org:t.owner,role_id:a.roleId,...(a.subjectType==='user'?
          {username:a.username}:{team_slug:a.teamSlug})});
    },
    readAfter:({args:a,ctx,target:t})=>roleReadback(a,ctx,t),
    verify:({after:x})=>x===assign,
    inverse:()=>null,present:({args:a,after:x})=>({
      role_id:a.roleId,subject_type:a.subjectType,
      subject:subjectLogin(a),assigned:x})
  });
}
export const roleAssign=roleSpec('assign'),roleRemove=roleSpec('remove');
export const tools=[teamSave.tool,teamDelete.tool,teamSetMember.tool,
  teamRepoAccess.tool,roleAssign.tool,roleRemove.tool];
export const handlers=Object.fromEntries([
  [teamSave.tool,teamSave.handler],[teamDelete.tool,teamDelete.handler],
  [teamSetMember.tool,teamSetMember.handler],
  [teamRepoAccess.tool,teamRepoAccess.handler],
  [roleAssign.tool,roleAssign.handler],[roleRemove.tool,roleRemove.handler]
].map(([t,h])=>[t.name,h]));
