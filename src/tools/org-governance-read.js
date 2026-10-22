// CAP-4: organization-scoped audit and SCIM identity reads. These are NOT
// enterprise-account audit, enterprise-managed-user SCIM, or an IdP write API.
// GitHub's own permission/SSO denial is preserved; no token is ever a tool arg.
import {defineRead} from './define-read.js';
import {orgReader} from './org-read.js';

const OWNER={type:'string',minLength:1,maxLength:39};
const MAX={type:'integer',minimum:1,maximum:100};
const SCIM_ID={type:'string',minLength:4,maxLength:128,
  pattern:'^[A-Za-z0-9._-]+$'};
const ACCOUNT={owner:OWNER};
const EVENT=['action','actor','created_at','_document_id','org',
  'repo','user','team'];
const permitted=(o,org)=>String(o).toLowerCase()===org.toLowerCase();
const auditView=(event,org)=>{
  if(!event || typeof event!=='object' || Array.isArray(event) ||
    typeof event.action!=='string' || !event.action ||
    (event.org!==undefined && !permitted(event.org,org)))
    throw new TypeError('GitHub returned an invalid or foreign organization audit event.');
  return Object.fromEntries(EVENT.filter(k=>Object.hasOwn(event,k))
    .map(k=>[k,event[k]]));
};
const scimView=user=>{
  if(!user || typeof user!=='object' || Array.isArray(user) ||
    typeof user.id!=='string' || !user.id ||
    typeof user.userName!=='string' || !user.userName)
    throw new TypeError('GitHub returned an invalid SCIM identity.');
  return {id:user.id,userName:user.userName,externalId:user.externalId??null,
    displayName:user.displayName??null,active:user.active??null,
    lastModified:user.meta?.lastModified??null};
};

export const orgAuditRead=defineRead({
  name:'github_org_audit_read',area:'org',audience:['O'],
  description:'Read a bounded page of organization audit events with a small approved projection, never raw audit payloads.',
  properties:{...ACCOUNT,max:MAX,
    include:{type:'string',enum:['web','git','all']},
    order:{type:'string',enum:['asc','desc']},
    phrase:{type:'string',minLength:1,maxLength:200},
    after:{type:'string',minLength:1,maxLength:500},
    before:{type:'string',minLength:1,maxLength:500}},
  handler:(a,ctx)=>orgReader(a,ctx,async(gh,org)=>{
    const max=a.max??30;
    if(a.after!==undefined && a.before!==undefined)
      throw new TypeError('Use one audit cursor direction at a time.');
    const resp=await gh.request('GET /orgs/{org}/audit-log',{
      org,per_page:max,include:a.include??'web',order:a.order??'desc',
      ...(a.phrase!==undefined?{phrase:a.phrase}:{}),
      ...(a.after!==undefined?{after:a.after}:{}),
      ...(a.before!==undefined?{before:a.before}:{})});
    if(!Array.isArray(resp.data) || resp.data.length>max)
      throw new TypeError('GitHub returned an unbounded organization audit page.');
    const events=resp.data.map(event=>auditView(event,org));
    const next=/<[^>]+>;\s*rel="next"/.test(String(resp.headers?.link??''));
    return {org,kind:'organization-audit',events,count:events.length,
      complete:!next&&events.length<max,
      note:next||events.length===max?
        'Only this page was read; more events may exist. Use the GitHub audit cursor for the next page.':null};
  })
});
export const orgScimList=defineRead({
  name:'github_org_scim_list',area:'org',audience:['O'],
  description:'Read bounded SAML-SSO organization SCIM identities, excluding raw email lists and provider payloads.',
  properties:{...ACCOUNT,max:MAX,
    startIndex:{type:'integer',minimum:1,maximum:1000000}},
  handler:(a,ctx)=>orgReader(a,ctx,async(gh,org)=>{
    const max=a.max??30,startIndex=a.startIndex??1;
    const response=await gh.request('GET /scim/v2/organizations/{org}/Users',
      {org,count:max,startIndex,headers:{accept:'application/scim+json'}});
    const d=response.data;
    if(!d || !Array.isArray(d.Resources) ||
      !Number.isSafeInteger(d.totalResults) || d.totalResults<0 ||
      !Number.isSafeInteger(d.startIndex) || d.startIndex!==startIndex ||
      d.Resources.length>max)
      throw new TypeError('GitHub returned an invalid organization SCIM page.');
    const identities=d.Resources.map(scimView);
    if(new Set(identities.map(x=>x.id)).size!==identities.length)
      throw new TypeError('GitHub returned duplicate organization SCIM identities.');
    const nextIndex=startIndex+identities.length;
    return {org,kind:'organization-scim',identities,
      totalReported:d.totalResults,shown:identities.length,startIndex,
      complete:nextIndex>d.totalResults,
      nextStartIndex:identities.length && nextIndex<=d.totalResults?nextIndex:null,
      note:nextIndex<=d.totalResults?
        'SCIM inventory is incomplete; fetch the next bounded page before asserting absence.':null};
  })
});
export const orgScimGet=defineRead({
  name:'github_org_scim_get',area:'org',audience:['O'],
  description:'Read one exact organization SCIM identity by provider ID without exposing emails or raw SCIM fields.',
  properties:{...ACCOUNT,scimUserId:SCIM_ID},required:['scimUserId'],
  handler:(a,ctx)=>orgReader(a,ctx,async(gh,org)=>{
    const d=(await gh.request(
      'GET /scim/v2/organizations/{org}/Users/{scim_user_id}',
      {org,scim_user_id:a.scimUserId,headers:{accept:'application/scim+json'}})).data;
    const identity=scimView(d);
    if(identity.id!==a.scimUserId)
      throw new TypeError('GitHub returned a different SCIM identity.');
    return {org,kind:'organization-scim',identity};
  })
});
export const tools=[orgAuditRead.tool,orgScimList.tool,orgScimGet.tool];
export const handlers=Object.fromEntries([
  [orgAuditRead.tool,orgAuditRead.handler],
  [orgScimList.tool,orgScimList.handler],
  [orgScimGet.tool,orgScimGet.handler]
].map(([t,h])=>[t.name,h]));
