// Y-9d Sponsors: the price is the actual published tier amount returned by GitHub, never an AI-supplied quote.
import { defineGithubWrite } from './define-github-write.js';
import { defineRead } from './define-read.js';
import { plain } from './github-read.js';
import { ownerOf, refusal } from './github-write.js';
import { githubFor, graphql } from '../github/client.js';

const LOGIN={type:'string',minLength:1,maxLength:39,pattern:'^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'};
const OWNER={...LOGIN,description:'Connected paying account (personal account or organization)'};
const target=(a,c)=>({owner:ownerOf(a,c),scope:'org',kind:'sponsorship'});
const TIERS_QUERY='query Y9Tiers($recipient:String!){ user(login:$recipient){ login sponsorsListing { tiers(first:100) { nodes { id isOneTime monthlyPriceInCents } pageInfo { hasNextPage } } } } organization(login:$recipient){ login sponsorsListing { tiers(first:100) { nodes { id isOneTime monthlyPriceInCents } pageInfo { hasNextPage } } } } }';
const SPONSOR_QUERY='query Y9Sponsor($sponsor:String!,$recipient:[String!]) { user(login:$sponsor){ login sponsorshipsAsSponsor(first:20,activeOnly:true,maintainerLogins:$recipient){ totalCount pageInfo{hasNextPage} nodes{id isActive isOneTimePayment privacyLevel isSponsorOptedIntoEmail sponsorable{... on User{login} ... on Organization{login}} tier{id monthlyPriceInCents}} } } organization(login:$sponsor){ login sponsorshipsAsSponsor(first:20,activeOnly:true,maintainerLogins:$recipient){ totalCount pageInfo{hasNextPage} nodes{id isActive isOneTimePayment privacyLevel isSponsorOptedIntoEmail sponsorable{... on User{login} ... on Organization{login}} tier{id monthlyPriceInCents}} } } }';
const CREATE='mutation Y9Create($input:CreateSponsorshipInput!){createSponsorship(input:$input){sponsorship{id isActive}}}';
const CANCEL='mutation Y9Cancel($input:CancelSponsorshipInput!){cancelSponsorship(input:$input){clientMutationId}}';
const PREFS='mutation Y9Prefs($input:UpdateSponsorshipPreferencesInput!){updateSponsorshipPreferences(input:$input){clientMutationId}}';
async function identity(c,t){
  const gh=await githubFor(c,{owner:t.owner,cred:'U'});
  const me=(await gh.request('GET /user')).data;
  if(!me?.login)throw refusal('Sponsor needs a real owner-approved GitHub user sign-in.');
  const row=await c.db.getAccount(t.owner);
  if(row?.account_type==='Organization'){
    const membership=(await gh.request('GET /user/memberships/orgs/{org}',{org:t.owner})).data;
    if(membership?.state!=='active'||membership?.role!=='admin')throw refusal('Only a verified organization owner can sponsor from organization funds.');
  }else if(me.login.toLowerCase()!==t.owner.toLowerCase()){
    throw refusal('Authenticated payer is not the selected personal GitHub account.');
  }
  return gh;
}
async function sponsorState(c,t,recipient){
  const gh=await identity(c,t);
  const d=await graphql(gh,SPONSOR_QUERY,{sponsor:t.owner,recipient:[recipient]});
  const row=d?.user?.login?.toLowerCase()===t.owner.toLowerCase()?d.user:d?.organization;
  const list=row?.sponsorshipsAsSponsor;
  if(!list||list.pageInfo?.hasNextPage||!Array.isArray(list.nodes)||list.totalCount!==list.nodes.length)
    throw refusal('Sponsorship list is incomplete; no money action may use it.');
  const active=list.nodes.filter(x=>x?.isActive&&x.sponsorable?.login?.toLowerCase()===recipient.toLowerCase());
  if(active.length>1)throw refusal('Multiple active sponsorship records; resolve directly on GitHub.');
  return {active:active[0]??null};
}
async function tierState(c,t,recipient){
  const d=await graphql(await identity(c,t),TIERS_QUERY,{recipient});
  const row=d?.user?.login?.toLowerCase()===recipient.toLowerCase()?d.user:d?.organization;
  const tiers=row?.sponsorsListing?.tiers;
  if(!tiers||tiers.pageInfo?.hasNextPage||!Array.isArray(tiers.nodes))
    throw refusal('Published GitHub Sponsors tier inventory is incomplete or missing.');
  return tiers.nodes;
}
const sponsorGet=defineRead({
  name:'github_sponsor_get',area:'billing',audience:['O'],
  description:'Read the existing verified sponsor relationship and published GitHub tier prices without buying anything.',
  properties:{owner:OWNER,recipient:LOGIN},required:['recipient'],
  handler:(a,c)=>plain(async()=>{
    const t=target(a,c),[state,tiers]=await Promise.all([sponsorState(c,t,a.recipient),tierState(c,t,a.recipient)]);
    return {payer:t.owner,recipient:a.recipient,active:state.active,
      tiers:tiers.map(x=>({id:x.id,one_time:x.isOneTime,price_cents:x.monthlyPriceInCents})),
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
  declarations:{production:'always',confirm:'always',spend:paid,notifies:paid,cred:'U',profiles:['full']},
  target,
  read:async(a,c,t)=>{
    if(a.recipient.toLowerCase()===t.owner.toLowerCase())throw refusal('Cannot sponsor the same paying account.');
    if(a.action==='start'&&!a.tierId)throw refusal('Select an actual published GitHub tier ID.');
    if(a.action==='preferences'&&a.privacyLevel===undefined&&a.receiveEmails===undefined)
      throw refusal('Choose a privacy or email preference.');
    const existing=await sponsorState(c,t,a.recipient);
    const tiers=a.action==='start'?await tierState(c,t,a.recipient):[];
    const tier=tiers.find(x=>x.id===a.tierId);
    if(a.action==='start'&&(!tier||!Number.isSafeInteger(tier.monthlyPriceInCents)||tier.monthlyPriceInCents<100))
      throw refusal('The selected published tier and its provider price cannot be independently verified.');
    if(a.action==='start'&&existing.active)throw refusal('A sponsorship is already active; do not create a duplicate paid subscription.');
    if(a.action!=='start'&&!existing.active)throw refusal('No active sponsorship exists for that recipient.');
    return {...existing,tier:tier??null};
  },
  ...(paid?{price:({before:b})=>b?.tier?.monthlyPriceInCents??NaN}:{}),
  classify:({args:a})=>({production:'starts, cancels or changes a GitHub sponsorship payment',
    ...(a.action==='start'?{notifies:[a.recipient]}:{})}),
  summarize:({args:a,target:t,before:b})=>{
    const d=a.action==='start'?('START '+(b.tier.isOneTime?'one-time':'monthly')+
      ' sponsorship of $'+(b.tier.monthlyPriceInCents/100).toFixed(2)):
      a.action==='cancel'?'CANCEL active sponsorship (future charges stop)':'CHANGE sponsorship preferences';
    return d+' from '+t.owner+' to '+a.recipient+
      '; payer authorization and GitHub price/readback required';
  },
  apply:async({args:a,ctx,target:t,before:b})=>{
    const gh=await identity(ctx,t);
    // One provider-side mutation only. Ambiguous errors are never replayed.
    if(a.action==='start'){
      const check=await tierState(ctx,t,a.recipient);
      if(!check.some(x=>x.id===b.tier.id&&x.monthlyPriceInCents===b.tier.monthlyPriceInCents))
        throw refusal('GitHub changed the tier price since the approved preview.');
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
      x.active.tier?.id===b.tier.id:
    a.action==='cancel'?!x?.active:
      !!x?.active&&(a.privacyLevel===undefined||x.active.privacyLevel===a.privacyLevel)
      &&(a.receiveEmails===undefined||x.active.isSponsorOptedIntoEmail===a.receiveEmails),
  inverse:()=>null,
  present:({args:a,after:x})=>({action:a.action,recipient:a.recipient,
    active:!!x?.active,verified_from:'independent GitHub sponsor query'})
});
const sponsorSet=sponsorshipChange(true);
const sponsorChange=sponsorshipChange(false);
export const sponsorDocuments={tiers:TIERS_QUERY,state:SPONSOR_QUERY,start:CREATE,cancel:CANCEL,preferences:PREFS};
export const tools=[sponsorGet.tool,sponsorSet.tool,sponsorChange.tool];
export const handlers={
  [sponsorGet.tool.name]:sponsorGet.handler,
  [sponsorSet.tool.name]:sponsorSet.handler,
  [sponsorChange.tool.name]:sponsorChange.handler
};