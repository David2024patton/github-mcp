// O-2: guarded organization owner administration. Every mutation is journalled,
// previews its exact recipient/policy and requires independent provider readback.
import {listAll} from '../github/client.js';
import {defineGithubWrite} from './define-github-write.js';
import {octo,ownerOf,refusal,missing} from './github-write.js';
import {accessChange,invitation} from './people-guard.js';

const OWNER={type:'string',maxLength:39};
const LOGIN={type:'string',minLength:1,maxLength:39,pattern:'^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'};
const ID={type:'integer',minimum:1};
const BOOL={type:'boolean'},STR={type:'string',maxLength:255};
const role={type:'string',enum:['admin','member']};
const target=(a,ctx)=>({owner:ownerOf(a,ctx),scope:'org',kind:'org-settings'});
const params=t=>({org:t.owner});
async function client(ctx,t){
  const a=await ctx.db.getAccount(t.owner);
  if(a?.account_type!=='Organization')throw refusal('Target must be an enrolled organization.');
  return octo(ctx,t.owner);
}
const scoped=async(ctx,t,route,paramsExtra={})=>{
  const gh=await client(ctx,t);
  return (await gh.request(route,{...params(t),...paramsExtra})).data;
};
const all=async(ctx,t,route,max=500,paramsExtra={})=>{
  const gh=await client(ctx,t);
  const x=await listAll(gh,route,{...params(t),per_page:100,...paramsExtra},{max});
  if(x.capped)throw refusal('GitHub inventory is incomplete; refusing organization mutation.');
  return x.items;
};
const identity=(d,t)=>{if(!d||String(d.login).toLowerCase()!==t.owner.toLowerCase())
  throw refusal('Organization identity was not independently verified.');return d;};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const orgFields=['name','description','company','blog','location','email',
  'default_repository_permission','members_can_create_repositories',
  'members_can_fork_private_repositories'];
const orgSchemas={name:STR,description:{type:'string',maxLength:1024},
  company:STR,blog:STR,location:STR,email:{type:'string',maxLength:254},
  default_repository_permission:{type:'string',enum:['none','read','write','admin']},
  members_can_create_repositories:BOOL,members_can_fork_private_repositories:BOOL};
const policyBefore=async(ctx,t)=>identity(await scoped(ctx,t,'GET /orgs/{org}'),t);
const checkedChanges=(a,b)=>{
  if(!b)throw refusal('No verified organization policy baseline.');
  const keys=Object.keys(a.changes??{});
  if(!keys.length||keys.some(k=>!orgFields.includes(k)))
    throw refusal('Only specified supported organization settings may be updated.');
  if(keys.some(k=>b[k]===undefined||b[k]===null))
    throw refusal('A target setting is unreadable; refusing to overwrite its unknown value.');
  return keys;
};
const widening=(a,b)=>{
  if(!b)return true;
  const c=a.changes??{};
  const ranks={none:0,read:1,write:2,admin:3};
  return Object.hasOwn(c,'default_repository_permission')&&
    ranks[c.default_repository_permission]>ranks[b.default_repository_permission]||
    ['members_can_create_repositories','members_can_fork_private_repositories']
      .some(k=>c[k]===true&&b[k]!==true);
};
export const orgUpdate=defineGithubWrite({
  name:'github_org_update_settings',area:'org',audience:['O'],
  description:'Safely update named organization profile/member policy fields, preserving every other readable field.',
  properties:{owner:OWNER,changes:{type:'object',properties:orgSchemas,minProperties:1,
    additionalProperties:false}},required:['changes'],
  declarations:{production:'always',confirm:'always',accessWidening:true,profiles:['full']},target,
  read:(a,c,t)=>policyBefore(c,t),
  classify:({args:a,before:b,target:t})=>({
    production:'organization owner settings affect all repositories and members',
    ...(widening(a,b)?accessChange({who:'organization members',access:'broader default rights',
      where:t.owner,before:b?.default_repository_permission??'unreadable'}):{})}),
  summarize:({args:a,before:b,target:t})=>{
    const keys=checkedChanges(a,b);
    return 'Update '+t.owner+' organization settings: '+keys.map(k=>
      k+' '+JSON.stringify(b[k])+' → '+JSON.stringify(a.changes[k])).join('; ');
  },
  apply:async({args:a,ctx,target:t,before:b})=>{
    checkedChanges(a,b);
    return (await client(ctx,t)).request('PATCH /orgs/{org}',{...params(t),...a.changes});
  },
  readAfter:({ctx,target:t})=>policyBefore(ctx,t),
  verify:({args:a,before:b,after:x})=>!!x&&orgFields.every(k=>
    b[k]===undefined||b[k]===null?true:
    same(x[k],Object.hasOwn(a.changes,k)?a.changes[k]:b[k])),
  inverse:()=>null,present:({args:a,after:x})=>({
    org:x?.login,changed:Object.fromEntries(Object.keys(a.changes).map(k=>[k,x?.[k]])),
    other_readable_policy_preserved:true})
});
const getMembership=(ctx,t,username)=>missing(async()=>await scoped(ctx,t,
  'GET /orgs/{org}/memberships/{username}',{username}));
