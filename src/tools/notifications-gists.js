// O-7: optional K-credential notification inbox + U-authorized gist lifecycle.
// Never enroll an optional classic token automatically or infer success from HTTP 202.
import {githubFor,listAll} from '../github/client.js';
import {personalCred} from '../github/personal-cred.js';
import {defineRead} from './define-read.js';
import {defineGithubWrite} from './define-github-write.js';
import {plain} from './github-read.js';
import {ownerOf,refusal} from './github-write.js';
import {accessChange} from './people-guard.js';

const OWNER={type:'string',minLength:1,maxLength:39};
const REPO={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9_.-]+$'};
const MAX={type:'integer',minimum:1,maximum:500};
const ID={type:'string',minLength:1,maxLength:64,pattern:'^[0-9a-fA-F]+$'};
const THREAD={type:'integer',minimum:1};
const DATE={type:'string',maxLength:35};
const FILE={type:'object',properties:{
  name:{type:'string',minLength:1,maxLength:200,
    pattern:'^[^/\\x00-\\x1f]+$'},
  content:{type:['string','null'],maxLength:65536}},
  required:['name'],additionalProperties:false};
const ownerTarget=(a,c)=>({owner:ownerOf(a,c),scope:'user',kind:'user-settings'});
const repoTarget=(a,c)=>({...ownerTarget(a,c),repo:a.repo,
  scope:'repo',kind:'repo-settings'});
const request=(gh,r,p={})=>gh.request(r,p).then(x=>x.data);
const auth=async(c,t,cred)=>{
  try{
    const gh=await githubFor(c,{owner:t.owner,cred});
    const principal=await request(gh,'GET /user');
    if(!principal?.id||!principal?.login)
      throw refusal('The authenticated user is not readable.');
    return {gh,principal:{id:principal.id,login:principal.login}};
  }catch(e){
    if(cred==='K'&&e?.code==='no_credentials'){
      if(typeof c.credentials?.authorizeOptionalRequest==='function')
        throw refusal('This private member needs a verified notifications token. Ask github_check_permissions for GET /notifications and use that client-specific protected setup link. Never paste a token in chat.');
      throw refusal('Notifications require the optional classic GitHub token (notifications scope); connect it on the Owner Setup page. No token was created.');
    }
    throw e;
  }
};
const collection=async(gh,route,args={},max=500)=>{
  const d=await listAll(gh,route,{...args,per_page:100},{max});
  return {items:d.items,complete:d.capped!==true};
};
const bound=(d,name)=>{
  if(!d.complete)throw refusal(name+' inventory is truncated; change refused.');
  return d.items;
};
const nrow=x=>({id:Number(x.id)||null,unread:x.unread===true,
  reason:x.reason??null,subject_type:x.subject?.type??null,
  subject_title:x.subject?.title??null,subject_url:x.subject?.url??null,
  repository:x.repository?.full_name??null,
  repository_id:x.repository?.id??null,updated_at:x.updated_at??null,
  last_read_at:x.last_read_at??null});
const inbox=(gh,scope,repo,all=false,max=500)=>
  collection(gh,scope==='repository'?
    'GET /repos/{owner}/{repo}/notifications':'GET /notifications',
    {...(scope==='repository'?repo:{}),all},max);
const thread=async(gh,id)=>{
  try{return await request(gh,'GET /notifications/threads/{thread_id}',
    {thread_id:id});}
  catch(e){if(e?.status===404)return null;throw e;}
};
const subEndpoint=(scope)=>scope==='thread'?
  '/notifications/threads/{thread_id}/subscription':
  '/repos/{owner}/{repo}/subscription';
const subParams=a=>a.scope==='thread'?{thread_id:a.threadId}:
  {owner:a.owner,repo:a.repo};
const sub=async(gh,a)=>{
  try{return await request(gh,'GET '+subEndpoint(a.scope),subParams(a))}
  catch(e){if(e?.status===404)return null;throw e;}
};
const gid=(x)=>({id:x.id,public:x.public===true,
  description:x.description??null,owner:x.owner?.login??null,
  created_at:x.created_at??null,updated_at:x.updated_at??null,
  html_url:x.html_url??null,file_count:Object.keys(x.files??{}).length,
  filenames:Object.keys(x.files??{}).slice(0,100)});
