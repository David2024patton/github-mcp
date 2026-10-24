// O-4: owner-visible dollar, budget, Copilot and Codespaces reads.
// No usage number is fabricated from absent provider data or a truncated list.
import {defineRead} from './define-read.js';
import {readerFor,plain} from './github-read.js';
import {githubFor} from '../github/client.js';
import {personalCred} from '../github/personal-cred.js';
import {PRICES} from '../github/prices.js';

const OWNER={type:'string',maxLength:39};
const MAX={type:'integer',minimum:1,maximum:500};
const DATE={type:'integer',minimum:1,maximum:31};
const MONTH={type:'integer',minimum:1,maximum:12};
const YEAR={type:'integer',minimum:2020,maximum:2100};
const userCred=async(a,c,scope)=>{
  const owner=a.owner??c.connection.default_account;
  const gh=await githubFor(c,{owner,cred:scope?await personalCred(c,scope):'U'});
  const user=(await gh.request('GET /user')).data;
  if(!user?.login)throw new TypeError('User credential identity could not be verified.');
  return {gh,owner,user:user.login};
};
const orgCred=async(a,c)=>{
  const {owner,octokit:gh}=await readerFor(a,c);
  const account=await c.db.getAccount(owner);
  if(account?.account_type!=='Organization')
    throw new TypeError('Organization billing requires an enrolled organization.');
  return {gh,owner};
};
const request=(gh,route,args)=>(gh.request(route,args)).then(x=>x.data);
const nonnegative=x=>Number.isFinite(x)&&x>=0?x:null;
const money=x=>nonnegative(x)===null?null:Number(x.toFixed(2));
const usageRow=x=>({product:x.product??null,sku:x.sku??null,
  date:x.date??null,quantity:nonnegative(x.quantity??x.grossQuantity),
  unit:x.unitType??null,net_dollars:money(x.netAmount),
  gross_dollars:money(x.grossAmount),discount_dollars:money(x.discountAmount)});
export const summarizeUsage=(items,max)=>{
  if(!Array.isArray(items))throw new TypeError('GitHub usage response did not include usageItems.');
  const complete=items.length<=max;
  const allReadable=items.every(x=>money(x.netAmount)!==null);
  // Only report a total for all requested items; a sample isn't the full bill.
  return {items:items.slice(0,max).map(usageRow),complete,
    total_net_dollars:complete&&allReadable?
      Number(items.reduce((v,x)=>v+x.netAmount,0).toFixed(2)):null,
    note:complete&&allReadable?null:'Partial or unreadable cost; do not treat the sample as the bill.'};
};
export const billingUsage=defineRead({
  name:'github_billing_get_usage',area:'billing',audience:['O'],
  description:'Read real billed usage and optional premium requests in dollars for an enrolled organization or authorized user.',
  properties:{owner:OWNER,scope:{type:'string',enum:['organization','user']},
    year:YEAR,month:MONTH,day:DATE,max:MAX,
    summary:{type:'boolean'},premiumRequests:{type:'boolean'}},
  handler:(a,c)=>plain(async()=>{
    const account=a.scope==='user'?await userCred(a,c):await orgCred(a,c);
    const {gh,owner}=account,max=a.max??100;
    const opts={year:a.year,month:a.month,day:a.day};
    const base=a.scope==='user'?'/users/{username}/settings/billing/usage':
      '/organizations/{org}/settings/billing/usage';
    const query=a.scope==='user'?{username:account.user}:{org:owner};
    if(a.scope==='user'&&a.summary)throw new TypeError('User usage summary is not supported by this endpoint.');
    const suffix=a.summary?'/summary':'';
    const data=await request(gh,'GET '+base+suffix,{...query,...opts});
    const total=summarizeUsage(data?.usageItems,max);
    let premium=null;
    if(a.premiumRequests===true&&a.scope==='organization'){
      const d=await request(gh,
        'GET /organizations/{org}/settings/billing/premium_request/usage',{org:owner,...opts});
      premium=d;
    }
    return {owner,scope:a.scope??'organization',year:a.year??null,
      month:a.month??null,usage:total,premium_request_usage:premium,
      source:'GitHub billed API (netAmount in US dollars)'};
  })
});
async function budgetInventory(gh,org,max=500){
  const all=[];let total=null,complete=false;
  for(let page=1;page<=5;page++){
    const d=await request(gh,'GET /organizations/{org}/settings/billing/budgets',
      {org,per_page:100,page});
    if(!Array.isArray(d?.budgets))throw new TypeError('Budget inventory was unreadable.');
    total=d.total_count??total;
    all.push(...d.budgets);
    if(all.length>=max){
      complete=d.has_next_page===false&&all.length<=max&&
        (!Number.isInteger(total)||total===all.length);
      break;
    }
    if(d.has_next_page===false){complete=!Number.isInteger(total)||total===all.length;break;}
    if(d.budgets.length===0)break;
  }
  return {budgets:all.slice(0,max),complete,total};
}
const safeBudget=x=>({id:x.id,budget_scope:x.budget_scope,
  entity:x.budget_entity_name??null,
  budget_type:x.budget_type,budget_product_sku:x.budget_product_sku??null,
  budget_product_skus:x.budget_product_skus??null,
  amount_dollars:money(x.budget_amount),
  prevent_further_usage:x.prevent_further_usage===true,
  alerting:x.budget_alerting??null,expires_at:x.expires_at??null});
