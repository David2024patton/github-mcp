// O-2: organization administration reads. No unscoped owner or unbounded inventory.
import {listAll} from '../github/client.js';
import {defineRead} from './define-read.js';
import {plain,readerFor} from './github-read.js';

const OWNER={type:'string',maxLength:39};
const MAX={type:'integer',minimum:1,maximum:500};
const ACCOUNT={owner:OWNER},limited={...ACCOUNT,max:MAX};
const projection=x=>({login:x.login,id:x.id,role:x.role??null,
  two_factor_authentication:x.two_factor_authentication??null,
  state:x.state??null});
const invite=x=>({id:x.id,login:x.invitee?.login??null,email:x.email??null,
  role:x.role??null,team_ids:x.team_ids??[],created_at:x.created_at??null,
  failed_reason:x.failed_reason??null});
export async function orgReader(a,ctx,fn){
  return plain(async()=>{
    const {owner,octokit:gh}=await readerFor(a,ctx);
    const account=await ctx.db.getAccount(owner);
    if(account?.account_type!=='Organization')
      throw new TypeError('Organization administration requires an enrolled organization.');
    return fn(gh,owner);
  });
}
export const orgGet=defineRead({
  name:'github_org_get',area:'org',audience:['O'],
  description:'Read the enrolled organization profile, plan, two-factor requirement and member policy without secrets.',
  properties:ACCOUNT,
  handler:(a,ctx)=>orgReader(a,ctx,async(gh,org)=>{
    const d=(await gh.request('GET /orgs/{org}',{org})).data;
    if(d?.login?.toLowerCase()!==org.toLowerCase())
      throw new TypeError('GitHub returned another organization.');
    return {org,profile:{login:d.login,id:d.id,name:d.name??null,
      description:d.description??null,company:d.company??null,
      location:d.location??null,blog:d.blog??null,email:d.email??null},
      plan:d.plan?.name??null,members_count:d.public_members_count??null,
      two_factor_required:d.two_factor_requirement_enabled??null,
      default_repository_permission:d.default_repository_permission??null,
      members_can_create_repositories:d.members_can_create_repositories??null,
      members_can_fork_private_repositories:d.members_can_fork_private_repositories??null,
      security_policy_readable:typeof d.two_factor_requirement_enabled==='boolean'};
  })
});
export const orgListMembers=defineRead({
  name:'github_org_list_members',area:'org',audience:['O'],
  description:'List scoped organization members, roles and optional outside collaborators; report incomplete results.',
  properties:{...limited,role:{type:'string',enum:['all','admin','member']},
    includeOutside:{type:'boolean'}},
  handler:(a,ctx)=>orgReader(a,ctx,async(gh,org)=>{
    const max=a.max??100;
    const res=await listAll(gh,'GET /orgs/{org}/members',
      {org,role:a.role??'all',per_page:100},{max});
    let outside=null;
    if(a.includeOutside)outside=await listAll(gh,
      'GET /orgs/{org}/outside_collaborators',{org,per_page:100},{max});
    return {org,members:res.items.map(projection),count:res.items.length,
      ...(outside?{outside_collaborators:outside.items.map(projection)}:{}),
      complete:!res.capped&&(!outside||!outside.capped),
      note:res.capped||outside?.capped?'Inventory capped; no all-member assertion is possible.':null};
  })
});
export const orgListInvitations=defineRead({
  name:'github_org_list_invitations',area:'org',audience:['O'],
  description:'Inspect bounded pending and failed organization invitations with exact IDs and recipient information.',
  properties:limited,
  handler:(a,ctx)=>orgReader(a,ctx,async(gh,org)=>{
    const max=a.max??100;
    const pending=await listAll(gh,'GET /orgs/{org}/invitations',{org,per_page:100},{max});
    const failed=await listAll(gh,'GET /orgs/{org}/failed_invitations',{org,per_page:100},{max});
    return {org,pending:pending.items.map(invite),failed:failed.items.map(invite),
      complete:!pending.capped&&!failed.capped};
  })
});
export const tools=[orgGet.tool,orgListMembers.tool,orgListInvitations.tool];
export const handlers=Object.fromEntries([
  [orgGet.tool,orgGet.handler],[orgListMembers.tool,orgListMembers.handler],
  [orgListInvitations.tool,orgListInvitations.handler]
].map(([t,h])=>[t.name,h]));