const gist=async(gh,id)=>{
  try{return await request(gh,'GET /gists/{gist_id}',{gist_id:id})}
  catch(e){if(e?.status===404)return null;throw e;}
};
const fileList=x=>{
  const entries=Object.entries(x.files??{}).slice(0,50);
  let remaining=65536;
  return entries.map(([name,f])=>{
    const original=typeof f.content==='string'?f.content:'';
    const included=remaining>0?original.slice(0,Math.min(remaining,16384)):'';
    remaining-=included.length;
    return {name,size:f.size??null,type:f.type??null,
      language:f.language??null,truncated:f.truncated===true||
        included.length<original.length,content:included,
      available:f.truncated!==true&&included.length===original.length};
  });
};
const normalizeFiles=rows=>{
  if(!Array.isArray(rows)||rows.length>20)throw refusal('At most 20 gist file changes are permitted.');
  const names=new Set(),out={};let bytes=0;
  for(const r of rows){
    if(!r?.name||names.has(r.name)||r.name==='gistfile1.txt')
      throw refusal('Gist file names must be distinct and explicitly named.');
    names.add(r.name);
    if(r.content!==null&&typeof r.content!=='string')
      throw refusal('Each gist file needs content or an explicit null removal.');
    if(typeof r.content==='string'){
      bytes+=r.content.length;
      if(r.content.length>65536||bytes>262144)
        throw refusal('Total gist content exceeds the 256 KiB operation limit.');
    }
    out[r.name]=r.content===null?null:{content:r.content};
  }
  return out;
};
const readSpecs=[
  defineRead({name:'github_notify_list',area:'notify',audience:['Op'],
    description:'List bounded classic-token GitHub notifications by unread state and optional repository or participation.',
    properties:{owner:OWNER,repo:REPO,all:{type:'boolean'},participating:{type:'boolean'},
      since:DATE,before:DATE,max:MAX},
    handler:(a,c)=>plain(async()=>{
      const t=ownerTarget(a,c),{gh,principal}=await auth(c,t,'K');
      const args={all:a.all??false,participating:a.participating??false,
        ...(a.since?{since:a.since}:{}),...(a.before?{before:a.before}:{})};
      const scope=a.repo?'repository':'all';
      const path=scope==='repository'?'GET /repos/{owner}/{repo}/notifications':'GET /notifications';
      const rows=await collection(gh,path,scope==='repository'?
        {owner:t.owner,repo:a.repo,...args}:args,a.max??100);
      return {principal,scope,repository:a.repo??null,
        notifications:rows.items.map(nrow),complete:rows.complete};
    })}),
  defineRead({name:'github_gist_list',area:'gist',audience:['B'],
    description:'List a bounded set of the authorized user’s gists without downloading contents or claiming truncated lists complete.',
    properties:{owner:OWNER,max:MAX},
    handler:(a,c)=>plain(async()=>{
      const t=ownerTarget(a,c),{gh,principal}=await auth(c,t,await personalCred(c,'gist'));
      const d=await collection(gh,'GET /gists',{},a.max??100);
      return {principal,gists:d.items.map(gid),complete:d.complete};
    })}),
  defineRead({name:'github_gist_get',area:'gist',audience:['B'],
    description:'Read exact gist metadata and safely size-capped file contents, including per-file truncation and owner details.',
    properties:{owner:OWNER,gistId:ID},required:['gistId'],
    handler:(a,c)=>plain(async()=>{
      const t=ownerTarget(a,c),{gh}=await auth(c,t,await personalCred(c,'gist'));
      const x=await gist(gh,a.gistId);
      if(!x)throw refusal('Gist not found or not readable by authorized user.');
      return {gist:gid(x),files:fileList(x),
        complete:Object.keys(x.files??{}).length<=50&&
          fileList(x).every(y=>y.available)};
    })})
];
const notifyMark=defineGithubWrite({
  name:'github_notify_mark',area:'notify',audience:['Op'],
  description:'Mark an exact notification thread done/read or a bounded inbox/repository read; verify subsequent unread state.',
  properties:{owner:OWNER,repo:REPO,threadId:THREAD,
    scope:{type:'string',enum:['all','repository','thread']},
    action:{type:'string',enum:['read','done']}},
  required:['scope','action'],
  declarations:{production:'always',confirm:'always',cred:'K',
    profiles:['everyday','full']},
  target:(a,c)=>a.scope==='repository'?repoTarget(a,c):ownerTarget(a,c),
  read:async(a,c,t)=>{
    if(a.scope==='all'&&(a.repo||a.threadId)||a.scope==='repository'&&(!a.repo||a.threadId)||
      a.scope==='thread'&&(a.repo||!a.threadId)||a.action==='done'&&a.scope!=='thread')
      throw refusal('Choose exactly one scope; marking done requires one thread.');
    const {gh,principal}=await auth(c,t,'K');
    if(a.scope==='thread'){
      const current=await thread(gh,a.threadId);
      return {principal,item:current?nrow(current):null};
    }
    const data=await inbox(gh,a.scope,{owner:t.owner,repo:a.repo},false,500);
    return {principal,items:bound(data,'Notification').map(nrow)};
  },
  classify:()=>({production:'changes personal GitHub notification inbox state'}),
  summarize:({args:a,before:b})=>'MARK '+a.action.toUpperCase()+' for '+b.principal.login+
    ' / '+a.scope+(a.threadId?' #'+a.threadId:'')+
    (a.repo?' / '+a.repo:'')+
    (b.items?' ('+b.items.length+' unread)':''),
  apply:async({args:a,ctx:c,target:t,before:b})=>{
    const {gh,principal}=await auth(c,t,'K');
    if(principal.id!==b.principal.id)throw refusal('Authenticated notification principal changed.');
    if(a.scope==='thread'){
      if(!b.item||b.item.id!==a.threadId)
        throw refusal('Cannot mark an unverified or missing notification.');
      if(a.action==='read'&&!b.item.unread)
        throw refusal('The exact notification is already read.');
      return gh.request((a.action==='done'?'DELETE ':'PATCH ')+
        '/notifications/threads/{thread_id}',{thread_id:a.threadId});
    }
    if(!b.items?.length)throw refusal('No unread notifications were found for this scope.');
    return gh.request(a.scope==='all'?'PUT /notifications':
      'PUT /repos/{owner}/{repo}/notifications',
      a.scope==='all'?{}:{owner:t.owner,repo:a.repo});
  },
  readAfter:async({args:a,ctx:c,target:t})=>{
    const {gh,principal}=await auth(c,t,'K');
    if(a.scope==='thread')return {principal,item:await thread(gh,a.threadId)};
    return {principal,...await inbox(gh,a.scope,{owner:t.owner,repo:a.repo},false,500)};
  },
  verify:({args:a,before:b,after:x})=>x.principal.id===b.principal.id&&
    (a.scope==='thread'?
      a.action==='done'?x.item===null:x.item?.unread===false:
      x.complete===true&&x.items.length===0),
  inverse:()=>null,
  present:({args:a,before:b})=>({scope:a.scope,action:a.action,
    principal:b.principal,verified_unread_cleared:true})
});
const subscription=defineGithubWrite({
  name:'github_notify_set_subscription',area:'notify',audience:['Op'],
  description:'Watch, ignore or unsubscribe from an exact thread or enrolled repository with independent subscription readback.',
  properties:{owner:OWNER,repo:REPO,threadId:THREAD,
    scope:{type:'string',enum:['thread','repository']},
    action:{type:'string',enum:['watch','ignore','unsubscribe']}},
  required:['scope','action'],
  declarations:{production:'always',confirm:'always',cred:'K',
    profiles:['everyday','full']},
  target:(a,c)=>a.scope==='repository'?repoTarget(a,c):ownerTarget(a,c),
  read:async(a,c,t)=>{
    if(a.scope==='repository'&&(!a.repo||a.threadId)||a.scope==='thread'&&(!a.threadId||a.repo))
      throw refusal('Choose exactly one known repository or notification thread.');
    const {gh,principal}=await auth(c,t,'K');
    const prior=await sub(gh,{...a,owner:t.owner});
    return {principal,prior:prior?{subscribed:prior.subscribed===true,
      ignored:prior.ignored===true}:null};
  },
  classify:()=>({production:'changes user notification subscription state'}),
  summarize:({args:a,before:b})=>'SET '+a.action+' subscription for '+
    b.principal.login+' / '+a.scope+(a.repo?' / '+a.repo:'')+
    (a.threadId?' #'+a.threadId:''),
  apply:async({args:a,ctx:c,target:t,before:b})=>{
    const {gh,principal}=await auth(c,t,'K');
    if(principal.id!==b.principal.id)throw refusal('Notification principal changed.');
    const endpoint=subEndpoint(a.scope),p=subParams({...a,owner:t.owner});
    if(a.action==='unsubscribe'){
      if(!b.prior)throw refusal('No subscription exists to remove.');
      return gh.request('DELETE '+endpoint,p);
    }
    const desired={subscribed:a.action==='watch',ignored:a.action==='ignore'};
    if(b.prior?.subscribed===desired.subscribed&&b.prior?.ignored===desired.ignored)
      throw refusal('Subscription already equals desired state.');
    // The thread endpoint accepts "ignored" only; the repository endpoint
    // additionally accepts "subscribed". Do not send an unsupported body field.
    return gh.request('PUT '+endpoint,a.scope==='thread'?
      {...p,ignored:desired.ignored}:{...p,...desired});
  },
  readAfter:async({args:a,ctx:c,target:t})=>{
    const {gh,principal}=await auth(c,t,'K');
    return {principal,state:await sub(gh,{...a,owner:t.owner})};
  },
  verify:({args:a,before:b,after:x})=>x.principal.id===b.principal.id&&
    (a.action==='unsubscribe'?x.state===null:x.state?.subscribed===(a.action==='watch')&&
      x.state?.ignored===(a.action==='ignore')),
  inverse:()=>null,present:({args:a})=>({scope:a.scope,
    action:a.action,verified:true})
});
const save=defineGithubWrite({
  name:'github_gist_save',area:'gist',audience:['B'],
  description:'Create or update a verified user-owned gist with exact file additions/removals, public visibility and byte-capped readback.',
  properties:{owner:OWNER,gistId:ID,description:{type:'string',maxLength:1000},
    public:{type:'boolean'},files:{type:'array',items:FILE,maxItems:20}},
  declarations:{production:'always',confirm:'always',accessWidening:true,
    cred:'U',profiles:['everyday','full']},
  target:ownerTarget,
  read:async(a,c,t)=>{
    if(a.gistId&&a.public!==undefined)throw refusal('Gist visibility cannot be changed by PATCH.');
    if(!a.files?.length&&a.description===undefined)
      throw refusal('A gist needs at least one file change or description update.');
    const files=normalizeFiles(a.files??[]);
    if(!a.gistId&&(a.public===undefined||!Object.keys(files).length||
       Object.values(files).some(x=>x===null)))
      throw refusal('New gists require explicit public/private choice and non-null files.');
    const {gh,principal}=await auth(c,t,await personalCred(c,'gist'));
    const before=a.gistId?await gist(gh,a.gistId):null;
    if(a.gistId&&(!before||before.owner?.id!==principal.id))
      throw refusal('Only a verified user-owned gist may be updated.');
    return {principal,prior:before?gid(before):null,files,
      original:before?Object.keys(before.files??{}):[]};
  },
  classify:({args:a,before:b})=>({
    production:'creates or edits potentially published gist contents',
    ...(!a.gistId&&a.public?accessChange({who:'everyone',
      access:'public gist content',where:b?.principal?.login??'user account'}):{})
  }),
  summarize:({args:a,before:b})=>(a.gistId?'UPDATE':'CREATE')+
    ' gist for '+b.principal.login+
    '; visibility '+(a.gistId?(b.prior?.public?'public':'secret'):(a.public?'public':'secret'))+
    '; files '+Object.keys(b.files).join(', '),
  apply:async({args:a,ctx:c,target:t,before:b})=>{
    const {gh,principal}=await auth(c,t,await personalCred(c,'gist'));
    if(principal.id!==b.principal.id)throw refusal('Authenticated gist owner changed.');
    if(a.gistId&&!b.prior||a.gistId&&b.prior.id!==a.gistId)
      throw refusal('Gist ownership or ID not verified.');
    return gh.request(a.gistId?'PATCH /gists/{gist_id}':'POST /gists',
      {...(a.gistId?{gist_id:a.gistId,files:b.files}:{
        files:b.files,public:a.public}),
        ...(a.description!==undefined?{description:a.description}:{})});
  },
  readAfter:async({args:a,ctx:c,target:t,response:r})=>{
    const {gh,principal}=await auth(c,t,await personalCred(c,'gist'));
    const id=a.gistId??r?.data?.id;
    return {principal,current:id?await gist(gh,id):null};
  },
  verify:({args:a,before:b,after:x})=>{
    const g=x.current;
    if(x.principal.id!==b.principal.id||!g?.id||g.owner?.id!==b.principal.id||
       (a.gistId&&g.id!==a.gistId)||(!a.gistId&&g.public!==a.public)||
       (a.description!==undefined&&g.description!==a.description))return false;
    for(const [name,change] of Object.entries(b.files)){
      if(change===null){if(g.files?.[name]!==undefined)return false;continue;}
      const file=g.files?.[name];
      if(!file||file.truncated===true||file.content!==change.content)return false;
    }
    return true;
  },
  inverse:()=>null,present:({after:x})=>({gist:gid(x.current),verified:true})
});
const del=defineGithubWrite({
  name:'github_gist_delete',area:'gist',audience:['B'],
  description:'Delete one exact authenticated user-owned gist with full confirmation and independent not-found readback.',
  properties:{owner:OWNER,gistId:ID},required:['gistId'],
  declarations:{production:'always',confirm:'always',cred:'U',profiles:['full']},
  target:ownerTarget,
  read:async(a,c,t)=>{
    const {gh,principal}=await auth(c,t,await personalCred(c,'gist'));
    const g=await gist(gh,a.gistId);
    return {principal,prior:g&&g.owner?.id===principal.id?gid(g):null};
  },
  classify:()=>({production:'permanently deletes a user-owned gist'}),
  summarize:({args:a,before:b})=>'DELETE gist '+a.gistId+
    ' owned by '+b.principal.login+
    (b.prior?' / '+b.prior.file_count+' files':' (already missing)'),
  apply:async({args:a,ctx:c,target:t,before:b})=>{
    if(!b.prior||b.prior.id!==a.gistId)
      throw refusal('Exact owned gist no longer exists; no deletion sent.');
    const {gh,principal}=await auth(c,t,await personalCred(c,'gist'));
    if(principal.id!==b.principal.id)throw refusal('Authenticated gist owner changed.');
    return gh.request('DELETE /gists/{gist_id}',{gist_id:a.gistId});
  },
  readAfter:async({args:a,ctx:c,target:t})=>{
    const {gh,principal}=await auth(c,t,await personalCred(c,'gist'));
    return {principal,current:await gist(gh,a.gistId)};
  },
  verify:({before:b,after:x})=>x.principal.id===b.principal.id&&
    !!b.prior&&x.current===null,
  inverse:()=>null,present:({args:a})=>({gist_id:a.gistId,deleted:true})
});
const all=[...readSpecs,notifyMark,subscription,save,del];
export const tools=all.map(x=>x.tool);
export const handlers=Object.fromEntries(all.map(x=>[x.tool.name,x.handler]));
