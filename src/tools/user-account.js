// O-6: personal GitHub account, email, public key, block and invitation owner workflows.
// A user grant is always identified with GET /user before personal data is read or changed.
import {createHash} from 'node:crypto';
import {githubFor,listAll,graphql} from '../github/client.js';
import {defineRead} from './define-read.js';
import {defineGithubWrite} from './define-github-write.js';
import {plain} from './github-read.js';
import {ownerOf,refusal} from './github-write.js';
import {accessChange} from './people-guard.js';
import {personalCred} from '../github/personal-cred.js';

const OWNER={type:'string',minLength:1,maxLength:39};
const MAX={type:'integer',minimum:1,maximum:500};
const ID={type:'integer',minimum:1};
const LOGIN={type:'string',minLength:1,maxLength:39,
  pattern:'^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'};
const EMAIL={type:'string',minLength:3,maxLength:254,pattern:'^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'};
const TYPE={type:'string',enum:['ssh','signing','gpg']};
const KEY={type:'string',minLength:40,maxLength:16384};
const accountTarget=(a,c)=>({owner:ownerOf(a,c),scope:'user',kind:'user-settings'});
const api=(gh,route,params={})=>gh.request(route,params).then(x=>x.data);
// GOD-2: the master token acts on the person's own account when it is added and covers `scope`; otherwise U as before.
const keyScope=k=>k==='gpg'?'admin:gpg_key':k==='signing'?'admin:ssh_signing_key':'admin:public_key';
const self=async(c,t,scope='user')=>{
  const gh=await githubFor(c,{owner:t.owner,cred:await personalCred(c,scope)});
  const user=await api(gh,'GET /user');
  if(!user?.id||!user?.login||user.type&&user.type!=='User')
    throw refusal('User authorization identity is not verified. Authorize the GitHub App as yourself on the setup page.');
  return {gh,user:{id:user.id,login:user.login},raw:user};
};
const inventory=async(gh,route,params={},max=500)=>{
  const x=await listAll(gh,route,{...params,per_page:100},{max});
  return {items:x.items,complete:x.capped!==true};
};
const demand=(x,kind)=>{
  if(!x.complete)throw refusal(kind+' inventory is truncated, so the account cannot be changed safely.');
  return x.items;
};
const fingerprint=x=>createHash('sha256').update(String(x??'')).digest('hex').slice(0,20);
const safeProfile=u=>({id:u.id,login:u.login,name:u.name??null,
  company:u.company??null,blog:u.blog??null,location:u.location??null,
  bio:u.bio??null,hireable:u.hireable??null,twitter_username:u.twitter_username??null,
  email:u.email??null,two_factor_authentication:u.two_factor_authentication??null,
  plan:u.plan?.name??null,updated_at:u.updated_at??null});
const safeEmail=x=>({email:x.email,primary:x.primary===true,
  verified:x.verified===true,visibility:x.visibility??null});
const safeKey=(x,kind)=>({id:x.id,kind,
  title:x.title??x.name??null,created_at:x.created_at??null,
  verified:x.verified??null,expires_at:x.expires_at??null,
  fingerprint:fingerprint(x.key??x.public_key??x.key_id),
  key_id:x.key_id??null});
const safeInvite=x=>({id:x.id,repository_id:x.repository?.id??null,
  repository:x.repository?.full_name??null,private:x.repository?.private===true,
  inviter:x.inviter?.login??null,permissions:x.permissions??null,
  created_at:x.created_at??null});
const tryList=async(fn,project)=>{
  try{const d=await fn();return {status:'ok',items:d.items.map(project),
    complete:d.complete};}
  catch(e){if(e?.status===401||e?.status===403||e?.status===404)
    return {status:'not_readable',reason:'User grant lacks this endpoint permission; authorize it on the setup page.'};
    throw e;}
};
const routes={ssh:'GET /user/keys',signing:'GET /user/ssh_signing_keys',
  gpg:'GET /user/gpg_keys'};
