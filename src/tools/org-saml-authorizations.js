// CAP-4: SAML SSO credential authorizations on an enrolled GitHub organization.
// The organization-owner role and Administration read/write grant are enforced by
// GitHub. Never infer enterprise ownership or echo token suffixes/fingerprints.
import {listAll} from '../github/client.js';
import {defineRead} from './define-read.js';
import {defineGithubWrite} from './define-github-write.js';
import {orgReader} from './org-read.js';
import {octo,ownerOf,refusal} from './github-write.js';

const OWNER={type:'string',minLength:1,maxLength:39};
const LOGIN={type:'string',minLength:1,maxLength:39,
  pattern:'^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$'};
const ID={type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER};
const BOUND={type:'integer',minimum:1,maximum:100};
const PAGE={type:'integer',minimum:1,maximum:1000000};
const ROUTE='GET /orgs/{org}/credential-authorizations';
const REMOVE='DELETE /orgs/{org}/credential-authorizations/{credential_id}';
const safeText=(v,k)=>{
  if(v===null||v===undefined)return null;
  if(typeof v!=='string'||v.length>150||/[\x00-\x1F]/.test(v))
    throw refusal('GitHub returned invalid SAML authorization '+k+'.');
  return v;
};
function project(d,org){
  if(!d||typeof d!=='object'||Array.isArray(d)||
    !Number.isSafeInteger(d.credential_id)||d.credential_id<1||
    typeof d.login!=='string') {
    // The provider identity must be an exact valid credential id and user.
    throw refusal('GitHub returned an invalid SAML credential authorization.');
  }
  if(!new RegExp(LOGIN.pattern).test(d.login))
    throw refusal('GitHub returned an invalid SAML authorization login.');
  return {org,credential_id:d.credential_id,login:d.login,
    credential_type:safeText(d.credential_type,'type'),
    credential_authorized_at:safeText(d.credential_authorized_at,'time')};
}
function unique(items,org){
  if(!Array.isArray(items))throw refusal('GitHub returned a malformed SAML inventory.');
  const seen=new Set();
  return items.map(x=>{
    const item=project(x,org);
    if(seen.has(item.credential_id))throw refusal('GitHub repeated a SAML credential ID.');
    seen.add(item.credential_id);
    return item;
  });
}
export const samlList=defineRead({
  name:'github_org_saml_authorizations',area:'org',audience:['O'],
  description:'Read one bounded page of SAML SSO credential authorizations by login, without revealing token suffixes or fingerprints.',
  properties:{owner:OWNER,login:LOGIN,max:BOUND,page:PAGE},
  handler:(a,ctx)=>orgReader(a,ctx,async(gh,org)=>{
    const max=a.max??30,page=a.page??1;
    const response=await gh.request(ROUTE,{org,per_page:max,page,
      ...(a.login?{login:a.login}:{})});
    if(!Array.isArray(response.data)||response.data.length>max)
      throw refusal('GitHub returned an unbounded SAML authorization page.');
    const authorizations=unique(response.data,org);
    if(a.login&&authorizations.some(x=>x.login.toLowerCase()!==a.login.toLowerCase()))
      throw refusal('GitHub returned authorizations for another user.');
    const next=/rel="next"/.test(String(response.headers?.link??''));
    return {org,authorizations,shown:authorizations.length,page,
      complete:!next&&authorizations.length<max,
      nextPage:next?page+1:null,
      note:next||authorizations.length===max?
        'This is only a bounded page; do not assume that authorization inventory is complete.':null};
  })
});
const target=(a,c)=>({owner:ownerOf(a,c),scope:'org',kind:'org-saml-credential',
  credentialId:a.credentialId});
async function inventory(ctx,t,login){
  const account=await ctx.db.getAccount(t.owner);
  if(account?.account_type!=='Organization')
    throw refusal('SAML administration requires an enrolled organization.');
  const gh=await octo(ctx,t.owner);
  const out=await listAll(gh,ROUTE,{org:t.owner,login,per_page:100},{max:500});
  if(out.capped)throw refusal('The SAML authorization inventory was not complete; no revocation can be made.');
  const items=unique(out.items,t.owner);
  if(items.some(x=>x.login.toLowerCase()!==login.toLowerCase()))
    throw refusal('SAML authorization inventory includes a different user.');
  return items;
}
export const samlRevoke=defineGithubWrite({
  name:'github_org_saml_revoke_authorization',area:'org',audience:['O'],
  description:'PRODUCTION: Revoke one exact SAML SSO credential authorization, verify its absence, and require confirmation.',
  properties:{owner:OWNER,login:LOGIN,credentialId:ID},
  required:['login','credentialId'],
  declarations:{production:'always',confirm:'always',profiles:['full']},target,
  read:async(a,ctx,t)=>{
    const rows=await inventory(ctx,t,a.login);
    return rows.find(x=>x.credential_id===a.credentialId)??null;
  },
  classify:()=>({}),
  summarize:({args:a,before:b,target:t})=>
    'Remove SAML SSO access for credential #'+a.credentialId+
    ' ('+(b?.credential_type??'not found')+') belonging to '+a.login+
    ' in '+t.owner+'. This may invalidate an active token, SSH key, OAuth app or GitHub App grant.',
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(!b||b.credential_id!==a.credentialId||
      b.login.toLowerCase()!==a.login.toLowerCase())
      throw refusal('The exact SAML authorization was absent or had changed.');
    const gh=await octo(ctx,t.owner);
    return gh.request(REMOVE,{org:t.owner,credential_id:a.credentialId});
  },
  readAfter:async({args:a,ctx,target:t})=>{
    const rows=await inventory(ctx,t,a.login);
    return {credentialStillAuthorized:rows.some(x=>x.credential_id===a.credentialId),
      verifiedOwner:a.login,verifiedOrg:t.owner};
  },
  verify:({args:a,after:b,target:t})=>
    b?.credentialStillAuthorized===false&&b.verifiedOwner===a.login&&
    b.verifiedOrg===t.owner,
  inverse:()=>null,
  present:({args:a,target:t,after:b})=>({org:t.owner,login:a.login,
    credential_id:a.credentialId,revoked:b?.credentialStillAuthorized===false,
    note:'The user may reauthorize the credential separately. An unverified readback is not successful revocation.'})
});
export const tools=[samlList.tool,samlRevoke.tool];
export const handlers=Object.fromEntries([
  [samlList.tool,samlList.handler],[samlRevoke.tool,samlRevoke.handler]
].map(([t,h])=>[t.name,h]));