export const billingBudgets=defineRead({
  name:'github_billing_list_budgets',area:'billing',audience:['O'],
  description:'Inventory exact organization spending limits, scope, enforcement, alerts and honest truncation.',
  properties:{owner:OWNER,max:MAX},
  handler:(a,c)=>plain(async()=>{
    const {gh,owner}=await orgCred(a,c);
    const d=await budgetInventory(gh,owner,a.max??100);
    return {owner,budgets:d.budgets.map(safeBudget),total:d.total,
      complete:d.complete,
      note:d.complete?null:'Budget listing capped: cannot claim complete spending coverage.'};
  })
});
export const marketplace=defineRead({
  name:'github_billing_list_marketplace',area:'billing',audience:['O'],
  description:'Read user-authorized Marketplace purchases and current plan; purchases and upgrades remain guided only.',
  properties:{owner:OWNER,max:MAX},
  handler:(a,c)=>plain(async()=>{
    const {gh,user}=await userCred(a,c);
    const p=await request(gh,'GET /user/marketplace_purchases',{per_page:100});
    if(!Array.isArray(p))throw new TypeError('Marketplace purchases were unreadable.');
    return {user,purchases:p.slice(0,a.max??100).map(x=>({
      account:x.account?.login??null,plan:x.plan?.name??null,
      unit_count:x.unit_count??null,billing_cycle:x.billing_cycle??null,
      on_free_trial:x.on_free_trial??null,free_trial_ends_on:x.free_trial_ends_on??null,
      next_billing_date:x.next_billing_date??null})),
      complete:p.length<=(a.max??100)&&p.length<100,
      purchasing:'guided only — no Marketplace purchase API is exposed'};
  })
});
async function copilotSeats(gh,org,max=500){
  const seats=[];let count=null;
  for(let page=1;page<=5;page++){
    const d=await request(gh,'GET /orgs/{org}/copilot/billing/seats',
      {org,per_page:100,page});
    if(!Array.isArray(d?.seats))throw new TypeError('Copilot seat inventory was malformed.');
    count=d.total_seats??count;
    seats.push(...d.seats);
    if(seats.length>=max)break;
    if(d.seats.length<100)break;
  }
  return {seats:seats.slice(0,max),complete:Number.isInteger(count)?
    count<=max&&seats.length===count:seats.length<100,
    total:count};
}
export const copilotBilling=defineRead({
  name:'github_copilot_get_billing',area:'copilot',audience:['O'],
  description:'Read billed Copilot seat counts, plan, user assignments, activity and pending cancellations for an organization.',
  properties:{owner:OWNER,max:MAX},
  handler:(a,c)=>plain(async()=>{
    const {gh,owner}=await orgCred(a,c);
    const data=await request(gh,'GET /orgs/{org}/copilot/billing',{org:owner});
    const seats=await copilotSeats(gh,owner,a.max??100);
    return {owner,plan_type:data?.plan_type??null,
      approximate_monthly_seat_price_dollars:data?.plan_type==='business'?
        PRICES.copilot_business_seat.cents/100:
        data?.plan_type==='enterprise'?PRICES.copilot_enterprise_seat.cents/100:null,
      price_verified_on:'2026-10-14',
      count:data?.seat_breakdown?.total??null,
      breakdown:data?.seat_breakdown??null,
      seat_management_setting:data?.seat_management_setting??null,
      seats:seats.seats.map(x=>({
        login:x.assignee?.login??null,plan:x.plan_type??null,
        last_activity_at:x.last_activity_at??null,
        pending_cancellation_date:x.pending_cancellation_date??null,
        assigning_team:x.assigning_team?.slug??null})),
      complete:seats.complete&&data?.seat_breakdown?.total===seats.total,
      seat_count:seats.total};
  })
});
const safeCodespace=x=>({name:x.name,id:x.id,state:x.state,owner:x.owner?.login??null,
  repository:x.repository?.full_name??null,
  machine:x.machine?.name??null,cores:x.machine?.cpus??null,
  created_at:x.created_at??null,updated_at:x.updated_at??null,
  billable_owner:x.billable_owner?.login??null,
  web_url:x.web_url??null});
