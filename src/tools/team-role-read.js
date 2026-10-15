// O-3: bounded team/repository access and organization-role inspections.
import {listAll} from '../github/client.js';
import {defineRead} from './define-read.js';
import {readerFor,plain} from './github-read.js';

const OWNER={type:'string',maxLength:39};
const SLUG={type:'string',minLength:1,maxLength:100,
  pattern:'^[a-zA-Z0-9][a-zA-Z0-9_-]*$'};
const MAX={type:'integer',minimum:1,maximum:500};
const scope={owner:OWNER},teamSchema={...scope,teamSlug:SLUG};
const safeTeam=x=>({id:x.id,slug:x.slug,name:x.name,
  description:x.description??null,privacy:x.privacy??null,
  parent_id:x.parent?.id??null,permission:x.permission??null,
  members_count:x.members_count??null,repos_count:x.repos_count??null});
const safeMember=x=>({login:x.login,id:x.id});
const safeRepo=x=>({name:x.name,full_name:x.full_name,private:x.private===true,
  permissions:x.permissions??null,role_name:x.role_name??null});
export async function readOrg(a,ctx,fn){
  return plain(async()=>{
    const {owner,octokit:gh}=await readerFor(a,ctx);
    const account=await ctx.db.getAccount(owner);
    if(account?.account_type!=='Organization')
      throw new TypeError('Teams and roles require an enrolled organization.');
    return fn(gh,owner);
  });
}
async function bounded(gh,route,args,max){
  const result=await listAll(gh,route,{...args,per_page:100},{max});
  return {items:result.items,complete:!result.capped};
}
export const teamList=defineRead({
  name:'github_team_list',area:'team',audience:['O'],
  description:'List bounded teams with parent, privacy, permissions, and member/repository counts for the enrolled organization.',
  properties:{...scope,max:MAX},
  handler:(a,c)=>readOrg(a,c,async(gh,org)=>{
    const res=await bounded(gh,'GET /orgs/{org}/teams',{org},a.max??100);
    return {org,teams:res.items.map(safeTeam),complete:res.complete,
      note:res.complete?null:'Team inventory was capped; no full-coverage claim.'};
  })
});
export const teamGet=defineRead({
  name:'github_team_get',area:'team',audience:['O'],
  description:'Inspect an exact team and bounded member/repository memberships and their effective repository permissions.',
  properties:{...teamSchema,max:MAX},required:['teamSlug'],
  handler:(a,c)=>readOrg(a,c,async(gh,org)=>{
    const p={org,team_slug:a.teamSlug},max=a.max??100;
    const team=(await gh.request('GET /orgs/{org}/teams/{team_slug}',p)).data;
    if(!team?.slug||team.slug.toLowerCase()!==a.teamSlug.toLowerCase()||
       team.organization?.login&&team.organization.login.toLowerCase()!==org.toLowerCase())
      throw new TypeError('GitHub did not return the exact scoped team.');
    const members=await bounded(gh,'GET /orgs/{org}/teams/{team_slug}/members',p,max);
    const repos=await bounded(gh,'GET /orgs/{org}/teams/{team_slug}/repos',p,max);
    return {org,team:safeTeam(team),members:members.items.map(safeMember),
      repositories:repos.items.map(safeRepo),
      complete:members.complete&&repos.complete,
      note:members.complete&&repos.complete?null:
        'Partial membership/repository inventory; no complete access inference.'};
  })
});
const safeRole=x=>({id:x.id,name:x.name??null,description:x.description??null,
  type:x.type??null,permissions:x.permissions??null});
export async function rolesFor(gh,org,max=500){
  // Role endpoint varies by GitHub plan and responds with {roles,total_count}.
  const roles=[],size=100;
  for(let page=1;page<=5;page++){
    const d=(await gh.request('GET /orgs/{org}/organization-roles',
      {org,per_page:size,page})).data;
    const rows=Array.isArray(d)?d: d?.roles;
    if(!Array.isArray(rows))throw new TypeError('GitHub role inventory was malformed.');
    roles.push(...rows);
    if(roles.length>max||Number.isInteger(d?.total_count)&&d.total_count>max)
      return {roles:roles.slice(0,max),complete:false};
    if(rows.length<size)return {roles,complete:true};
  }
  return {roles:roles.slice(0,max),complete:false};
}
export const roleList=defineRead({
  name:'github_role_list',area:'role',audience:['O'],
  description:'List accessible organization roles and privilege metadata; classify unsupported plans and denied permissions.',
  properties:{...scope,max:MAX},
  handler:(a,c)=>readOrg(a,c,async(gh,org)=>{
    try{
      const res=await rolesFor(gh,org,a.max??100);
      return {org,roles:res.roles.map(safeRole),complete:res.complete,
        availability:res.complete?'available':'partial',plan_requirement:null};
    }catch(error){
      if(error?.status===422)return {org,roles:[],complete:false,
        availability:'not_available_on_plan',reason:'Organization roles feature not enabled or supported.'};
      if([403,404].includes(error?.status))return {org,roles:[],complete:false,
        availability:'not_readable',reason:'GitHub did not grant organization role inventory access.'};
      throw error;
    }
  })
});
export const tools=[teamList.tool,teamGet.tool,roleList.tool];
export const handlers=Object.fromEntries([
  [teamList.tool,teamList.handler],[teamGet.tool,teamGet.handler],
  [roleList.tool,roleList.handler]
].map(([t,h])=>[t.name,h]));
