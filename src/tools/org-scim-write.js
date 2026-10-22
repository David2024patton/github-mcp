// CAP-4: controlled organization (not enterprise-managed-user) SCIM writes.
// All three actions use the normal journaled GitHub write lifecycle, a verified
// enrolled organization, exact SCIM subject, full profile, production mode and
// confirmation. A 2xx alone never proves provisioning or deprovisioning.
import {defineGithubWrite} from './define-github-write.js';
import {octo,ownerOf,refusal,missing} from './github-write.js';
import {invitation} from './people-guard.js';

const OWNER={type:'string',minLength:1,maxLength:39};
const TEXT={type:'string',minLength:1,maxLength:150,pattern:'^[^\r\n\x00-\x1F]+$'};
const USER={type:'string',minLength:1,maxLength:200,format:'email'};
const ID={type:'string',minLength:4,maxLength:128,pattern:'^[A-Za-z0-9._-]+$'};
const R={
  list:'GET /scim/v2/organizations/{org}/Users',
  get:'GET /scim/v2/organizations/{org}/Users/{scim_user_id}',
  create:'POST /scim/v2/organizations/{org}/Users',
  patch:'PATCH /scim/v2/organizations/{org}/Users/{scim_user_id}',
  remove:'DELETE /scim/v2/organizations/{org}/Users/{scim_user_id}'
};
const headers={accept:'application/scim+json'};
const target=(a,c)=>({owner:ownerOf(a,c),scope:'org',kind:'org-scim',
  ...(a.scimUserId?{scimUserId:a.scimUserId}:{})});
async function client(c,t){
  const account=await c.db.getAccount(t.owner);
  if(account?.account_type!=='Organization')
    throw refusal('SCIM requires an exactly enrolled organization.');
  return octo(c,t.owner,'I');
}
async function scimGet(c,t,id){
  const gh=await client(c,t);
  const d=(await gh.request(R.get,{org:t.owner,scim_user_id:id,headers})).data;
  if(!d||typeof d!=='object'||d.id!==id||typeof d.userName!=='string'||
    !d.userName||typeof d.active!=='boolean')
    throw refusal('GitHub returned an invalid or mismatched SCIM identity.');
  return d;
}
const exact=(d,a)=>{
  if(!d||d.id!==a.scimUserId ||
    d.userName.toLowerCase()!==a.expectedUserName.toLowerCase())
    throw refusal('SCIM provider identity does not match the selected person.');
  return d;
};
async function matches(c,t,name){
  const gh=await client(c,t);
  const filter='userName eq "'+name.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
  const d=(await gh.request(R.list,{org:t.owner,count:2,startIndex:1,
    filter,headers})).data;
  if(!d||!Array.isArray(d.Resources)||!Number.isSafeInteger(d.totalResults)||
    d.totalResults<0||d.Resources.length>2||d.startIndex!==1||
    (d.itemsPerPage!==undefined&&d.itemsPerPage!==d.Resources.length)||
    (d.Resources.length===0&&d.totalResults>0)||
    (d.Resources.length>0&&d.Resources.length>d.totalResults))
    throw refusal('SCIM identity inventory is incomplete or invalid.');
  if(d.totalResults>1)
    throw refusal('SCIM identity is ambiguous; no membership will be changed.');
  if(d.totalResults===1 && (d.Resources.length!==1 ||
    typeof d.Resources[0]?.userName!=='string' ||
    d.Resources[0].userName.toLowerCase()!==name.toLowerCase()))
    throw refusal('SCIM identity inventory did not match the selected person.');
  return d.Resources;
}
const samePerson=(x,y)=>typeof x==='string'&&typeof y==='string'&&
  x.toLowerCase()===y.toLowerCase();
const profile=x=>({
  id:x.id,userName:x.userName,displayName:x.displayName??null,
  externalId:x.externalId??null,active:x.active??null
});
const changed=(a,b)=>a!==b;