const getInvitations=(ctx,t)=>all(ctx,t,'GET /orgs/{org}/invitations');
const getOutside=(ctx,t)=>all(ctx,t,'GET /orgs/{org}/outside_collaborators');
const normalizeInvite=x=>({id:x.id,login:x.invitee?.login??null,
  email:x.email??null,role:x.role??null,team_ids:x.team_ids??[]});
const inviteTarget=(a,c)=>{
  if((!!a.username)===(!!a.email))
    throw new TypeError('Specify exactly one username or email recipient.');
  return target(a,c);
};
export const orgInvite=defineGithubWrite({
  name:'github_org_invite_member',area:'org',audience:['O'],
  description:'Invite an exact organization member with selected role/teams, approval and pending invitation readback.',
  properties:{owner:OWNER,username:LOGIN,email:{type:'string',format:'email',maxLength:254},
    role:{type:'string',enum:['direct_member','admin','billing_manager']},
    teamIds:{type:'array',maxItems:20,uniqueItems:true,items:ID}},
  required:['role'],
  declarations:{production:'never',confirm:'always',accessWidening:true,
    notifies:true,profiles:['full']},target:inviteTarget,
  read:async(a,ctx,t)=>{
    const pending=await getInvitations(ctx,t);
    const match=pending.find(x=>a.username?
      x.invitee?.login?.toLowerCase()===a.username.toLowerCase():
      x.email?.toLowerCase()===a.email.toLowerCase());
    if(match)throw refusal('This recipient already has a pending organization invitation.');
    const teams=a.teamIds??[];
    if(teams.length){
      const existing=await all(ctx,t,'GET /orgs/{org}/teams');
      if(teams.some(id=>!existing.some(x=>x.id===id)))
        throw refusal('One or more requested teams are not verified in this organization.');
    }
    if(a.username){
      const user=await scoped(ctx,t,'GET /users/{username}',{username:a.username});
      if(!Number.isInteger(user?.id)||user.login?.toLowerCase()!==a.username.toLowerCase())
        throw refusal('Cannot verify the exact invitee login and numeric GitHub identity.');
      return {pending,inviteeId:user.id};
    }
    return {pending};
  },
  classify:({args:a,target:t})=>invitation({
    who:a.username??a.email,access:a.role,where:t.owner}),
  summarize:({args:a,target:t})=>'Invite '+(a.username??a.email)+
    ' to '+t.owner+' as '+a.role+' with exact team IDs '+JSON.stringify(a.teamIds??[])+
    '; GitHub will notify the recipient',
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(!b)throw refusal('Invitation preflight was not readable.');
    const body={...params(t),role:a.role,team_ids:a.teamIds??[],
      ...(a.username?{invitee_id:b.inviteeId}:{email:a.email})};
    return (await client(ctx,t)).request('POST /orgs/{org}/invitations',body);
  },
  readAfter:async({ctx,target:t,response:r})=>{
    const id=r?.data?.id;
    if(!Number.isInteger(id))throw refusal('GitHub did not return an invitation ID.');
    const invitations=await getInvitations(ctx,t);
    return normalizeInvite(invitations.find(x=>x.id===id)??{});
  },
  verify:({args:a,after:x})=>Number.isInteger(x?.id)&&
    (a.username?x.login?.toLowerCase()===a.username.toLowerCase():
      x.email?.toLowerCase()===a.email.toLowerCase())&&
    x.role===a.role&&same([...x.team_ids].sort(),[...(a.teamIds??[])].sort()),
  inverse:()=>null,present:({after:x})=>({...x,status:'pending',
    note:'Invitation is not effective organization access until accepted.'})
});
export const orgCancelInvitation=defineGithubWrite({
  name:'github_org_cancel_invitation',area:'org',audience:['O'],
  description:'Cancel one verified organization invitation by exact ID and prove it is absent afterward.',
  properties:{owner:OWNER,invitationId:ID},required:['invitationId'],
  declarations:{production:'never',confirm:'always',notifies:true,profiles:['full']},target,
  read:async(a,c,t)=>{
    const found=(await getInvitations(c,t)).find(x=>x.id===a.invitationId);
    if(!found)throw refusal('The exact pending invitation ID was not verified.');
    return normalizeInvite(found);
  },
  classify:({before:b})=>({notifies:b?[b.login??b.email].filter(Boolean):[]}),
  summarize:({args:a,before:b,target:t})=>'Cancel invitation #'+a.invitationId+
    ' for '+(b?.login??b?.email??'unknown')+' in '+t.owner,
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(b?.id!==a.invitationId)throw refusal('Missing exact invitation preflight.');
    return (await client(ctx,t)).request('DELETE /orgs/{org}/invitations/{invitation_id}',
      {...params(t),invitation_id:a.invitationId});
  },
  readAfter:({ctx,target:t})=>getInvitations(ctx,t),
  verify:({args:a,after:items})=>Array.isArray(items)&&
    !items.some(x=>x.id===a.invitationId),
  inverse:()=>null,present:({args:a})=>({invitation_id:a.invitationId,cancelled:true})
});
export const orgSetMemberRole=defineGithubWrite({
  name:'github_org_set_member_role',area:'org',audience:['O'],
  description:'Change an existing organization member role with access approval and verified membership readback.',
  properties:{owner:OWNER,username:LOGIN,role},
  required:['username','role'],
  declarations:{production:'never',confirm:'always',accessWidening:true,profiles:['full']},target,
  read:async(a,c,t)=>{
    const x=await getMembership(c,t,a.username);
    if(x?.state!=='active'||!['admin','member'].includes(x.role))
      throw refusal('Only an existing active organization member can be changed.');
    return {role:x.role,state:x.state};
  },
  classify:({args:a,before:b,target:t})=>({
    ...(a.role==='admin'&&b?.role!=='admin'?accessChange({
      who:a.username,access:'organization owner/admin',where:t.owner,before:b?.role??'unknown'}):{})}),
  summarize:({args:a,before:b,target:t})=>'Change '+a.username+
    ' in '+t.owner+' from '+(b?.role??'unreadable')+' to '+a.role+
    '; owner access may include every organization repository and billing control',
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(b?.state!=='active')throw refusal('Member baseline is missing.');
    return (await client(ctx,t)).request('PUT /orgs/{org}/memberships/{username}',
      {...params(t),username:a.username,role:a.role});
  },
  readAfter:({args:a,ctx,target:t})=>getMembership(ctx,t,a.username),
  verify:({args:a,after:x})=>x?.state==='active'&&x.role===a.role,
  inverse:()=>null,present:({args:a,after:x})=>({username:a.username,role:x?.role,state:x?.state})
});
export const orgRemoveMember=defineGithubWrite({
  name:'github_org_remove_member',area:'org',audience:['O'],
  description:'Remove one verified member with approval and absence readback; warn about lost private-repo, team and Copilot access.',
  properties:{owner:OWNER,username:LOGIN},required:['username'],
  declarations:{production:'never',confirm:'always',profiles:['full']},target,
  read:async(a,c,t)=>{
    const x=await getMembership(c,t,a.username);
    if(x?.state!=='active')throw refusal('The named user is not an active organization member.');
    return {role:x.role,state:x.state};
  },
  classify:()=>({}),
  summarize:({args:a,before:b,target:t})=>'REMOVE '+a.username+' ('+b?.role+
    ') from '+t.owner+'; they may lose private repository access, team memberships and Copilot seat',
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(!b)throw refusal('Membership preflight missing.');
    return (await client(ctx,t)).request('DELETE /orgs/{org}/members/{username}',
      {...params(t),username:a.username});
  },
  readAfter:({args:a,ctx,target:t})=>getMembership(ctx,t,a.username),
  verify:({after:x})=>x===null,
  inverse:()=>null,present:({args:a})=>({username:a.username,removed:true,
    warning:'Private repository, team and Copilot entitlements may be lost.'})
});
export const orgOutsideCollaborator=defineGithubWrite({
  name:'github_org_set_outside_collaborator',area:'org',audience:['O'],
  description:'Convert a verified non-owner member to outside collaborator or remove exact outside access with readback.',
  properties:{owner:OWNER,username:LOGIN,action:{type:'string',enum:['convert','remove']}},
  required:['username','action'],
  declarations:{production:'never',confirm:'always',profiles:['full']},target,
  read:async(a,c,t)=>{
    const outside=await getOutside(c,t);
    const membership=await getMembership(c,t,a.username);
    const isOutside=outside.some(x=>x.login?.toLowerCase()===a.username.toLowerCase());
    if(a.action==='convert'&&(isOutside||membership?.role!=='member'||membership.state!=='active'))
      throw refusal('Only an active non-owner member may be converted.');
    if(a.action==='remove'&&!isOutside)
      throw refusal('Exact outside collaborator was not found.');
    return {isOutside,role:membership?.role??null};
  },
  classify:()=>({}),
  summarize:({args:a,target:t,before:b})=>(a.action==='convert'?'CONVERT':'REMOVE')+
    ' '+a.username+' in '+t.owner+
    (a.action==='convert'?'; organization membership ends, existing repository access may remain':
      '; direct access in all organization repositories may be lost'),
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(!b)throw refusal('Outside-collaborator baseline missing.');
    return (await client(ctx,t)).request(
      (a.action==='convert'?'PUT ':'DELETE ')+
        '/orgs/{org}/outside_collaborators/{username}',
      {...params(t),username:a.username});
  },
  readAfter:async({args:a,ctx,target:t})=>({
    outside:(await getOutside(ctx,t)).some(x=>
      x.login?.toLowerCase()===a.username.toLowerCase()),
    membership:await getMembership(ctx,t,a.username)}),
  verify:({args:a,after:x})=>a.action==='convert'?
    x?.outside===true&&x.membership?.role!=='admin':x?.outside===false,
  inverse:()=>null,present:({args:a,after:x})=>({
    username:a.username,is_outside_collaborator:x?.outside,
    inherited_repository_access_not_asserted:true})
});
const isBlocked=async(c,t,username)=>{
  try{await scoped(c,t,'GET /orgs/{org}/blocks/{username}',{username});return true;}
  catch(e){if(e?.status===404)return false;throw e;}
};
export const orgSetBlocked=defineGithubWrite({
  name:'github_org_set_blocked',area:'org',audience:['O'],
  description:'Block or unblock an exact GitHub user at organization scope; independently read back the block state.',
  properties:{owner:OWNER,username:LOGIN,blocked:BOOL},
  required:['username','blocked'],
  declarations:{production:'never',profiles:['full']},target,
  read:(a,c,t)=>isBlocked(c,t,a.username),
  classify:()=>({production:'organization-wide user access policy changes'}),
  summarize:({args:a,before:b,target:t})=>(a.blocked?'BLOCK':'UNBLOCK')+' '+
    a.username+' in '+t.owner+'; previously '+(b?'blocked':'not blocked'),
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(typeof b!=='boolean')throw refusal('Block-state baseline unavailable.');
    if(b===a.blocked)throw refusal('Requested block state already exists; no write required.');
    return (await client(ctx,t)).request(
      (a.blocked?'PUT ':'DELETE ')+'/orgs/{org}/blocks/{username}',
      {...params(t),username:a.username});
  },
  readAfter:({args:a,ctx,target:t})=>isBlocked(ctx,t,a.username),
  verify:({args:a,after:x})=>x===a.blocked,
  inverse:()=>null,present:({args:a,after:x})=>({username:a.username,blocked:x})
});
const props=async(c,t)=>all(c,t,'GET /orgs/{org}/properties/schema');
const propName={type:'string',minLength:1,maxLength:75,pattern:'^[A-Za-z0-9][A-Za-z0-9_-]*$'};
const valueType={type:'string',enum:['string','single_select','multi_select','true_false']};
const propertyFields=['value_type','required','description','default_value','allowed_values','values_editable_by'];
const cleanProperty=x=>Object.fromEntries(propertyFields.filter(k=>x?.[k]!==undefined)
  .map(k=>[k,x[k]]));