export const codespaces=defineRead({
  name:'github_codespace_list',area:'codespace',audience:['O','B'],
  description:'List bounded organization or user Codespaces with exact state, cores, repository and billable owner.',
  properties:{owner:OWNER,scope:{type:'string',enum:['organization','user']},max:MAX},
  handler:(a,c)=>plain(async()=>{
    const who=a.scope==='user'?await userCred(a,c,'codespace'):await orgCred(a,c);
    const {gh,owner}=who,max=a.max??100;
    const base=a.scope==='user'?'GET /user/codespaces':
      'GET /orgs/{org}/codespaces';
    const p=a.scope==='user'?{}:{org:owner};
    const records=[];let count=null;
    for(let page=1;page<=5;page++){
      const d=await request(gh,base,{...p,per_page:100,page});
      if(!Array.isArray(d?.codespaces))throw new TypeError('Codespaces inventory was malformed.');
      count=d.total_count??count;
      records.push(...d.codespaces);
      if(records.length>=max||d.codespaces.length<100)break;
    }
    const complete=Number.isInteger(count)?
      count<=max&&records.length===count:records.length<100;
    return {owner,scope:a.scope??'organization',
      codespaces:records.slice(0,max).map(safeCodespace),total:count,
      complete,note:complete?null:'Codespaces list is partial; no complete compute-cost assertion.'};
  })
});
export const codespaceMachines=defineRead({
  name:'github_codespace_list_machines',area:'codespace',audience:['O','B'],
  description:'Machine types (cores, memory, storage) a codespace of yours could be switched to.',
  properties:{codespaceName:{type:'string',pattern:'^[A-Za-z0-9-]{1,90}$',description:'Exact codespace name (from github_codespace_list)'}},required:['codespaceName'],
  handler:(a,c)=>plain(async()=>{
    const {gh}=await userCred({},c,'codespace');
    const d=await request(gh,'GET /user/codespaces/{codespace_name}/machines',{codespace_name:a.codespaceName});
    const machines=(d?.machines??[]).map(m=>({name:m.name,display_name:m.display_name,cpus:m.cpus,memory_gb:Number.isFinite(m.memory_in_bytes)?Math.round(m.memory_in_bytes/2**30):null,storage_gb:Number.isFinite(m.storage_in_bytes)?Math.round(m.storage_in_bytes/2**30):null,prebuild_availability:m.prebuild_availability??null}));
    return {codespace:a.codespaceName,count:machines.length,machines};
  })
});
export {budgetInventory,orgCred,userCred,copilotSeats};
export const tools=[billingUsage.tool,billingBudgets.tool,marketplace.tool,
  copilotBilling.tool,codespaces.tool,codespaceMachines.tool];
export const handlers=Object.fromEntries([
  [billingUsage.tool,billingUsage.handler],
  [billingBudgets.tool,billingBudgets.handler],
  [marketplace.tool,marketplace.handler],
  [copilotBilling.tool,copilotBilling.handler],
  [codespaces.tool,codespaces.handler],
  [codespaceMachines.tool,codespaceMachines.handler]
].map(([t,h])=>[t.name,h]));