const getKeys=(gh,kind,max=500)=>inventory(gh,routes[kind],{},max);
const keyOne=(kind,id)=>({
  ssh:['GET /user/keys/{key_id}',{key_id:id}],
  signing:['GET /user/ssh_signing_keys/{ssh_signing_key_id}',{ssh_signing_key_id:id}],
  gpg:['GET /user/gpg_keys/{gpg_key_id}',{gpg_key_id:id}]
})[kind];
const keyDelete=(kind,id)=>({
  ssh:['DELETE /user/keys/{key_id}',{key_id:id}],
  signing:['DELETE /user/ssh_signing_keys/{ssh_signing_key_id}',{ssh_signing_key_id:id}],
  gpg:['DELETE /user/gpg_keys/{gpg_key_id}',{gpg_key_id:id}]
})[kind];
const keyAdd=(kind)=>({
  ssh:'POST /user/keys',signing:'POST /user/ssh_signing_keys',
  gpg:'POST /user/gpg_keys'
})[kind];
const getExact=async(gh,kind,id)=>{
  const [route,params]=keyOne(kind,id);
  try{return await api(gh,route,params)}
  catch(e){if(e?.status===404)return null;throw e;}
};
const emails=async(gh)=>inventory(gh,'GET /user/emails',{},500);
const invites=async(gh)=>inventory(gh,'GET /user/repository_invitations',{},500);
const isBlocked=async(gh,username)=>{
  try{const res=await gh.request('GET /user/blocks/{username}',{username});
    return res.status===204;}
  catch(e){if(e?.status===404)return false;throw e;}
};
const sanitizePublic=(kind,pub)=>{
  if(typeof pub!=='string'||pub.length>16384||
     /PRIVATE KEY|BEGIN (?:RSA|OPENSSH|EC) |github_pat_|ghp_/i.test(pub))
    throw refusal('Only a public key is accepted; a private key or credential was refused without echo.');
  if(kind==='gpg'){
    if(!/^-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]{40,}-----END PGP PUBLIC KEY BLOCK-----\s*$/.test(pub))
      throw refusal('A valid ASCII-armored PGP PUBLIC key block is required.');
  }else if(!/^(ssh-(?:rsa|ed25519)|ecdsa-sha2-nistp(?:256|384|521)) [A-Za-z0-9+/=]{40,}(?: [^\r\n]{0,200})?$/.test(pub))
    throw refusal('An SSH PUBLIC key line is required.');
};
const specs=[
  defineRead({name:'github_account_get',area:'account',audience:['O'],
    description:'Read the user-authorized personal profile, plan, email verification, organizations, blocks and two-factor state.',
    properties:{owner:OWNER,max:MAX},
    handler:(a,c)=>plain(async()=>{
      const t=accountTarget(a,c),{gh,raw}=await self(c,t,'user'),max=a.max??100;
      const email=await tryList(()=>inventory(gh,'GET /user/emails',{},max),safeEmail);
      const orgs=await tryList(()=>inventory(gh,'GET /user/orgs',{},max),
        x=>({login:x.login,id:x.id}));
      const blocks=await tryList(()=>inventory(gh,'GET /user/blocks',{},max),
        x=>({login:x.login,id:x.id}));
      return {connected_account:t.owner,principal:safeProfile(raw),emails:email,
        organizations:orgs,blocked_users:blocks};
    })}),
  defineRead({name:'github_account_list_keys',area:'account',audience:['O'],
    description:'List public Git SSH, SSH signing and GPG key fingerprints and creation dates, never private or full public key material.',
    properties:{owner:OWNER,max:MAX},
    handler:(a,c)=>plain(async()=>{
      const t=accountTarget(a,c),{gh,user}=await self(c,t,'admin:public_key'),max=a.max??100;
      const keys={};
      for(const kind of Object.keys(routes))
        keys[kind]=await tryList(()=>getKeys(gh,kind,max),x=>safeKey(x,kind));
      return {principal:user,keys};
    })}),
  defineRead({name:'github_account_list_invitations',area:'account',audience:['O'],
    description:'List pending repository invitations for the authorized personal account with exact IDs and repository identities.',
    properties:{owner:OWNER,max:MAX},
    handler:(a,c)=>plain(async()=>{
      const t=accountTarget(a,c),{gh,user}=await self(c,t,'user');
      const x=await invites(gh);
      return {principal:user,invitations:x.items.slice(0,a.max??100).map(safeInvite),
        complete:x.complete&&x.items.length<=(a.max??100)};
    })})
];
const profileFields=['name','bio','company','blog','location','hireable','twitter_username'];
const profileProps={name:{type:'string',maxLength:255},bio:{type:'string',maxLength:512},
  company:{type:'string',maxLength:255},blog:{type:'string',maxLength:255},
  location:{type:'string',maxLength:255},hireable:{type:'boolean'},
  twitter_username:{type:'string',maxLength:39}};
