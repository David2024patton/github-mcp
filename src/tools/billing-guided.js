// O-4: two spending-scope changes that must use guided owner flow.
// GitHub documents their writes but cannot expose a finite cost ceiling and,
// for org Codespaces access, supplies no GET policy readback endpoint.
import {defineRead} from './define-read.js';
import {plain,readerFor} from './github-read.js';

const OWNER={type:'string',maxLength:39};
const ID={type:'string',minLength:8,maxLength:80};
const LOGIN={type:'string',minLength:1,maxLength:39};
const USERS={type:'array',minItems:1,maxItems:20,uniqueItems:true,items:LOGIN};
const account=async(a,c)=>{
  const {owner,octokit:gh}=await readerFor(a,c);
  const row=await c.db.getAccount(owner);
  if(row?.account_type!=='Organization')
    throw new TypeError('Organization billing requires an enrolled organization.');
  return {owner,gh};
};
export const deleteBudget=defineRead({
  name:'github_billing_delete_budget',area:'billing',audience:['O'],
  description:'Guide a separately approved budget deletion safely when removing a cap may permit unbounded future spending.',
  properties:{owner:OWNER,budgetId:ID},required:['budgetId'],
  handler:(a,c)=>plain(async()=>{
    const {owner,gh}=await account(a,c);
    const budget=(await gh.request('GET /organizations/{org}/settings/billing/budgets/{budget_id}',
      {org:owner,budget_id:a.budgetId})).data;
    if(!budget||budget.id!==a.budgetId)
      throw new TypeError('GitHub did not verify the exact budget ID.');
    return {status:'guided',completed:false,account:owner,id:a.budgetId,
      current_amount_dollars:budget.budget_amount,
      enforces_limit:budget.prevent_further_usage===true,
      reason:'Removing a budget can allow unbounded future GitHub usage; no finite enforceable price is available for automated approval.',
      url:'https://github.com/organizations/'+encodeURIComponent(owner)+'/settings/billing/budgets',
      steps:[
        {n:1,action:'Review every other enforced organization, repository, and user spending limit and obtain separate owner authorization.',target:'GitHub billing budgets'},
        {n:2,action:'Open the exact budget with ID '+a.budgetId+' and select the delete control, after reviewing impact.',target:'Organization billing'},
        {n:3,action:'Confirm only in GitHub after independently verifying the replacement ceiling; otherwise cancel.',target:'GitHub confirmation'}],
      verifyWith:{tool:'github_billing_list_budgets',args:{owner},
        instruction:'Verify exact budget ID is absent and the remaining effective limits are still enforced.'},
      completion:'unverified until owner confirmation and fresh provider readback'};
  })
});
export const setCodespaceAccess=defineRead({
  name:'github_codespace_set_org_access',area:'codespace',audience:['O'],
  description:'Guide safe organization-paid Codespaces access changes when GitHub provides no policy readback endpoint.',
  properties:{owner:OWNER,visibility:{type:'string',enum:[
    'disabled','selected_members','all_members','all_members_and_outside_collaborators']},
    usernames:USERS},
  required:['visibility'],
  handler:(a,c)=>plain(async()=>{
    const {owner,gh}=await account(a,c);
    const d=(await gh.request('GET /orgs/{org}',{org:owner})).data;
    if(d?.login?.toLowerCase()!==owner.toLowerCase())
      throw new TypeError('Organization identity not verified.');
    if(a.visibility==='selected_members'&&!a.usernames?.length)
      throw new TypeError('Selected-member mode requires exact approved usernames.');
    if(a.visibility!=='selected_members'&&a.usernames?.length)
      throw new TypeError('Named usernames only apply to selected-member mode.');
    return {status:'guided',completed:false,owner,visibility:a.visibility,
      selected_users:a.usernames??[],
      reason:'Codespaces access grants can trigger uncapped usage, and GitHub does not document an independent policy GET endpoint to verify a write.',
      url:'https://github.com/organizations/'+encodeURIComponent(owner)+'/settings/codespaces',
      steps:[
        {n:1,action:'Verify billing budgets, member eligibility and obtain independent owner approval before any paid access expansion.',target:'Billing and licenses'},
        {n:2,action:'Open organization Codespaces settings and set visibility to '+a.visibility+
          (a.usernames?.length?', exact members: '+a.usernames.join(', '):''),target:'Codespaces access'},
        {n:3,action:'Read the saved GitHub setting back in the interface and independently confirm each approved user.',target:'Codespaces access'}],
      completion:'requires GitHub UI verification or explicit owner readback; API response alone cannot establish success'};
  })
});
export const tools=[deleteBudget.tool,setCodespaceAccess.tool];
export const handlers={
  [deleteBudget.tool.name]:deleteBudget.handler,
  [setCodespaceAccess.tool.name]:setCodespaceAccess.handler};
