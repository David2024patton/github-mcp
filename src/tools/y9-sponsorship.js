// Y-9d Sponsors: the price is the actual published tier amount returned by GitHub, never an AI-supplied quote.
import { defineGithubWrite } from './define-github-write.js';
import { defineRead } from './define-read.js';
import { plain } from './github-read.js';
import { ownerOf, refusal } from './github-write.js';
import { githubFor, graphql } from '../github/client.js';

const LOGIN={type:'string',minLength:1,maxLength:39,pattern:'^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'};
const OWNER={...LOGIN,description:'Connected paying account (personal account or organization)'};
const target=(a,c)=>({owner:ownerOf(a,c),scope:'org',kind:'sponsorship'});
// The wrong entity root raises NOT_FOUND even when the other root has valid data.
const tierQuery=root=>'query Y9Tiers($recipient:String!){ '+root+'(login:$recipient){ login hasSponsorsListing sponsorsListing { tiers(first:100) { nodes { id isOneTime monthlyPriceInCents } pageInfo { hasNextPage } } } } }';
const sponsorQuery=root=>'query Y9Sponsor($sponsor:String!,$recipient:[String!]) { '+root+'(login:$sponsor){ login sponsorshipsAsSponsor(first:20,activeOnly:true,maintainerLogins:$recipient){ totalCount pageInfo{hasNextPage} nodes{id isActive isOneTimePayment privacyLevel isSponsorOptedIntoEmail sponsorable{... on User{login} ... on Organization{login}} tier{id monthlyPriceInCents}} } } }';
const TIERS_QUERY=tierQuery('user');
const SPONSOR_QUERY=sponsorQuery('organization');
const sameLogin=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const accountRoot=type=>type==='User'?'user':type==='Organization'?'organization':null;
const CREATE='mutation Y9Create($input:CreateSponsorshipInput!){createSponsorship(input:$input){sponsorship{id isActive}}}';
const CANCEL='mutation Y9Cancel($input:CancelSponsorshipInput!){cancelSponsorship(input:$input){clientMutationId}}';
const PREFS='mutation Y9Prefs($input:UpdateSponsorshipPreferencesInput!){updateSponsorshipPreferences(input:$input){clientMutationId}}';
async function identity(c,t){
  const gh=await githubFor(c,{owner:t.owner,cred:'U'});
  const me=(await gh.request('GET /user')).data;
  const row=await c.db.getAccount(t.owner);
  const root=accountRoot(row?.account_type);
  const expected=row?.account_type==='User'?row.login:row?.user_login;
  if(!root||me?.type!=='User'||!Number.isSafeInteger(me.id)||me.id<=0||
    !sameLogin(me.login,expected)||!sameLogin(row?.login,t.owner)||
    (root==='user'&&me.id!==row.account_id))
    throw refusal('Sponsor needs the verified enrolled GitHub user identity for this paying account.');
  if(root==='organization'){
    const membership=(await gh.request('GET /user/memberships/orgs/{org}',{org:t.owner})).data;
    if(membership?.state!=='active'||membership?.role!=='admin')throw refusal('Only a verified organization owner can sponsor from organization funds.');
  }
  return {gh,root};
}
async function sponsorState(c,t,recipient){
  const {gh,root}=await identity(c,t);
  const d=await graphql(gh,sponsorQuery(root),{sponsor:t.owner,recipient:[recipient]});
  const row=d?.[root],list=row?.sponsorshipsAsSponsor;
  if(!sameLogin(row?.login,t.owner)||!list||list.pageInfo?.hasNextPage!==false||
    !Array.isArray(list.nodes)||!Number.isSafeInteger(list.totalCount)||list.totalCount!==list.nodes.length||
    list.nodes.some(x=>typeof x?.id!=='string'||!x.id||x.isActive!==true||
      !sameLogin(x.sponsorable?.login,recipient)))
    throw refusal('Sponsorship list is incomplete or mismatched; no money action may use it.');
  if(list.nodes.length>1)throw refusal('Multiple active sponsorship records; resolve directly on GitHub.');
  return {active:list.nodes[0]??null};
}
async function tierState(c,t,recipient){
  const {gh}=await identity(c,t);
  const actor=(await gh.request('GET /users/{username}',{username:recipient})).data;
  const root=accountRoot(actor?.type);
  if(!root||!Number.isSafeInteger(actor.id)||actor.id<=0||!sameLogin(actor.login,recipient))
    throw refusal('The Sponsors recipient identity could not be verified.');
  const d=await graphql(gh,tierQuery(root),{recipient});
  const row=d?.[root];
  if(!sameLogin(row?.login,recipient))throw refusal('Sponsors listing identity does not match the recipient.');
  if(row.hasSponsorsListing===false&&row.sponsorsListing===null)return {available:false,tiers:[]};
  const tiers=row.sponsorsListing?.tiers;
  if(row.hasSponsorsListing!==true||!tiers||tiers.pageInfo?.hasNextPage!==false||!Array.isArray(tiers.nodes)||
    tiers.nodes.some(x=>typeof x?.id!=='string'||!x.id||typeof x.isOneTime!=='boolean'||
      !Number.isSafeInteger(x.monthlyPriceInCents)||x.monthlyPriceInCents<0))
    throw refusal('Published GitHub Sponsors tier inventory is incomplete or missing.');
  return {available:true,tiers:tiers.nodes};
}
const sponsorGet=defineRead({
  name:'github_sponsor_get',area:'billing',audience:['O'],
  description:'Read the existing verified sponsor relationship and published GitHub tier prices without buying anything.',
  properties:{owner:OWNER,recipient:LOGIN},required:['recipient'],
  handler:(a,c)=>plain(async()=>{
    const t=target(a,c),[state,listing]=await Promise.all([sponsorState(c,t,a.recipient),tierState(c,t,a.recipient)]);
    return {payer:t.owner,recipient:a.recipient,active:state.active,
      sponsors_listing_available:listing.available,tiers:listing.tiers.map(x=>({id:x.id,one_time:x.isOneTime,price_cents:x.monthlyPriceInCents})),
      source:'GitHub GraphQL sponsor listing and relationship'};
  })
});
const sponsorshipChange = (paid) => defineGithubWrite({
  name:paid?'github_sponsor_set':'github_sponsor_change',area:'billing',audience:['O'],
  description:'Start, cancel or change a verified GitHub Sponsorship with published tier pricing, spend limit and independent confirmation.',
  properties:{owner:OWNER,recipient:LOGIN,action:{type:'string',enum:paid?['start']:['cancel','preferences']},
    tierId:{type:'string',minLength:2,maxLength:150},
    privacyLevel:{type:'string',enum:['PUBLIC','PRIVATE']},
    receiveEmails:{type:'boolean'}},
  required:['recipient','action'],
  declarations:{production:'always',confirm:'always',spend:paid,notifies:paid,accessWidening:true,cred:'U',profiles:['full']},
  target,
  read:async(a,c,t)=>{
    if(a.recipient.toLowerCase()===t.owner.toLowerCase())throw refusal('Cannot sponsor the same paying account.');
    if(a.action==='start'&&!a.tierId)throw refusal('Select an actual published GitHub tier ID.');
    if(a.action==='preferences'&&a.privacyLevel===undefined&&a.receiveEmails===undefined)
      throw refusal('Choose a privacy or email preference.');
    const existing=await sponsorState(c,t,a.recipient);
    const tiers=a.action==='start'?(await tierState(c,t,a.recipient)).tiers:[];
    const tier=tiers.find(x=>x.id===a.tierId);
    if(a.action==='start'&&(!tier||!Number.isSafeInteger(tier.monthlyPriceInCents)||tier.monthlyPriceInCents<100))
      throw refusal('The selected published tier and its provider price cannot be independently verified.');
    // Preserve a valid preflight snapshot even if the provider is already at the
    // requested state. The write layer must check its durable request key FIRST so
    // an identical financial call replays instead of being refused early.
    // New requests with different keys are rejected below, before any mutation.
    return {...existing,tier:tier??null};
  },
  ...(paid?{price:({before:b})=>b?.tier?.monthlyPriceInCents??NaN}:{}),
  classify:({args:a,before:b})=>({
    ...((a.action==='start'||a.action==='preferences')&&
      (a.privacyLevel==='PUBLIC'&&b?.active?.privacyLevel!=='PUBLIC'||
       a.receiveEmails===true&&b?.active?.isSponsorOptedIntoEmail!==true)
      ?{accessWidening:'exposes sponsorship visibility or email preference to '+a.recipient}:{}),
    production:'starts, cancels or changes a GitHub sponsorship payment',
    ...(a.action==='start'?{notifies:[a.recipient]}:{})}),
  summarize:({args:a,target:t,before:b})=>{
    const d=a.action==='start'?('START '+(b.tier.isOneTime?'one-time':'monthly')+
      ' sponsorship of $'+(b.tier.monthlyPriceInCents/100).toFixed(2)):
      a.action==='cancel'?'CANCEL active sponsorship (future charges stop)':'CHANGE sponsorship preferences';
    return d+' from '+t.owner+' to '+a.recipient+
      '; privacy '+(a.privacyLevel??b?.active?.privacyLevel??'PRIVATE')+
      ', maintainer emails '+(a.receiveEmails??b?.active?.isSponsorOptedIntoEmail??false)+
      '; payer authorization and GitHub price/readback required';
  },
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(a.action==='start'&&b.active)
      throw refusal('A sponsorship is already active; this new intent cannot create a duplicate charge.');
    if(a.action!=='start'&&!b.active)
      throw refusal('No active sponsorship exists for that recipient.');
    if(a.action==='preferences'&&
      (a.privacyLevel===undefined||b.active.privacyLevel===a.privacyLevel)&&
      (a.receiveEmails===undefined||b.active.isSponsorOptedIntoEmail===a.receiveEmails))
      throw refusal('Sponsorship preferences already match; no change to send.');
    const {gh}=await identity(ctx,t);
    // One provider-side mutation only. Ambiguous errors are never replayed.
    if(a.action==='start'){
      const check=await tierState(ctx,t,a.recipient);
      if(!check.tiers.some(x=>x.id===b.tier.id&&x.monthlyPriceInCents===b.tier.monthlyPriceInCents&&x.isOneTime===b.tier.isOneTime))
        throw refusal('GitHub changed the tier price or cadence since the approved preview.');
      return {data:await graphql(gh,CREATE,{input:{sponsorLogin:t.owner,sponsorableLogin:a.recipient,tierId:a.tierId,
        privacyLevel:a.privacyLevel??'PRIVATE',receiveEmails:a.receiveEmails??false}})};
    }
    if(a.action==='cancel')return {data:await graphql(gh,CANCEL,{input:{sponsorLogin:t.owner,sponsorableLogin:a.recipient}})};
    return {data:await graphql(gh,PREFS,{input:{sponsorLogin:t.owner,sponsorableLogin:a.recipient,
      ...(a.privacyLevel?{privacyLevel:a.privacyLevel}:{}),
      ...(a.receiveEmails!==undefined?{receiveEmails:a.receiveEmails}:{})}})};
  },
  readAfter:({args:a,ctx,target:t})=>sponsorState(ctx,t,a.recipient),
  verify:({args:a,before:b,after:x})=>a.action==='start'?!!x?.active&&
      x.active.tier?.id===b.tier.id&&x.active.tier?.monthlyPriceInCents===b.tier.monthlyPriceInCents&&
      x.active.isOneTimePayment===b.tier.isOneTime&&x.active.privacyLevel===(a.privacyLevel??'PRIVATE')&&
      x.active.isSponsorOptedIntoEmail===(a.receiveEmails??false):
    a.action==='cancel'?!x?.active:
      !!x?.active&&(a.privacyLevel===undefined||x.active.privacyLevel===a.privacyLevel)
      &&(a.receiveEmails===undefined||x.active.isSponsorOptedIntoEmail===a.receiveEmails),
  inverse:()=>null,
  present:({args:a,after:x})=>({action:a.action,recipient:a.recipient,
    active:!!x?.active,verified_from:'independent GitHub sponsor query'})
});
const sponsorSet=sponsorshipChange(true);
const sponsorChange=sponsorshipChange(false);
export const sponsorDocuments={tiers:TIERS_QUERY,tiersOrganization:tierQuery('organization'),state:SPONSOR_QUERY,stateUser:sponsorQuery('user'),start:CREATE,cancel:CANCEL,preferences:PREFS};
export const tools=[sponsorGet.tool,sponsorSet.tool,sponsorChange.tool];
export const handlers={
  [sponsorGet.tool.name]:sponsorGet.handler,
  [sponsorSet.tool.name]:sponsorSet.handler,
  [sponsorChange.tool.name]:sponsorChange.handler
};