const requestedFields=a=>Object.fromEntries(profileFields.filter(k=>Object.hasOwn(a,k)).map(k=>[k,a[k]]));
const profile=defineGithubWrite({
  name:'github_account_update_profile',area:'account',audience:['O'],
  description:'Change only explicitly named personal profile fields with owner approval and exact independent readback.',
  properties:{owner:OWNER,...profileProps},declarations:{
    production:'always',confirm:'always',cred:'U',profiles:['full']},
  target:accountTarget,
  read:async(a,c,t)=>{
    const user=await self(c,t,'user');
    if(!Object.keys(requestedFields(a)).length)
      throw refusal('Specify at least one profile field to change.');
    return {user:user.user,fields:safeProfile(user.raw)};
  },
  classify:()=>({production:'personal GitHub account profile settings change'}),
  summarize:({before:b,args:a})=>'UPDATE GitHub profile of '+b.user.login+
    '; fields '+Object.keys(requestedFields(a)).join(', ')+' (empty string clears a value)',
  apply:async({args:a,ctx:c,target:t,before:b})=>{
    const {gh,user}=await self(c,t,'user');
    if(user.id!==b.user.id)throw refusal('Authenticated user identity changed.');
    return gh.request('PATCH /user',requestedFields(a));
  },
  readAfter:async({ctx:c,target:t})=>{
    const x=await self(c,t,'user');return {user:x.user,fields:safeProfile(x.raw)};
  },
  verify:({args:a,before:b,after:x})=>x.user.id===b.user.id&&
    Object.entries(requestedFields(a)).every(([key,v])=>x.fields[key]===v),
  inverse:()=>null,present:({after:x})=>x
});
const emailChange=defineGithubWrite({
  name:'github_account_manage_email',area:'account',audience:['O'],
  description:'Add, remove or change primary email visibility using exact verified account state; adding sends a verification email.',
  properties:{owner:OWNER,action:{type:'string',enum:['add','remove','visibility']},
    email:EMAIL,visibility:{type:'string',enum:['public','private']}},
  required:['action'],declarations:{production:'always',confirm:'always',
    accessWidening:true,notifies:true,cred:'U',profiles:['full']},
  target:accountTarget,
  read:async(a,c,t)=>{
    if(a.action==='visibility'&&(a.email!==undefined||!a.visibility)||
      a.action!=='visibility'&&(!a.email||a.visibility!==undefined))
      throw refusal('Add/remove requires only email; visibility requires public/private and no email.');
    const {gh,user}=await self(c,t,'user'),x=await emails(gh);
    return {user,items:demand(x,'Email').map(safeEmail)};
  },
  classify:({args:a,before:b})=>({
    production:'changes personal account email authorization or public visibility',
    ...(a.action==='add'?{notifies:[a.email]}:{}),
    ...(a.action==='visibility'&&a.visibility==='public'?
      accessChange({who:'everyone',access:'public email visibility',
        where:b.user.login,before:'private'}):{})
  }),
  summarize:({args:a,before:b})=>a.action.toUpperCase()+
    ' account email for '+b.user.login+
    (a.action==='visibility'?' visibility '+a.visibility:' '+a.email),
  apply:async({args:a,ctx:c,target:t,before:b})=>{
    const {gh,user}=await self(c,t,'user');
    if(user.id!==b.user.id)throw refusal('Account principal changed.');
    if(a.action==='add'){
      if(b.items.some(x=>x.email.toLowerCase()===a.email.toLowerCase()))
        throw refusal('Email already exists; do not send another verification.');
      return gh.request('POST /user/emails',{emails:[a.email]});
    }
    if(a.action==='remove'){
      const existing=b.items.find(x=>x.email.toLowerCase()===a.email.toLowerCase());
      if(!existing||existing.primary||b.items.length<=1)
        throw refusal('Cannot remove missing, primary or last email address.');
      return gh.request('DELETE /user/emails',{emails:[a.email]});
    }
    const primary=b.items.find(x=>x.primary);
    if(!primary)throw refusal('Primary email is not independently readable.');
    return gh.request('PATCH /user/email/visibility',{visibility:a.visibility});
  },
  readAfter:async({ctx:c,target:t})=>{
    const {gh,user}=await self(c,t,'user'),x=await emails(gh);
    return {user,items:demand(x,'Email').map(safeEmail)};
  },
  verify:({args:a,before:b,after:x})=>{
    if(x.user.id!==b.user.id)return false;
    if(a.action==='visibility')
      return x.items.some(row=>row.primary&&row.visibility===a.visibility);
    const exists=x.items.some(row=>row.email.toLowerCase()===a.email.toLowerCase());
    return a.action==='add'?exists:!exists;
  },
  inverse:()=>null,present:({args:a,before:b,after:x})=>({
    action:a.action,principal:b.user,
    verified:a.action==='add'?null:true,
    note:a.action==='add'?'Verification email may still be pending; do not report email verified.':null,
    current:x.items})
});
const addKey=defineGithubWrite({
  name:'github_account_add_key',area:'account',audience:['O'],
  description:'Add a Git SSH, SSH signing or PGP PUBLIC key with strict private-key refusal and key-ID readback.',
  properties:{owner:OWNER,kind:TYPE,title:{type:'string',minLength:1,maxLength:255},
    publicKey:KEY},required:['kind','publicKey'],
  declarations:{production:'always',confirm:'always',accessWidening:true,
    cred:'U',profiles:['full']},
  target:accountTarget,
  read:async(a,c,t)=>{
    sanitizePublic(a.kind,a.publicKey);
    const {gh,user}=await self(c,t,keyScope(a.kind)),x=await getKeys(gh,a.kind);
    const items=demand(x,'Account public key');
    if(a.kind!=='gpg'&&items.some(k=>k.key===a.publicKey))
      throw refusal('The public key is already enrolled.');
    return {user,ids:items.map(k=>k.id)};
  },
  classify:({args:a,before:b})=>({
    production:'enrolls a public signing or authentication credential on a personal account',
    ...accessChange({who:'new '+a.kind+' public key',access:'identity/signing',
      where:b?.user.login??'personal GitHub account'})
  }),
  summarize:({args:a,before:b})=>'ADD '+a.kind+' PUBLIC KEY to '+b.user.login+
    '; fingerprint '+fingerprint(a.publicKey),
  apply:async({args:a,ctx:c,target:t,before:b})=>{
    const {gh,user}=await self(c,t,keyScope(a.kind));
    if(user.id!==b.user.id)throw refusal('Account principal changed.');
    return gh.request(keyAdd(a.kind),a.kind==='gpg'?
      {armored_public_key:a.publicKey,...(a.title?{name:a.title}:{})}:
      {key:a.publicKey,...(a.title?{title:a.title}:{})});
  },
  readAfter:async({args:a,ctx:c,target:t,response:r})=>{
    const {gh,user}=await self(c,t,keyScope(a.kind)),id=r?.data?.id;
    return {user,id,key:Number.isInteger(id)?await getExact(gh,a.kind,id):null};
  },
  verify:({args:a,before:b,after:x})=>x.user.id===b.user.id&&
    Number.isInteger(x.id)&&!b.ids.includes(x.id)&&x.key?.id===x.id&&
    (a.kind==='gpg'||x.key.key===a.publicKey),
  inverse:()=>null,present:({args:a,after:x})=>
    ({kind:a.kind,key_id:x.id,fingerprint:safeKey(x.key,a.kind).fingerprint})
});
const deleteKey=defineGithubWrite({
  name:'github_account_delete_key',area:'account',audience:['O'],
  description:'Delete one verified personal public key by exact type and ID with independent absence readback.',
  properties:{owner:OWNER,kind:TYPE,keyId:ID},required:['kind','keyId'],
  declarations:{production:'always',confirm:'always',cred:'U',profiles:['full']},
  target:accountTarget,
  read:async(a,c,t)=>{
    const {gh,user}=await self(c,t,keyScope(a.kind));
    return {user,key:await getExact(gh,a.kind,a.keyId)};
  },
  classify:()=>({production:'removes a personal account authentication or signing key'}),
  summarize:({args:a,before:b})=>'DELETE '+a.kind+' key #'+a.keyId+
    ' from '+b.user.login+'; current '+(b.key?.id??'already absent'),
  apply:async({args:a,ctx:c,target:t,before:b})=>{
    if(!b.key||b.key.id!==a.keyId)
      throw refusal('No matching public key exists; nothing to remove.');
    const {gh,user}=await self(c,t,keyScope(a.kind));
    if(user.id!==b.user.id)throw refusal('Account principal changed.');
    const [route,params]=keyDelete(a.kind,a.keyId);
    return gh.request(route,params);
  },
  readAfter:async({args:a,ctx:c,target:t})=>{
    const {gh,user}=await self(c,t,keyScope(a.kind));
    return {user,key:await getExact(gh,a.kind,a.keyId)};
  },
  verify:({before:b,after:x})=>!!b.key&&x.user.id===b.user.id&&x.key===null,
  inverse:()=>null,present:({args:a})=>({kind:a.kind,key_id:a.keyId,removed:true})
});
const setBlocked=defineGithubWrite({
  name:'github_account_set_blocked',area:'account',audience:['O'],
  description:'Block or unblock one verified user on the personal account and independently verify the state.',
  properties:{owner:OWNER,username:LOGIN,blocked:{type:'boolean'}},
  required:['username','blocked'],
  declarations:{production:'always',confirm:'always',cred:'U',profiles:['full']},
  target:accountTarget,
  read:async(a,c,t)=>{
    const {gh,user}=await self(c,t,'user');
    if(user.login.toLowerCase()===a.username.toLowerCase())
      throw refusal('Cannot block your own user account.');
    return {user,blocked:await isBlocked(gh,a.username)};
  },
  classify:()=>({production:'changes a personal GitHub block-list entry'}),
  summarize:({args:a,before:b})=>(a.blocked?'BLOCK ':'UNBLOCK ')+a.username+
    ' for '+b.user.login+'; currently '+(b.blocked?'blocked':'not blocked'),
  apply:async({args:a,ctx:c,target:t,before:b})=>{
    if(b.blocked===a.blocked)throw refusal('Block state already equals requested state.');
    const {gh,user}=await self(c,t,'user');
    if(user.id!==b.user.id)throw refusal('Account principal changed.');
    return gh.request((a.blocked?'PUT ':'DELETE ')+
      '/user/blocks/{username}',{username:a.username});
  },
  readAfter:async({args:a,ctx:c,target:t})=>{
    const {gh,user}=await self(c,t,'user');
    return {user,blocked:await isBlocked(gh,a.username)};
  },
  verify:({args:a,before:b,after:x})=>x.user.id===b.user.id&&
    x.blocked===a.blocked&&b.blocked!==a.blocked,
  inverse:()=>null,present:({args:a})=>({login:a.username,blocked:a.blocked})
});
const respondInvite=defineGithubWrite({
  name:'github_account_respond_invitation',area:'account',audience:['O'],
  description:'Accept or decline one exact pending personal repository invitation with explicit confirmation and access readback.',
  properties:{owner:OWNER,invitationId:ID,action:{type:'string',enum:['accept','decline']}},
  required:['invitationId','action'],
  declarations:{production:'always',confirm:'always',accessWidening:true,
    cred:'U',profiles:['full']},
  target:accountTarget,
  read:async(a,c,t)=>{
    const {gh,user}=await self(c,t,'user'),x=await invites(gh),items=demand(x,'Invitation');
    return {user,invitation:safeInvite(items.find(i=>i.id===a.invitationId)??{})};
  },
  classify:({args:a,before:b})=>({
    production:'accepts or declines repository access for the authenticated personal account',
    ...(a.action==='accept'?accessChange({who:b?.user?.login??'account owner',
      access:'invited repository',where:b?.invitation?.repository??'unverified repository'}):{})
  }),
  summarize:({args:a,before:b})=>a.action.toUpperCase()+
    ' invitation #'+a.invitationId+' for '+b.user.login+
    ' into '+(b.invitation?.repository??'unverified repository'),
  apply:async({args:a,ctx:c,target:t,before:b})=>{
    const invite=b.invitation;
    if(!invite?.id||!invite?.repository||!invite?.repository_id)
      throw refusal('No exact pending invitation/repository identity to '+a.action+'.');
    const {gh,user}=await self(c,t,'user');
    if(user.id!==b.user.id)throw refusal('Account principal changed.');
    return gh.request((a.action==='accept'?'PATCH ':'DELETE ')+
      '/user/repository_invitations/{invitation_id}',{invitation_id:a.invitationId});
  },
  readAfter:async({args:a,ctx:c,target:t,before:b})=>{
    const {gh,user}=await self(c,t,'user'),pending=await invites(gh);
    let joined=null;
    if(a.action==='accept'&&b.invitation?.repository){
      const [owner,repo]=b.invitation.repository.split('/');
      try{
        const x=await api(gh,'GET /repos/{owner}/{repo}',{owner,repo});
        joined={id:x.id,full_name:x.full_name};
      }catch{joined=null;}
    }
    return {user,pending,joined};
  },
  verify:({args:a,before:b,after:x})=>x.user.id===b.user.id&&
    !!b.invitation?.id&&x.pending.complete===true&&
    !x.pending.items.some(i=>i.id===a.invitationId)&&
    (a.action==='decline'||x.joined?.id===b.invitation.repository_id&&
      x.joined?.full_name===b.invitation.repository),
  inverse:()=>null,present:({args:a,before:b})=>
    ({action:a.action,invitation_id:a.invitationId,
      repository:b.invitation.repository})
});

