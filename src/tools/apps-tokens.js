// O-5: owner App installations and fine-grained organization token governance.
// Public metadata only: no token, key, installation JWT or authorization secret enters a tool.
import {defineRead} from './define-read.js';
import {defineGithubWrite} from './define-github-write.js';
import {plain} from './github-read.js';
import {octo,ownerOf,refusal} from './github-write.js';
import {accessChange} from './people-guard.js';

const OWNER={type:'string',minLength:1,maxLength:39};
const ID={type:'integer',minimum:1};
const MAX={type:'integer',minimum:1,maximum:500};
const REPO={type:'string',minLength:1,maxLength:100,
  pattern:'^[A-Za-z0-9_.-]+$'};
const root=(a,c)=>({owner:ownerOf(a,c),scope:'org',kind:'org-settings'});
const repoTarget=(a,c)=>({...root(a,c),repo:a.repo,
  scope:'repo',kind:'repo-settings',installation:a.installationId});
const orgAccount=async(c,t)=>{
  const account=await c.db.getAccount(t.owner);
  if(account?.account_type!=='Organization')
    throw refusal('Fine-grained token governance and organization installations require an enrolled organization.');
  return account;
};
const request=async(c,t,route,args={},cred='I')=>{
  const gh=await octo(c,t.owner,cred);
  const scoped=route.includes('/orgs/{org}/');
  return (await gh.request(route,{...(scoped?{org:t.owner}:{}),...args})).data;
};
const capped=async(c,t,route,key,params={},cred='I',max=100)=>{
  const rows=[];let total=null,complete=false;
  for(let page=1;page<=Math.ceil(max/100)+1;page++){
    const data=await request(c,t,route,{...params,per_page:100,page},cred);
    const batch=key?data?.[key]:data;
    if(!Array.isArray(batch))throw refusal('GitHub returned an unreadable inventory; no completeness claimed.');
    if(Number.isInteger(data?.total_count))total=data.total_count;
    rows.push(...batch);
    if(rows.length>=max){complete=batch.length<100&&rows.length<=max&&
      (total===null||total===rows.length);break;}
    if(batch.length<100||(total!==null&&rows.length>=total)){
      complete=total===null||total===rows.length;break;
    }
  }
  return {items:rows.slice(0,max),complete,total_count:total};
};
const same=(a,b)=>String(a??'').toLowerCase()===String(b??'');
const installation=x=>({id:x.id,app_id:x.app_id??null,app_slug:x.app_slug??null,
  account:x.account?.login??null,repository_selection:x.repository_selection??null,
  permissions:x.permissions??{},events:x.events??[],
  suspended_at:x.suspended_at??null,target_type:x.target_type??null});
const repository=x=>({id:x.id,full_name:x.full_name,private:x.private===true});
const token=x=>({id:x.id,token_id:x.token_id??null,token_name:x.token_name??null,
  owner:x.owner?.login??null,repository_selection:x.repository_selection??null,
  permissions:x.permissions??null,token_expired:x.token_expired===true,
  expires_at:x.token_expires_at??null,last_used_at:x.token_last_used_at??null,
  access_granted_at:x.access_granted_at??null});
const requestRow=x=>({...token(x),reason:x.reason??null,created_at:x.created_at??null});
const listInstall=async(c,t,max=500)=>{
  await orgAccount(c,t);
  return capped(c,t,'GET /orgs/{org}/installations','installations',{},'I',max);
};
const listRepos=async(c,t,id,max=500)=>capped(c,t,
  'GET /user/installations/{installation_id}/repositories','repositories',
  {installation_id:id},'U',max);
