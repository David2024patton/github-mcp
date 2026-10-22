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
const permitted=(o,org)=>typeof o==='string'&&o.toLowerCase()===org.toLowerCase();

// This is a security log, not a raw provider response. Never return nested
// provider objects, unknown event fields or unbounded identity strings.
const auditValue=(value,label)=>{
  if ((typeof value!=='string' &&
      !(typeof value==='number' && Number.isSafeInteger(value))) ||
      (typeof value==='string' && (value.length>512 || /[\x00-\x1F]/.test(value))))
    throw new TypeError('GitHub returned an invalid audit '+label+' field.');
  return value;
};
const auditView=(event,org)=>{
  if(!event || typeof event!=='object' || Array.isArray(event) ||
    typeof event.action!=='string' || !event.action ||
    (event.org!==undefined && !permitted(event.org,org)))
    throw new TypeError('GitHub returned an invalid or foreign organization audit event.');
  return Object.fromEntries(EVENT.filter(k=>Object.hasOwn(event,k))
    .map(k=>[k,auditValue(event[k],k)]));
};

// GitHub's audit Link header can contain other relations. Return only a
// validated, same-org cursor, not an arbitrary next URL for tools to follow.
function nextAuditCursor(link,org){
  if(link===undefined||link===null||link==='')return null;
  if(typeof link!=='string'||link.length>4096)
    throw new TypeError('GitHub returned an invalid audit pagination link.');
  const next=link.split(',').map(s=>s.trim())
    .filter(s=>/;\s*rel="next"(?:\s*;|$)/.test(s));
  if(!next.length)return null;
  if(next.length!==1)throw new TypeError('GitHub returned ambiguous audit pagination.');
  const match=/^<([^<>]+)>;\s*rel="next"(?:\s*;.*)?$/.exec(next[0]);
  if(!match)throw new TypeError('GitHub returned a malformed audit pagination link.');
  let url;
  try{url=new URL(match[1]);}catch{
    throw new TypeError('GitHub returned an invalid audit pagination URL.');
  }
  if(url.origin!=='https://api.github.com' ||
    url.pathname!==('/orgs/'+encodeURIComponent(org)+'/audit-log') ||
    url.username||url.password||url.hash)
    throw new TypeError('GitHub returned a foreign audit pagination target.');
  const directions=['after','before'].filter(k=>url.searchParams.has(k));
  if(directions.length!==1 ||
    url.searchParams.getAll(directions[0]).length!==1)
    throw new TypeError('GitHub omitted a unique audit pagination cursor.');
  const cursor=url.searchParams.get(directions[0]);
  if(!cursor||cursor.length>500||/[\x00-\x1F]/.test(cursor))
    throw new TypeError('GitHub returned an invalid audit pagination cursor.');
  return {direction:directions[0],cursor};
}