// Y-1: personal status (the emoji and short message on the profile). GraphQL-only: REST has no status route.
const statusQuery=`query{viewer{id login status{emoji message expiresAt indicatesLimitedAvailability}}}`;
const statusMutation=`mutation($emoji:String,$message:String,$expiresAt:DateTime,$limited:Boolean,$org:ID){
  changeUserStatus(input:{emoji:$emoji,message:$message,expiresAt:$expiresAt,limitedAvailability:$limited,organizationId:$org}){
    status{emoji message expiresAt indicatesLimitedAvailability}
  }
}`;
const statusView=s=>s?{emoji:s.emoji??null,message:s.message??null,
  expiresAt:s.expiresAt??null,limitedAvailability:s.indicatesLimitedAvailability===true}:null;
const sameTime=(a,b)=>(a??null)===(b??null)||
  (a&&b&&Date.parse(a)===Date.parse(b));
const viewerStatus=async(c,t)=>{
  const gh=await githubFor(c,{owner:t.owner,cred:await personalCred(c,'user')});
  const x=(await graphql(gh,statusQuery)).viewer;
  if(!x?.id||!x?.login)
    throw refusal('User authorization identity is not verified. Authorize the GitHub App as yourself on the setup page.');
  return {gh,viewer:{id:x.id,login:x.login},status:statusView(x.status)};
};
const wantsClear=a=>!a.message&&!a.emoji;
const wantedStatus=a=>wantsClear(a)?null:{emoji:a.emoji??null,message:a.message||null,
  expiresAt:a.expiresAt??null,limitedAvailability:a.limitedAvailability===true};
