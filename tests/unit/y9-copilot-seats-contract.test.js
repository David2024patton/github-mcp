// Y-9d Copilot team-seat billing/cancellation through every protected write door.
import {runWriteContract} from '../../test/helpers/write-contract.js';
import * as copilot from '../../src/tools/y9-copilot.js';

const def=name=>({tool:copilot.tools.find(x=>x.name===name),handler:copilot.handlers[name]});
const BILL='GET /orgs/{org}/copilot/billing';
const TEAM='GET /orgs/{org}/teams/{team_slug}/members';
const SEATS='GET /orgs/{org}/copilot/billing/seats';
const user=(pending=null)=>({assignee:{login:'alice'},plan_type:'business',
  assigning_team:{slug:'engineering'},pending_cancellation_date:pending});
function basic(gh) {
  gh.when(BILL).reply(200,{plan_type:'business',seat_management_setting:'assign_selected'});
  gh.when(TEAM).reply(200,[{login:'alice'}]);
}
function add(gh,result){
  basic(gh);
  gh.when(SEATS).replySequence([
    {status:200,body:{total_seats:0,seats:[]}},
    {status:200,body:{total_seats:result==='ok'?1:0,seats:result==='ok'?[user()]:[]}}
  ]);
  gh.when('POST /orgs/{org}/copilot/billing/selected_teams').reply(201,{seats_created:1});
}
function remove(gh,result){
  basic(gh);
  gh.when(SEATS).replySequence([
    {status:200,body:{total_seats:1,seats:[user()]}},
    {status:200,body:{total_seats:1,seats:[user(result==='ok'?'2026-11-10':null)]}}
  ]);
  gh.when('DELETE /orgs/{org}/copilot/billing/selected_teams').reply(200,{seats_cancelled:1});
}
runWriteContract({label:'Y-9d github_copilot_team_seats',definition:def('github_copilot_team_seats'),
  args:{teamSlug:'engineering',action:'add'},arrange:add,
  production:true,profile:'full',needsConfirm:true,spendCents:1900,accessWidening:true});
runWriteContract({label:'Y-9d github_copilot_team_seats_remove',definition:def('github_copilot_team_seats_remove'),
  args:{teamSlug:'engineering',action:'remove'},arrange:remove,
  production:true,profile:'full',needsConfirm:true});