export const orgCustomProperties=defineGithubWrite({
  name:'github_org_custom_properties',area:'org',audience:['O'],
  description:'Create, update or delete a named organization custom property schema with exact preflight/readback.',
  properties:{owner:OWNER,name:propName,action:{type:'string',enum:['save','delete']},
    spec:{type:'object',properties:{value_type:valueType,required:BOOL,
      description:{type:'string',maxLength:255},
      values_editable_by:{type:'string',enum:['org_actors','org_and_repo_actors']},
      allowed_values:{type:'array',maxItems:100,items:{
        type:'object',properties:{value:{type:'string',maxLength:75},
          description:{type:'string',maxLength:255}},required:['value'],additionalProperties:false}}},
      required:['value_type'],additionalProperties:false}},
  required:['name','action'],
  declarations:{production:'never',profiles:['full']},target,
  read:async(a,c,t)=>{
    const properties=await props(c,t);
    const existing=properties.find(x=>x.property_name===a.name)??null;
    if(a.action==='delete'&&!existing)
      throw refusal('Cannot delete an unverified organization custom property.');
    if(a.action==='save'&&!a.spec)
      throw refusal('Saving a custom property requires a complete schema specification.');
    return {existing};
  },
  classify:()=>({production:'organization-wide custom repository property schema'}),
  summarize:({args:a,before:b,target:t})=>(a.action==='save'?'SAVE':'DELETE')+
    ' custom repository property '+a.name+' in '+t.owner+
    '; existing schema '+JSON.stringify(cleanProperty(b?.existing)),
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(!b)throw refusal('Property baseline is absent.');
    return (await client(ctx,t)).request(
      (a.action==='save'?'PUT ':'DELETE ')+
        '/orgs/{org}/properties/schema/{custom_property_name}',
      {...params(t),custom_property_name:a.name,...(a.action==='save'?a.spec:{})});
  },
  readAfter:async({args:a,ctx,target:t})=>
    (await props(ctx,t)).find(x=>x.property_name===a.name)??null,
  verify:({args:a,after:x})=>a.action==='delete'?x===null:
    !!x&&Object.keys(a.spec).every(k=>same(x[k],a.spec[k])),
  inverse:()=>null,present:({args:a,after:x})=>({
    property:a.name,deleted:a.action==='delete',schema:x?cleanProperty(x):null})
});
const immutable=async(c,t)=>scoped(c,t,'GET /orgs/{org}/settings/immutable-releases');
export const orgSetImmutable=defineGithubWrite({
  name:'github_org_set_immutable_releases',area:'org',audience:['O'],
  description:'Set organization immutable-release policy for exact repository selection with confirmation and readback.',
  properties:{owner:OWNER,enforcedRepositories:{type:'string',enum:['all','none','selected']},
    repositoryIds:{type:'array',maxItems:500,uniqueItems:true,items:ID}},
  required:['enforcedRepositories'],
  declarations:{production:'always',confirm:'always',profiles:['full']},target,
  read:(a,c,t)=>immutable(c,t),
  classify:()=>({production:'changes immutable-release enforcement across repositories'}),
  summarize:({args:a,before:b,target:t})=>{
    if(!b?.enforced_repositories)throw refusal('Immutable-release policy not readable.');
    if(a.enforcedRepositories==='selected'&&!a.repositoryIds?.length)
      throw refusal('Selected enforcement requires exact repository IDs.');
    if(a.enforcedRepositories!=='selected'&&a.repositoryIds?.length)
      throw refusal('Repository IDs only apply to selected enforcement.');
    return 'Change '+t.owner+' immutable releases from '+b.enforced_repositories+
      ' to '+a.enforcedRepositories+' on repository IDs '+JSON.stringify(a.repositoryIds??[]);
  },
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(!b?.enforced_repositories)throw refusal('Missing immutable-release baseline.');
    return (await client(ctx,t)).request('PUT /orgs/{org}/settings/immutable-releases',
      {...params(t),enforced_repositories:a.enforcedRepositories,
        ...(a.enforcedRepositories==='selected'?{selected_repository_ids:a.repositoryIds}:{})});
  },
  readAfter:({ctx,target:t})=>immutable(ctx,t),
  verify:({args:a,after:x})=>x?.enforced_repositories===a.enforcedRepositories&&
    (a.enforcedRepositories!=='selected'||same(
      [...(x.selected_repository_ids??[])].sort((a,b)=>a-b),
      [...a.repositoryIds].sort((a,b)=>a-b))),
  inverse:()=>null,present:({after:x})=>({
    enforced_repositories:x?.enforced_repositories,
    selected_repository_ids:x?.selected_repository_ids??[]})
});
export const tools=[orgUpdate.tool,orgInvite.tool,orgCancelInvitation.tool,
  orgSetMemberRole.tool,orgRemoveMember.tool,orgOutsideCollaborator.tool,
  orgSetBlocked.tool,orgCustomProperties.tool,orgSetImmutable.tool];
export const handlers=Object.fromEntries(tools.map(t=>[t.name,({
  [orgUpdate.tool.name]:orgUpdate,[orgInvite.tool.name]:orgInvite,
  [orgCancelInvitation.tool.name]:orgCancelInvitation,
  [orgSetMemberRole.tool.name]:orgSetMemberRole,[orgRemoveMember.tool.name]:orgRemoveMember,
  [orgOutsideCollaborator.tool.name]:orgOutsideCollaborator,[orgSetBlocked.tool.name]:orgSetBlocked,
  [orgCustomProperties.tool.name]:orgCustomProperties,
  [orgSetImmutable.tool.name]:orgSetImmutable
})[t.name].handler]));