const setStatus=defineGithubWrite({
  name:'github_account_set_status',area:'account',audience:['O'],
  description:'Set or clear your GitHub profile status (emoji, short message, expiry, busy flag) and read it back field by field.',
  properties:{owner:OWNER,emoji:{type:'string',maxLength:40,pattern:'^:[a-z0-9_+-]{1,38}:$',
      description:'Emoji name with colons, e.g. :palm_tree:'},
    message:{type:'string',maxLength:80,description:'Up to 80 characters; empty with no emoji clears the status'},
    expiresAt:{type:'string',maxLength:40,description:'ISO 8601 time in the future; omit for no expiry'},
    limitedAvailability:{type:'boolean',description:'Show the busy indicator'},
    organizationId:{type:'string',maxLength:100,description:'Organization node ID to limit who sees the status'}},
  declarations:{production:'never',confirm:'always',cred:'U',profiles:['full']},
  target:accountTarget,
  read:async(a,c,t)=>{
    if(a.message&&[...a.message].length>80)throw refusal('A status message is at most 80 characters.');
    if(wantsClear(a)&&(a.expiresAt||a.limitedAvailability||a.organizationId))
      throw refusal('To clear the status leave message and emoji empty and give nothing else.');
    if(a.expiresAt){
      const t0=Date.parse(a.expiresAt);
      if(!Number.isFinite(t0)||!/^\d{4}-\d\d-\d\dT/.test(a.expiresAt))throw refusal('expiresAt must be an ISO 8601 time.');
      if(t0<=(c.now?c.now():Date.now()))throw refusal('expiresAt must be in the future.');
    }
    const {viewer,status}=await viewerStatus(c,t);
    return {viewer,status};
  },
  classify:()=>({}),
  summarize:({args:a,before:b})=>wantsClear(a)?'CLEAR the status of '+b.viewer.login:
    'SET the status of '+b.viewer.login+' to '+(a.emoji??'')+' "'+(a.message??'')+'"'+
    (a.expiresAt?' until '+a.expiresAt:'')+(a.limitedAvailability?' (busy)':''),
  apply:async({args:a,ctx:c,target:t,before:b})=>{
    const {gh,viewer}=await viewerStatus(c,t);
    if(viewer.id!==b.viewer.id)throw refusal('Authenticated user identity changed.');
    const w=wantedStatus(a);
    const x=await graphql(gh,statusMutation,{emoji:w?.emoji??null,message:w?.message??null,
      expiresAt:w?.expiresAt??null,limited:w?.limitedAvailability??false,org:a.organizationId??null});
    return {data:x.changeUserStatus};
  },
  readAfter:async({ctx:c,target:t})=>{const {viewer,status}=await viewerStatus(c,t);return {viewer,status};},
  verify:({args:a,before:b,after:x})=>{
    if(x.viewer.id!==b.viewer.id)return false;
    const w=wantedStatus(a);
    if(!w)return x.status===null||!x.status.message&&!x.status.emoji;
    const s=x.status;
    return !!s&&s.emoji===w.emoji&&s.message===w.message&&
      sameTime(s.expiresAt,w.expiresAt)&&s.limitedAvailability===w.limitedAvailability;
  },
  inverse:({before:b})=>({tool:'github_account_set_status',args:b.status?
    {...(b.status.emoji?{emoji:b.status.emoji}:{}),...(b.status.message?{message:b.status.message}:{}),
     ...(b.status.expiresAt?{expiresAt:b.status.expiresAt}:{}),
     ...(b.status.limitedAvailability?{limitedAvailability:true}:{})}:{message:''}}),
  present:({after:x})=>({status:x.status})
});
const all=[...specs,profile,setStatus,emailChange,addKey,deleteKey,setBlocked,respondInvite];
export const tools=all.map(x=>x.tool);
export const handlers=Object.fromEntries(all.map(x=>[x.tool.name,x.handler]));