const findInstall=async(c,t,id)=>{
  const d=await listInstall(c,t,500);
  if(!d.complete)throw refusal('Installation inventory is incomplete; exact App identity cannot be established.');
  const value=d.items.find(x=>x.id===id);
  if(!value||!same(value.account?.login,t.owner))
    throw refusal('Installation is not verified under this organization.');
  return value;
};
const requests=async(c,t,max=500)=>{
  await orgAccount(c,t);
  return capped(c,t,'GET /orgs/{org}/personal-access-token-requests',null,{},'I',max);
};
const tokens=async(c,t,max=500)=>{
  await orgAccount(c,t);
  return capped(c,t,'GET /orgs/{org}/personal-access-tokens',null,{},'I',max);
};
const exact=async(fn,id)=>{
  const inventory=await fn();
  if(!inventory.complete)throw refusal('Token inventory incomplete; cannot safely identify one request.');
  return {inventory,value:inventory.items.find(x=>x.id===id)??null};
};
const readSpecs=[
  {
    name:'github_app_list_installations',description:'Inspect installed GitHub Apps and their verified permissions in the enrolled organization or user account.',
    properties:{owner:OWNER,scope:{type:'string',enum:['organization','user']},max:MAX},
    handler:(a,c)=>plain(async()=>{
      const t=root(a,c),max=a.max??100;
      if(a.scope==='user'){
        const data=await capped(c,t,'GET /user/installations','installations',{},'U',max);
        const selected=data.items.filter(x=>same(x.account?.login,t.owner));
        return {owner:t.owner,scope:'user',installations:selected.map(installation),
          complete:data.complete,note:'User token shows only installations visible to that user.'};
      }
      const data=await listInstall(c,t,max);
      return {owner:t.owner,scope:'organization',installations:data.items.map(installation),
        complete:data.complete,total_count:data.total_count};
    })
  },
  {
    name:'github_app_get_installation',description:'Inspect one verified installation, its access permissions and a bounded repository selection without exposing secrets.',
    properties:{owner:OWNER,installationId:ID,max:MAX},required:['installationId'],
    handler:(a,c)=>plain(async()=>{
      const t=root(a,c),found=await findInstall(c,t,a.installationId);
      let selected=null,complete=false,visibility='unreadable';
      try {
        const repos=await listRepos(c,t,a.installationId,a.max??100);
        selected=repos.items.map(repository);complete=repos.complete;
        visibility='user-authorized';
      }catch(error){
        // No invented full repository inventory if the user's grant cannot read it.
        if(![403,404].includes(error?.status))throw error;
      }
      return {owner:t.owner,installation:installation(found),
        repositories:selected,repositories_complete:complete,
        repositories_visibility:visibility};
    })
  },
  {
    name:'github_tokenpolicy_list_requests',description:'List pending fine-grained token organization access requests with exact IDs, owners, expiry and scoped permissions.',
    properties:{owner:OWNER,max:MAX},
    handler:(a,c)=>plain(async()=>{
      const t=root(a,c),d=await requests(c,t,a.max??100);
      return {owner:t.owner,requests:d.items.map(requestRow),complete:d.complete};
    })
  },
  {
    name:'github_tokenpolicy_list_tokens',description:'List approved fine-grained tokens reaching an organization with owners, expiry and permissions, never token values.',
    properties:{owner:OWNER,max:MAX},
    handler:(a,c)=>plain(async()=>{
      const t=root(a,c),d=await tokens(c,t,a.max??100);
      return {owner:t.owner,tokens:d.items.map(token),complete:d.complete};
    })
  }
];
const requestRepoRows=async(c,t,id)=>{
  const x=await capped(c,t,
    'GET /orgs/{org}/personal-access-token-requests/{pat_request_id}/repositories',
    null,{pat_request_id:id},'I',500);
  if(!x.complete)throw refusal('Requested repositories are truncated; approval refused.');
  return x.items.map(repository);
};
const existingTokenRepos=async(c,t,id)=>{
  const x=await capped(c,t,
    'GET /orgs/{org}/personal-access-tokens/{pat_id}/repositories',
    null,{pat_id:id},'I',500);
  if(!x.complete)throw refusal('Approved token repository inventory incomplete.');
  return x.items.map(repository);
};
const selectRepos=defineGithubWrite({
  name:'github_app_set_installation_repos',area:'app',audience:['O'],
  description:'Add or remove one exact repository from a verified App installation with locked-App protection and readback.',
  properties:{owner:OWNER,repo:REPO,installationId:ID,
    action:{type:'string',enum:['add','remove']}},
  required:['repo','installationId','action'],
  declarations:{production:'always',confirm:'always',accessWidening:true,profiles:['full']},
  target:repoTarget,
  read:async(a,c,t)=>{
    const app=await findInstall(c,t,a.installationId);
    if(app.suspended_at)throw refusal('Suspended App installation cannot be changed.');
    if(app.repository_selection!=='selected')
      throw refusal('Installation manages all repositories; change selection in GitHub settings.');
    const gh=await octo(c,t.owner,'U');
    const d=(await gh.request('GET /repos/{owner}/{repo}',
      {owner:t.owner,repo:a.repo})).data;
    if(!same(d?.full_name,t.owner+'/'+a.repo)||!Number.isInteger(d.id)||
      d.permissions?.admin!==true)
      throw refusal('Exact repository and user administration permission not verified.');
    const before=await listRepos(c,t,a.installationId,500);
    if(!before.complete)throw refusal('Installation repository inventory is incomplete.');
    return {app:installation(app),repo:repository(d),
      installed:before.items.some(x=>x.id===d.id),
      count:before.items.length};
  },
  classify:({args:a,before:b,target:t})=>({
    production:'installation repository access is an organization-wide authorization',
    ...(a.action==='add'?accessChange({who:b?.app?.app_slug??'GitHub App',
      access:'repository access',where:t.owner+'/'+a.repo,
      before:b?.installed?'already installed':'none'}):{})
  }),
  summarize:({args:a,before:b,target:t})=>a.action.toUpperCase()+
    ' repository '+t.owner+'/'+a.repo+' to App '+a.installationId+
    '; existing installation repo count '+(b?.count??'unknown'),
  apply:async({args:a,ctx:c,target:t,before:b})=>{
    if(!b?.repo?.id)throw refusal('Repository identity was not verified.');
    if(a.action==='add'&&b.installed||a.action==='remove'&&!b.installed)
      throw refusal('Repository already has the requested installation state.');
    if(a.action==='remove'&&b.count<=1)
      throw refusal('Cannot remove last installed repository.');
    return (await octo(c,t.owner,'U')).request(
      (a.action==='add'?'PUT ':'DELETE ')+
        '/user/installations/{installation_id}/repositories/{repository_id}',
      {installation_id:a.installationId,repository_id:b.repo.id});
  },
  readAfter:({args:a,ctx:c,target:t})=>listRepos(c,t,a.installationId,500),
  verify:({args:a,before:b,after:x})=>x?.complete===true&&
    x.items.some(r=>r.id===b.repo.id)===(a.action==='add')&&
    x.items.length===b.count+(a.action==='add'?1:-1),
  inverse:()=>null,present:({args:a,before:b})=>({
    installation_id:a.installationId,repo:b.repo.full_name,action:a.action,
    verified:true})
});
const reviewRequest=defineGithubWrite({
  name:'github_tokenpolicy_review_request',area:'tokenpolicy',audience:['O'],
  description:'Approve or deny one verified pending fine-grained token request with scoped access preview and readback.',
  properties:{owner:OWNER,requestId:ID,action:{type:'string',enum:['approve','deny']},
    reason:{type:'string',maxLength:1024}},required:['requestId','action'],
  declarations:{production:'always',confirm:'always',accessWidening:true,profiles:['full']},
  target:root,
  read:async(a,c,t)=>{
    const found=await exact(()=>requests(c,t),a.requestId);
    // The replay path still needs a readable baseline after GitHub removes the
    // approved/denied request from pending inventory. The journal, not a
    // guessed provider outcome, decides whether it is a replay.
    if(!found.value)return {request:null,repositories:[]};
    const repos=await requestRepoRows(c,t,a.requestId);
    return {request:requestRow(found.value),repositories:repos};
  },
  classify:({args:a,before:b,target:t})=>({
    production:'organization fine-grained personal access token authorization',
    ...(a.action==='approve'?accessChange({
      who:b?.request?.owner??'unverified owner',
      access:JSON.stringify(b?.request?.permissions??{}),
      where:t.owner+' / '+b.repositories.map(x=>x.full_name).join(', '),
      before:'pending approval'}):{})
  }),
  summarize:({args:a,before:b,target:t})=>a.action.toUpperCase()+
    ' pending token request '+a.requestId+' owned by '+
    b?.request?.owner+' in '+t.owner+'; repositories '+
    b?.repositories?.map(x=>x.full_name).join(', '),
  apply:async({args:a,ctx:c,target:t,before:b})=>{
    if(!b?.request?.id||!b?.request?.owner)
      throw refusal('Token request owner not verified.');
    if(a.action==='approve'&&!b.repositories.length&&
      b.request.repository_selection!=='all')
      throw refusal('Selected-repository approval requires verified requested repositories.');
    return (await octo(c,t.owner)).request(
      'POST /orgs/{org}/personal-access-token-requests/{pat_request_id}',
      {org:t.owner,pat_request_id:a.requestId,action:a.action,
        ...(a.reason?{reason:a.reason}:{})});
  },
  readAfter:async({ctx:c,target:t})=>{
    const pending=await requests(c,t),granted=await tokens(c,t);
    return {pending,granted};
  },
  verify:({args:a,before:b,after:x})=>{
    if(!x?.pending?.complete||!x?.granted?.complete||
      x.pending.items.some(i=>i.id===a.requestId))return false;
    const found=x.granted.items.some(i=>i.token_id===b.request.token_id);
    return a.action==='approve'?found:!found;
  },
  inverse:()=>null,present:({args:a,before:b})=>({
    request_id:a.requestId,owner:b.request.owner,action:a.action,verified:true})
});
const revoke=defineGithubWrite({
  name:'github_tokenpolicy_revoke_access',area:'tokenpolicy',audience:['O'],
  description:'Revoke one verified approved fine-grained token from an organization with independent absent-access readback.',
  properties:{owner:OWNER,tokenId:ID},required:['tokenId'],
  declarations:{production:'always',confirm:'always',profiles:['full']},
  target:root,
  read:async(a,c,t)=>{
    const found=await exact(()=>tokens(c,t),a.tokenId);
    // An already revoked token disappears from the inventory. Preserve readable
    // absence so an identical request can reach the change journal for replay.
    if(!found.value)return {token:null,repositories:[]};
    return {token:token(found.value),repositories:
      await existingTokenRepos(c,t,a.tokenId)};
  },
  classify:()=>({production:'revokes a token holder’s access to organization resources'}),
  summarize:({args:a,before:b,target:t})=>
    'REVOKE token '+a.tokenId+' owned by '+b?.token?.owner+
    ' from '+t.owner+'; existing repos '+b?.repositories.map(x=>x.full_name).join(', '),
  apply:({args:a,ctx:c,target:t})=>octo(c,t.owner).then(gh=>gh.request(
    'POST /orgs/{org}/personal-access-tokens/{pat_id}',
    {org:t.owner,pat_id:a.tokenId,action:'revoke'})),
  readAfter:({ctx:c,target:t})=>tokens(c,t),
  verify:({args:a,after:x})=>x?.complete===true&&
    !x.items.some(row=>row.id===a.tokenId),
  inverse:()=>null,present:({args:a,before:b})=>({
    token_id:a.tokenId,owner:b.token.owner,organization_access_revoked:true})
});
const all=[...readSpecs.map(defineRead),selectRepos,reviewRequest,revoke];
export const tools=all.map(x=>x.tool);
export const handlers=Object.fromEntries(all.map(x=>[x.tool.name,x.handler]));