export const orgScimProvision=defineGithubWrite({
  name:'github_org_scim_provision',area:'org',audience:['O'],
  description:'PRODUCTION: Invite an exact SAML organization identity by SCIM, with guarded confirmation and readback.',
  properties:{owner:OWNER,userName:USER,givenName:TEXT,familyName:TEXT,
    displayName:TEXT,externalId:{type:'string',minLength:1,maxLength:128}},
  required:['userName','givenName','familyName'],
  declarations:{production:'always',confirm:'always',accessWidening:true,
    notifies:true,profiles:['full']},target,
  read:async(a,c,t)=>({existing:await matches(c,t,a.userName)}),
  classify:({args:a,target:t})=>invitation({who:a.userName,
    access:'organization SCIM-provisioned membership',where:t.owner}),
  summarize:({args:a,target:t,before:b})=>
    'Invite '+a.userName+' to organization '+t.owner+
    ' through SAML SCIM. GitHub may reinstate prior privileges. Existing SCIM identities: '+
    b.existing.length+'. A provider email will be sent.',
  apply:async({args:a,ctx:c,target:t,before:b})=>{
    if(b.existing.length)throw refusal('The exact user is already SCIM provisioned.');
    const gh=await client(c,t);
    return gh.request(R.create,{org:t.owner,headers,
      userName:a.userName,displayName:a.displayName??a.givenName+' '+a.familyName,
      name:{givenName:a.givenName,familyName:a.familyName},
      emails:[{value:a.userName,primary:true}],
      ...(a.externalId?{externalId:a.externalId}:{})});
  },
  readAfter:async({ctx:c,target:t,response:r})=>{
    const id=r?.data?.id;
    if(typeof id!=='string'||!id||id.length>128)
      throw refusal('GitHub did not return a bounded new SCIM identifier.');
    return scimGet(c,t,id);
  },
  verify:({args:a,after:d,before:b})=>b?.existing?.length===0&&
    samePerson(d?.userName,a.userName)&&d.active===true&&
    d.displayName===(a.displayName??a.givenName+' '+a.familyName)&&
    (!a.externalId||d.externalId===a.externalId),
  inverse:()=>null,
  present:({after:d,target:t})=>({org:t.owner,identity:profile(d),
    note:'GitHub SCIM provisioning may reinstate previous member privileges. Review effective organization access separately.'})
});

export const orgScimSetDisplayName=defineGithubWrite({
  name:'github_org_scim_set_display_name',area:'org',audience:['O'],
  description:'PRODUCTION: Change only one verified SCIM display name without replacing or removing other identity attributes.',
  properties:{owner:OWNER,scimUserId:ID,expectedUserName:USER,displayName:TEXT},
  required:['scimUserId','expectedUserName','displayName'],
  declarations:{production:'always',confirm:'always',profiles:['full']},target,
  read:async(a,c,t)=>exact(await scimGet(c,t,a.scimUserId),a),
  classify:()=>({}),
  summarize:({args:a,target:t,before:b})=>
    'Change SCIM display name for '+a.expectedUserName+' in '+t.owner+
    ' from '+JSON.stringify(b.displayName??null)+' to '+JSON.stringify(a.displayName),
  apply:async({args:a,ctx:c,target:t,before:b})=>{
    if(!changed(a.displayName,b.displayName))
      throw refusal('SCIM display name is already set.');
    return (await client(c,t)).request(R.patch,{org:t.owner,
      scim_user_id:a.scimUserId,headers,
      Operations:[{op:'replace',path:'displayName',value:a.displayName}]});
  },
  readAfter:({args:a,ctx:c,target:t})=>scimGet(c,t,a.scimUserId),
  verify:({args:a,before:b,after:d})=>
    d?.id===b?.id&&samePerson(d?.userName,a.expectedUserName)&&
    d.displayName===a.displayName&&d.active===b.active&&
    d.externalId===b.externalId,
  inverse:()=>null,
  present:({after:d,target:t})=>({org:t.owner,identity:profile(d)})
});

export const orgScimDeprovision=defineGithubWrite({
  name:'github_org_scim_deprovision',area:'org',audience:['O'],
  description:'PRODUCTION: Remove an exact SCIM identity and organization membership; old identity ID cannot be restored.',
  properties:{owner:OWNER,scimUserId:ID,expectedUserName:USER},
  required:['scimUserId','expectedUserName'],
  declarations:{production:'always',confirm:'always',profiles:['full']},target,
  read:async(a,c,t)=>{
    const found=await missing(()=>scimGet(c,t,a.scimUserId));
    return found?exact(found,a):null;
  },
  classify:()=>({}),
  summarize:({args:a,target:t,before:b})=>
    'PERMANENT SCIM deprovision '+a.expectedUserName+' ('+(b?.id??'already absent')+
    ') in '+t.owner+'. This removes membership and deletes its external identity; the old ID cannot be restored.',
  apply:async({args:a,ctx:c,target:t,before:b})=>{
    if(!b)throw refusal('SCIM identity is already absent; no deletion will be sent.');
    exact(b,a);
    return (await client(c,t)).request(R.remove,{org:t.owner,
      scim_user_id:a.scimUserId,headers});
  },
  readAfter:async({args:a,ctx:c,target:t})=>{
    const individual=await missing(()=>scimGet(c,t,a.scimUserId));
    const byName=await matches(c,t,a.expectedUserName);
    return {identityStillReadable:Boolean(individual),
      nameStillProvisioned:byName.length>0};
  },
  verify:({after:d})=>d?.identityStillReadable===false&&
    d?.nameStillProvisioned===false,
  inverse:()=>null,
  present:({args:a,target:t})=>({org:t.owner,scimUserId:a.scimUserId,
    removed:true,note:'Identity deletion is not reversible by replay or undo.'})
});
export const tools=[orgScimProvision.tool,orgScimSetDisplayName.tool,
  orgScimDeprovision.tool];
export const handlers=Object.fromEntries([
  [orgScimProvision.tool,orgScimProvision.handler],
  [orgScimSetDisplayName.tool,orgScimSetDisplayName.handler],
  [orgScimDeprovision.tool,orgScimDeprovision.handler]
].map(([t,h])=>[t.name,h]));