// SCIM raw responses carry names, IdP contact lists and provider URLs.
// Expose only bounded scalar identity fields and never assume a SCIM user
// is linked to an ordinary organization member.
const scimText=(value,label,required=false)=>{
  if(value===undefined||value===null){
    if(required)throw new TypeError('GitHub returned an invalid SCIM '+label+'.');
    return null;
  }
  if(typeof value!=='string'||!value||value.length>512 ||
    /[\x00-\x1F]/.test(value))
    throw new TypeError('GitHub returned an invalid SCIM '+label+'.');
  return value;
};
const scimView=user=>{
  if(!user||typeof user!=='object'||Array.isArray(user))
    throw new TypeError('GitHub returned an invalid SCIM identity.');
  if(user.active!==undefined&&typeof user.active!=='boolean')
    throw new TypeError('GitHub returned an invalid SCIM active status.');
  return {id:scimText(user.id,'id',true),
    userName:scimText(user.userName,'userName',true),
    externalId:scimText(user.externalId,'externalId'),
    displayName:scimText(user.displayName,'displayName'),
    active:user.active??null,
    lastModified:scimText(user.meta?.lastModified,'lastModified')};
};
function scimFilter(field,value){
  if((field===undefined)!==(value===undefined))
    throw new TypeError('SCIM identity filter field and value must be supplied together.');
  if(field===undefined)return null;
  if(!['id','userName','externalId','emails'].includes(field) ||
    typeof value!=='string'||!value||value.length>128||
    /[\x00-\x1F]/.test(value))
    throw new TypeError('Invalid bounded SCIM identity filter.');
  // Only documented exact equality, no arbitrary expression or path.
  return field+' eq "'+value.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
}

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
    if(a.after!==undefined&&a.before!==undefined)
      throw new TypeError('Use one audit cursor direction at a time.');
    const resp=await gh.request('GET /orgs/{org}/audit-log',{
      org,per_page:max,include:a.include??'web',order:a.order??'desc',
      ...(a.phrase!==undefined?{phrase:a.phrase}:{}),
      ...(a.after!==undefined?{after:a.after}:{}),
      ...(a.before!==undefined?{before:a.before}:{})});
    if(!Array.isArray(resp.data)||resp.data.length>max)
      throw new TypeError('GitHub returned an unbounded organization audit page.');
    const events=resp.data.map(event=>auditView(event,org));
    const next=nextAuditCursor(resp.headers?.link,org);
    const complete=!next&&events.length<max;
    return {org,kind:'organization-audit',events,count:events.length,
      complete,nextAfter:next?.direction==='after'?next.cursor:null,
      nextBefore:next?.direction==='before'?next.cursor:null,
      note:complete?null:next?
        'This is one audit page. Repeat the same filters with nextAfter or nextBefore to continue.':
        'No next cursor was supplied; do not assume a full audit page is the entire inventory.'};
  })
});
export const orgScimList=defineRead({
  name:'github_org_scim_list',area:'org',audience:['O'],
  description:'Read bounded SAML-SSO organization SCIM identities, excluding raw email lists and provider payloads.',
  properties:{...ACCOUNT,max:MAX,
    startIndex:{type:'integer',minimum:1,maximum:1000000},
    matchField:{type:'string',enum:['id','userName','externalId','emails']},
    matchValue:{type:'string',minLength:1,maxLength:128}},
  handler:(a,ctx)=>orgReader(a,ctx,async(gh,org)=>{
    const max=a.max??30,startIndex=a.startIndex??1;
    const filter=scimFilter(a.matchField,a.matchValue);
    const response=await gh.request('GET /scim/v2/organizations/{org}/Users',
      {org,count:max,startIndex,...(filter?{filter}:{}),
        headers:{accept:'application/scim+json'}});
    const d=response.data;
    if(!d || !Array.isArray(d.Resources) ||
      !Number.isSafeInteger(d.totalResults)||d.totalResults<0 ||
      !Number.isSafeInteger(d.startIndex)||d.startIndex!==startIndex ||
      d.Resources.length>max ||
      (d.itemsPerPage!==undefined&&d.itemsPerPage!==d.Resources.length) ||
      d.totalResults<startIndex-1 ||
      (d.Resources.length===0&&d.totalResults>=startIndex) ||
      (d.Resources.length>0&&startIndex+d.Resources.length-1>d.totalResults))
      throw new TypeError('GitHub returned an invalid or stalled organization SCIM page.');
    const identities=d.Resources.map(scimView);
    if(new Set(identities.map(x=>x.id)).size!==identities.length)
      throw new TypeError('GitHub returned duplicate organization SCIM identities.');
    const nextIndex=startIndex+identities.length;
    return {org,kind:'organization-scim',identities,
      totalReported:d.totalResults,shown:identities.length,startIndex,
      complete:nextIndex>d.totalResults,
      nextStartIndex:identities.length&&nextIndex<=d.totalResults?nextIndex:null,
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
