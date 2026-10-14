// H-3: explicit, independently checked repository access and deploy-key changes.
import {createHash} from 'node:crypto';
import {listAll} from '../github/client.js';
import {defineGithubWrite} from './define-github-write.js';
import {octo,ownerOf,missing,refusal,slug} from './github-write.js';
import {accessChange,invitation} from './people-guard.js';

const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const LOGIN={type:'string',minLength:1,maxLength:39,pattern:'^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'};
const ID={type:'integer',minimum:1},TITLE={type:'string',minLength:1,maxLength:255};
const PERMISSION={type:'string',enum:['pull','triage','push','maintain','admin']};
const BASE={owner:OWNER,repo:REPO},target=(a,c)=>({
  owner:ownerOf(a,c),repo:a.repo,scope:'repo',kind:'repo-settings'});
const params=t=>({owner:t.owner,repo:t.repo});
const who=(t,u)=>u+' in '+slug(t.owner,t.repo);
const getPermission=(ctx,t,username)=>missing(async()=>{
  const d=(await(await octo(ctx,t.owner)).request(
    'GET /repos/{owner}/{repo}/collaborators/{username}/permission',
    {...params(t),username})).data;
  if(!d?.permission||!d.user?.login||
    d.user.login.toLowerCase()!==username.toLowerCase())
    throw refusal('Cannot verify exact collaborator login and permission.');
  return {login:d.user.login,permission:d.permission,role_name:d.role_name??null};
});
const listInvitations=async(ctx,t)=>{
  const data=await listAll(await octo(ctx,t.owner),
    'GET /repos/{owner}/{repo}/invitations',{...params(t),per_page:100},{max:500});
  if(data.capped)throw refusal('Invitation inventory is truncated; no access write is safe.');
  return data.items.map(x=>({id:x.id,login:x.invitee?.login??null,
    permission:x.permissions==='write'?'push':x.permissions==='read'?'pull':x.permissions??x.permission??null}));
};
const direct=async(ctx,t)=>{
  const data=await listAll(await octo(ctx,t.owner),
    'GET /repos/{owner}/{repo}/collaborators',
    {...params(t),affiliation:'direct',per_page:100},{max:500});
  if(data.capped)throw refusal('Direct collaborator inventory is incomplete.');
  return data.items.map(x=>x.login).filter(Boolean);
};
const getKey=async(ctx,t,id)=>missing(async()=>{
  const d=(await(await octo(ctx,t.owner)).request(
    'GET /repos/{owner}/{repo}/keys/{key_id}',{...params(t),key_id:id})).data;
  if(!d||d.id!==id)throw refusal('Deploy key numeric identity changed.');
  return {id:d.id,title:d.title,read_only:d.read_only===true,
    fingerprint:typeof d.key==='string'?createHash('sha256').update(d.key.trim()).digest('hex').slice(0,20):null};
});
const keyHash=key=>createHash('sha256').update(key.trim()).digest('hex').slice(0,20);
const validateKey=value=>{
  if(typeof value!=='string'||value.length>8192||/PRIVATE KEY|BEGIN |\r|\n/.test(value)||
    !/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)) [A-Za-z0-9+/=]{40,}(?: [^\r\n]{0,255})?$/.test(value))
    throw new TypeError('Only one valid SSH PUBLIC key line is accepted. Never paste a private key.');
};
const listKeys=async(ctx,t)=>{
  const result=await listAll(await octo(ctx,t.owner),
    'GET /repos/{owner}/{repo}/keys',{...params(t),per_page:100},{max:500});
  if(result.capped)throw refusal('Deploy key inventory is incomplete; refusing to add a possible duplicate.');
  return result.items.map(k=>({id:k.id,title:k.title,read_only:k.read_only===true,
    fingerprint:typeof k.key==='string'?keyHash(k.key):null}));
};
export const collabAdd=defineGithubWrite({
  name:'github_collab_add',area:'collaborator',audience:['O'],
  description:'Invite or change one exact repository collaborator with approval and independent membership/invitation readback.',
  properties:{...BASE,username:LOGIN,permission:PERMISSION},required:['repo','username','permission'],
  declarations:{production:'always',confirm:'always',accessWidening:true,notifies:true,profiles:['full']},
  target,
  read:async(a,ctx,t)=>({current:await getPermission(ctx,t,a.username),
    invites:await listInvitations(ctx,t)}),
  classify:({args:a,before:b,target:t})=>({
    ...(b?.current?.permission===a.permission?{}:invitation({
      who:a.username,access:a.permission,where:slug(t.owner,t.repo),
      before:b?.current?.permission??'none'})),
    production:'changes repository collaborator access and may send an invitation'
  }),
  summarize:({args:a,before:b,target:t})=>
    'Grant '+a.permission+' to '+who(t,a.username)+
    '; existing effective permission: '+(b?.current?.permission??'none')+
    '; may invite and notify the named user',
  apply:({args:a,ctx,target:t})=>octo(ctx,t.owner).then(gh=>gh.request(
    'PUT /repos/{owner}/{repo}/collaborators/{username}',
    {...params(t),username:a.username,permission:a.permission})),
  readAfter:async({args:a,ctx,target:t})=>({current:await getPermission(ctx,t,a.username),
    invites:await listInvitations(ctx,t)}),
  verify:({args:a,after:x})=>x?.current?.permission===a.permission||
    x?.invites?.some(i=>i.login?.toLowerCase()===a.username.toLowerCase()&&
      i.permission===a.permission),
  inverse:()=>null,present:({args:a,after:x})=>({
    login:a.username,requested_permission:a.permission,
    effective_permission:x?.current?.permission??null,
    pending_invitation:x?.invites?.some(i=>i.login?.toLowerCase()===a.username.toLowerCase())??false,
    warning:'A pending invitation is not effective access until its recipient accepts.'})
});
export const collabRemove=defineGithubWrite({
  name:'github_collab_remove',area:'collaborator',audience:['O'],
  description:'Remove the exact direct repository collaborator after approval; report inherited access honestly.',
  properties:{...BASE,username:LOGIN},required:['repo','username'],
  declarations:{production:'always',confirm:'always',profiles:['full']},target,
  read:async(a,ctx,t)=>({direct:await direct(ctx,t),
    effective:await getPermission(ctx,t,a.username),invites:await listInvitations(ctx,t)}),
  classify:()=>({production:'removes a direct GitHub repository collaborator'}),
  summarize:({args:a,before:b,target:t})=>
    'REMOVE direct collaborator '+who(t,a.username)+
    '; current effective permission '+(b?.effective?.permission??'none')+
    '; inherited organization access may remain',
  apply:({args:a,ctx,target:t,before:b})=>{
    if(!b.direct.some(n=>n.toLowerCase()===a.username.toLowerCase()))
      throw refusal('No direct collaborator membership was verified for removal.');
    return octo(ctx,t.owner).then(gh=>gh.request(
      'DELETE /repos/{owner}/{repo}/collaborators/{username}',
      {...params(t),username:a.username}));
  },
  readAfter:async({args:a,ctx,target:t})=>({direct:await direct(ctx,t),
    effective:await getPermission(ctx,t,a.username),invites:await listInvitations(ctx,t)}),
  verify:({args:a,after:x})=>!!x&&!x.direct.some(n=>n.toLowerCase()===a.username.toLowerCase())&&
    !x.invites.some(i=>i.login?.toLowerCase()===a.username.toLowerCase()),
  inverse:()=>null,present:({args:a,after:x})=>({
    login:a.username,direct_membership_removed:true,
    remaining_inherited_permission:x?.effective?.permission??null})
});
export const manageInvitation=defineGithubWrite({
  name:'github_collab_manage_invitation',area:'collaborator',audience:['O'],
  description:'Change permission or cancel one verified pending repository invitation with exact readback.',
  properties:{...BASE,invitationId:ID,action:{type:'string',enum:['update','cancel']},
    permission:PERMISSION},required:['repo','invitationId','action'],
  declarations:{production:'always',confirm:'always',accessWidening:true,profiles:['full']},
  target:(a,c)=>{
    if(a.action==='update'&&!a.permission||a.action==='cancel'&&a.permission)
      throw new TypeError('Update needs permission; cancellation must not include it.');
    return target(a,c);
  },
  read:async(a,ctx,t)=>({invites:await listInvitations(ctx,t)}),
  classify:({args:a,before:b,target:t})=>{
    const current=b?.invites?.find(i=>i.id===a.invitationId);
    return {production:'changes or cancels a pending collaborator invitation',
      ...(a.action==='update'&&current?
        accessChange({who:current.login,access:a.permission,where:slug(t.owner,t.repo),
          before:current.permission}):{})};
  },
  summarize:({args:a,before:b,target:t})=>{
    const current=b?.invites?.find(i=>i.id===a.invitationId);
    if(!current?.login)throw refusal('Invitation owner and ID are not verified.');
    return (a.action==='cancel'?'CANCEL':'CHANGE')+' invitation #'+a.invitationId+
      ' for '+who(t,current.login)+' from '+current.permission+
      (a.action==='update'?' to '+a.permission:'');
  },
  apply:({args:a,ctx,target:t,before:b})=>{
    const current=b.invites.find(i=>i.id===a.invitationId);
    if(!current?.login)throw refusal('Pending invitation ID cannot be verified.');
    return octo(ctx,t.owner).then(gh=>gh.request(
      (a.action==='cancel'?'DELETE ':'PATCH ')+
        '/repos/{owner}/{repo}/invitations/{invitation_id}',
      {...params(t),invitation_id:a.invitationId,
        ...(a.action==='update'?{permissions:a.permission==='push'?'write':a.permission==='pull'?'read':a.permission}:{})}));
  },
  readAfter:({ctx,target:t})=>listInvitations(ctx,t),
  verify:({args:a,before:b,after:items})=>{
    const original=b.invites.find(i=>i.id===a.invitationId),next=items?.find(i=>i.id===a.invitationId);
    return original&&((a.action==='cancel'&&!next)||
      (a.action==='update'&&next?.login===original.login&&next.permission===a.permission));
  },
  inverse:()=>null,present:({args:a,before:b})=>({
    invitation_id:a.invitationId,invitee:b.invites.find(i=>i.id===a.invitationId)?.login,
    action:a.action})
});
export const deploykeyAdd=defineGithubWrite({
  name:'github_deploykey_add',area:'deploykey',audience:['O'],
  description:'Add one validated public SSH deploy key with confirmation, duplicate detection and readback.',
  properties:{...BASE,title:TITLE,key:{type:'string',minLength:50,maxLength:8192},
    readOnly:{type:'boolean'}},required:['repo','title','key','readOnly'],
  declarations:{production:'when-target',confirm:'always',accessWidening:true,profiles:['full']},
  target:(a,c)=>{validateKey(a.key);return target(a,c);},
  read:async(a,ctx,t)=>({keys:await listKeys(ctx,t)}),
  classify:({args:a,target:t})=>({
    ...accessChange({who:'SSH deploy key '+a.title,
      access:a.readOnly?'read-only':'write',where:slug(t.owner,t.repo)}),
    ...(a.readOnly?{}:{production:'a deploy key can write code to the repository'})}),
  summarize:({args:a,target:t})=>'ADD '+(a.readOnly?'READ-ONLY':'WRITE-CAPABLE')+
    ' deploy key '+a.title+' to '+slug(t.owner,t.repo)+
    '; SHA-256 fingerprint prefix '+keyHash(a.key),
  apply:async({args:a,ctx,target:t,before:b})=>{
    validateKey(a.key);
    if(b.keys.some(k=>k.fingerprint===keyHash(a.key)))
      throw refusal('The same public SSH key already has access to this repository.');
    return (await octo(ctx,t.owner)).request('POST /repos/{owner}/{repo}/keys',
      {...params(t),title:a.title,key:a.key,read_only:a.readOnly});
  },
  readAfter:({ctx,target:t,response:r})=>getKey(ctx,t,r?.data?.id),
  verify:({args:a,after:x})=>!!x&&x.fingerprint===keyHash(a.key)&&
    x.title===a.title&&x.read_only===a.readOnly,
  inverse:()=>null,present:({after:x})=>({
    id:x?.id,title:x?.title,read_only:x?.read_only,
    fingerprint:x?.fingerprint})
});
export const deploykeyDelete=defineGithubWrite({
  name:'github_deploykey_delete',area:'deploykey',audience:['O'],
  description:'Delete one exact deploy key by numeric ID, with independent absence verification.',
  properties:{...BASE,keyId:ID},required:['repo','keyId'],
  declarations:{production:'always',confirm:'always',profiles:['full']},target,
  read:async(a,ctx,t)=>({key:await getKey(ctx,t,a.keyId)}),
  classify:()=>({production:'removes an SSH deploy key and may break deployment automation'}),
  summarize:({args:a,target:t,before:b})=>
    'DELETE key #'+a.keyId+' '+(b?.key?.title??'unknown')+
    ' from '+slug(t.owner,t.repo)+'; automation using this key will stop',
  apply:({args:a,ctx,target:t,before:b})=>{
    if(!b.key)throw refusal('The named deploy key is already absent.');
    return octo(ctx,t.owner).then(gh=>gh.request(
      'DELETE /repos/{owner}/{repo}/keys/{key_id}',
      {...params(t),key_id:a.keyId}));
  },
  readAfter:({args:a,ctx,target:t})=>getKey(ctx,t,a.keyId),
  verify:({after:x})=>x===null,
  inverse:()=>null,present:({args:a})=>({deleted_deploy_key_id:a.keyId})
});
export const tools=[collabAdd.tool,collabRemove.tool,manageInvitation.tool,
  deploykeyAdd.tool,deploykeyDelete.tool];
export const handlers=Object.fromEntries([
  [collabAdd.tool,collabAdd.handler],[collabRemove.tool,collabRemove.handler],
  [manageInvitation.tool,manageInvitation.handler],
  [deploykeyAdd.tool,deploykeyAdd.handler],[deploykeyDelete.tool,deploykeyDelete.handler]
].map(([t,h])=>[t.name,h]));
