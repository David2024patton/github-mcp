import {describe,it,expect} from 'vitest';
import {makeWorld,runWriteContract,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import * as defs from '../../src/tools/billing-write.js';

const org='example-org';
const B='GET /organizations/{org}/settings/billing/budgets';
const BG='GET /organizations/{org}/settings/billing/budgets/{budget_id}';
const BC='POST /organizations/{org}/settings/billing/budgets';
const billing='GET /orgs/{org}/copilot/billing';
const assignments='GET /orgs/{org}/copilot/billing/seats';
const seatPut='POST /orgs/{org}/copilot/billing/selected_users';
const seatDel='DELETE /orgs/{org}/copilot/billing/selected_users';
const membership='GET /orgs/{org}/memberships/{username}';
const csUser='GET /user';
const csGet='GET /user/codespaces/{codespace_name}';
const csRepo='GET /repos/{owner}/{repo}';
const csMachines='GET /repos/{owner}/{repo}/codespaces/machines';
const csCreate='POST /repos/{owner}/{repo}/codespaces';
const csStart='POST /user/codespaces/{codespace_name}/start';
const csDelete='DELETE /user/codespaces/{codespace_name}';
const limit={has_next_page:false,total_count:0,budgets:[]};
const b={id:'abc01234-def56789',budget_scope:'organization',
  budget_amount:30,budget_type:'ProductPricing',budget_product_sku:'actions',
  prevent_further_usage:true,budget_alerting:{will_alert:false,alert_recipients:[]}};
const plan={plan_type:'business',seat_management_setting:'assign_selected',
  seat_breakdown:{total:1}};
const seat=(pending=null)=>({assignee:{login:'alice'},plan_type:'business',
  pending_cancellation_date:pending});
const current=(state='Shutdown')=>({
  name:'test-code',id:99,state,repository:{full_name:'example-org/hello'},
  owner:{login:'example-owner'},billable_owner:{login:'example-org'},
  machine:{name:'basic',cpus:2},
  git_status:{has_unpushed_changes:false,has_uncommitted_changes:false}});
function budgetArrange(gh,result){
  gh.when(B).reply(200,limit);
  gh.when(BC).reply(200,{budget:b});
  gh.when(BG).reply(200,result==='ok'?b:{...b,budget_amount:40});
}
function addSeats(gh,result){
  gh.when(billing).reply(200,plan);
  gh.when(assignments).replySequence([
    {status:200,body:{total_seats:0,seats:[]}},
    {status:200,body:{total_seats:result==='ok'?1:0,
      seats:result==='ok'?[seat()]:[]}}]);
  gh.when(membership).reply(200,{state:'active',role:'member'});
  gh.when(seatPut).reply(201,{seats_created:1});
}
function removeSeats(gh,result){
  gh.when(billing).reply(200,plan);
  gh.when(assignments).replySequence([
    {status:200,body:{total_seats:1,seats:[seat()]}},
    {status:200,body:{total_seats:1,
      seats:[seat(result==='ok'?'2026-11-01':null)]}}]);
  gh.when(seatDel).reply(200,{seats_cancelled:1});
}
function codeUser(gh){gh.when(csUser).reply(200,{login:'example-owner'});}
function createCode(gh,result){
  codeUser(gh);
  gh.when(csRepo).reply(200,{id:88,full_name:'example-org/hello'});
  gh.when(csMachines).reply(200,{machines:[{name:'basic',cpus:2}]});
  gh.when(csCreate).reply(201,{name:'test-code'});
  gh.when(csGet).reply(200,result==='ok'?current('Available'):
    {...current('Available'),repository:{full_name:'other-org/hello'}});
}
function startCode(gh,result){
  codeUser(gh);
  gh.when(csGet).replySequence([
    {status:200,body:current('Shutdown')},
    {status:200,body:current(result==='ok'?'Available':'Shutdown')}]);
  gh.when(csStart).reply(201,current('Available'));
}
function deleteCode(gh,result){
  codeUser(gh);
  gh.when(csGet).replySequence([
    {status:200,body:current('Shutdown')},
    result==='ok'?{status:404,body:{message:'Not Found'}}:
      {status:200,body:current('Shutdown')}]);
  gh.when(csDelete).reply(204,null);
}
const writeDef=name=>({tool:defs.tools.find(x=>x.name===name),
  handler:defs.handlers[name]});
const contracts=[
  {name:'github_billing_save_budget',
    args:{action:'create',budgetAmount:30,budgetScope:'organization',
      budgetType:'ProductPricing',budgetProductSku:'actions',
      preventFurtherUsage:true},arrange:budgetArrange,
    spendCents:3000,production:true},
  {name:'github_copilot_add_seats',args:{usernames:['alice']},
    arrange:addSeats,spendCents:1900,production:true,
    accessWidening:true,notifies:['alice']},
  {name:'github_copilot_remove_seats',args:{usernames:['alice']},
    arrange:removeSeats,production:true},
  {name:'github_codespace_create',
    args:{repo:'hello',ref:'main',machine:'basic',machineCores:2,
      estimatedHours:1,storageGb:1},arrange:createCode,
    spendCents:25,production:true},
  {name:'github_codespace_set_state',
    args:{name:'test-code',action:'start',estimatedHours:1},
    arrange:startCode,spendCents:18,production:true},
  {name:'github_codespace_delete',args:{name:'test-code'},
    arrange:deleteCode}
];
for(const c of contracts)
  runWriteContract({label:c.name,definition:writeDef(c.name),args:c.args,
    arrange:c.arrange,profile:'full',needsConfirm:true,
    spendCents:c.spendCents??0,production:c.production??false,
    accessWidening:c.accessWidening??false,notifies:c.notifies??[]});
async function invoke(w,name,args={}){
  const dispatch=createDispatch({env:w.ctx.env,credentials:w.credentials,
    fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:[]});
  const response=await dispatch({registry,name,args,connection:w.connection,db:w.db});
  return response.structuredContent??(response.isError?
    {done:false,error:response.content?.[0]?.text}:parse(response));
}
describe('O-4 real prices, budget safety, marketplace, Copilot and Codespaces',()=>{
  it('reads GitHub usage dollar values without inventing cents or all-data totals',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when('GET /organizations/{org}/settings/billing/usage').reply(200,{
      usageItems:[{product:'Actions',sku:'actions_linux',quantity:25,
        unitType:'minutes',grossAmount:1,discountAmount:0.2,netAmount:0.8}]});
    const actual=await invoke(w,'github_billing_get_usage');
    expect(actual.usage.total_net_dollars).toBe(0.8);
    expect(actual.usage.items[0].net_dollars).toBe(0.8);
    expect(actual.usage.complete).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
  it('returns exact budgets with dollar caps and their enforcement flags',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when(B).reply(200,{budgets:[b],has_next_page:false,total_count:1});
    const actual=await invoke(w,'github_billing_list_budgets');
    expect(actual.budgets[0].amount_dollars).toBe(30);
    expect(actual.budgets[0].prevent_further_usage).toBe(true);
    expect(actual.complete).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
  it('shows the real paid plan and seats with cancellation date',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when(billing).reply(200,plan);
    w.gh.when(assignments).reply(200,{total_seats:1,
      seats:[seat('2026-11-01')]});
    const result=await invoke(w,'github_copilot_get_billing');
    expect(result.approximate_monthly_seat_price_dollars).toBe(19);
    expect(result.seats[0].pending_cancellation_date).toBe('2026-11-01');
    expect(result.complete).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
  it('reads exact user Codespace state and billable owner',async()=>{
    const w=await makeWorld({profile:'read_only'});
    codeUser(w.gh);
    w.gh.when('GET /user/codespaces').reply(200,{
      total_count:1,codespaces:[current('Available')]});
    const result=await invoke(w,'github_codespace_list',{scope:'user'});
    expect(result.codespaces[0].billable_owner).toBe('example-org');
    expect(result.codespaces[0].state).toBe('Available');
    expect(result.complete).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
  it('never deletes a budget if removing its ceiling creates unbounded spend exposure',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(BG).reply(200,b);
    const result=await invoke(w,'github_billing_delete_budget',{
      budgetId:b.id,confirm:true});
    expect(result).toMatchObject({status:'guided',completed:false,
      enforces_limit:true});
    expect(w.gh.calls.filter(x=>x.method!=='GET')).toHaveLength(0);
  });
  it('refuses paid Codespace access expansion without finite verified cap',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    const result=await invoke(w,'github_codespace_set_org_access',{
      visibility:'all_members',confirm:true});
    expect(result).toMatchObject({status:'guided',completed:false,
      visibility:'all_members'});
    expect(w.gh.calls.filter(x=>x.method!=='GET')).toHaveLength(0);
  });
  it('rejects unknown Copilot plan prices at zero exposure rather than guessing',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when(billing).reply(200,{...plan,plan_type:'unknown'});
    w.gh.when(assignments).reply(200,{total_seats:0,seats:[]});
    const result=await invoke(w,'github_copilot_add_seats',{
      usernames:['alice'],confirm:true});
    expect(result.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.method!=='GET')).toHaveLength(0);
  });
});
