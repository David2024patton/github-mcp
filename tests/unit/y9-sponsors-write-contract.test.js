// GitHub Sponsors: synthetic provider schema and all write-contract doors.
// A real payment is never sent in CI; payer identity is proved by U and org admin membership.
import {runWriteContract} from '../../test/helpers/write-contract.js';
import * as sponsor from '../../src/tools/y9-sponsorship.js';

const def=name=>({tool:sponsor.tools.find(x=>x.name===name),handler:sponsor.handlers[name]});
const login='maintainer';
const before={id:'sponsor-1',isActive:true,isOneTimePayment:false,
  privacyLevel:'PRIVATE',isSponsorOptedIntoEmail:false,
  sponsorable:{login},tier:{id:'tier-5',monthlyPriceInCents:500}};
function arrange(gh,outcome,action){
  gh.when('GET /user').reply(200,{login:'example-owner',id:42,type:'User'});
  gh.when('GET /user/memberships/orgs/{org}').reply(200,{state:'active',role:'admin'});
  gh.when('GET /users/{username}').reply(200,{login,id:73,type:'User'});
  let sponsorReads=0;
  gh.when('POST /graphql').reply(200,(request)=>{
    const query=request.body?.query??'';
    if(query.includes('Y9Tiers'))return {data:{
      user:{login,hasSponsorsListing:true,sponsorsListing:{tiers:{nodes:[{
        id:'tier-5',isOneTime:false,monthlyPriceInCents:500
      }],pageInfo:{hasNextPage:false}}}},organization:null}};
    if(query.includes('Y9Sponsor')){
      sponsorReads++;
      const active=action==='start'?
        (sponsorReads>1&&outcome==='ok'?[before]:[]):
        (sponsorReads>1&&outcome==='ok'?
          (action==='cancel'?[]:[{...before,privacyLevel:'PUBLIC'}]):[before]);
      return {data:{user:null,organization:{login:'example-org',sponsorshipsAsSponsor:{
        totalCount:active.length,pageInfo:{hasNextPage:false},nodes:active}}}};
    }
    if(query.includes('Y9Create'))return {data:{createSponsorship:{sponsorship:{id:'sponsor-1',isActive:true}}}};
    if(query.includes('Y9Cancel'))return {data:{cancelSponsorship:{clientMutationId:null}}};
    if(query.includes('Y9Prefs'))return {data:{updateSponsorshipPreferences:{clientMutationId:null}}};
    return {errors:[{message:'Unexpected sponsor document'}]};
  });
}
for(const action of ['start','cancel','preferences']){
  runWriteContract({label:'Y-9d '+(action==='start'?'github_sponsor_set':'github_sponsor_change')+' '+action,
    definition:def(action==='start'?'github_sponsor_set':'github_sponsor_change'),
    args:{recipient:login,action,...(action==='start'?{tierId:'tier-5'}:{}),
      ...(action==='preferences'?{privacyLevel:'PUBLIC'}:{})},
    arrange:(gh,outcome)=>arrange(gh,outcome,action),profile:'full',production:true,
    needsConfirm:true,accessWidening:action==='preferences',expectedWrites:1,spendCents:action==='start'?500:0,
    notifies:action==='start'?[login]:[]});
}
