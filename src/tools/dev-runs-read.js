// V-1 read-only development-run inspection. Planning never implies that a scenario can execute.
import { defineRead } from './define-read.js';
import { listScenarioBlueprints, planScenario } from '../dev/scenarios.js';
import { SEEDABLE } from './dev-seed-write.js';
import { requireScratchOrg } from '../dev/scratch.js';
import { boundedRunLimit } from '../dev/ledger.js';
import { summarizeDevProgress } from '../dev/progress.js';
import { summarizeDevCleanup } from '../dev/cleanup-report.js';
import { planDevCleanup } from '../dev/cleanup.js';

const OWNER={type:'string',maxLength:39,description:'Connected account (default: your default account)'};
const RUN={type:'string',minLength:3,maxLength:43,pattern:'^[a-z][a-z0-9-]{2,42}$'};
const REPO={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$'};
const MAX={type:'integer',minimum:1,maximum:50,description:'Maximum records (default 20)'};
const ALL_PREVIEW={type:'boolean',description:'Include bounded per-run journal cleanup readiness (never a remote or deletion claim).'};

function scope(args,ctx) {
  const owner=String(args.owner??ctx.connection?.default_account??'');
  const matched=ctx.connection?.accounts?.find(a=>a.toLowerCase()===owner.toLowerCase());
  if(!matched)throw new TypeError('The account is not in this connection.');
  const connection=ctx.connection?.client_id;
  if(typeof connection!=='string'||!connection)throw new TypeError('The connection ID is unavailable.');
  return {account:matched,connection};
}
const readScenarios=defineRead({
  name:'github_dev_list_scenarios',area:'dev',audience:['B'],
  description:'Describe seven dev scenarios and six runnable scratch-only seeds; no writes.',
  properties:{owner:OWNER,repo:REPO,runId:RUN,name:{type:'string',enum:listScenarioBlueprints().map(x=>x.name)}},
  handler:async(args,ctx)=>{
    const items=listScenarioBlueprints().map(x=>({...x,implemented:SEEDABLE.includes(x.name),execution_available:false,status:SEEDABLE.includes(x.name)?'scratch_gate_required':'plan_only'}));
    if(!args.name&&!args.repo&&!args.runId&&!args.owner)return {count:items.length,items,note:'Plans only. No GitHub objects are created.'};
    if(!args.name||!args.repo||!args.runId)throw new TypeError('To view a detailed plan, provide name, repo and runId together.');
    const {account}=scope(args,ctx);
    const scratch=await requireScratchOrg(ctx,account).then(()=>true,()=>false);
    const plan=planScenario(args.name,{runId:args.runId,owner:account,repo:args.repo,scratch});
    return {...plan,implemented:SEEDABLE.includes(args.name),execution_available:scratch&&SEEDABLE.includes(args.name),verified_scratch_account:scratch,
      note:scratch&&SEEDABLE.includes(args.name)?'A verified scratch organization can execute this plan through github_dev_seed.':
        'Plan only: either this scenario is not implemented or IN-06 scratch verification is incomplete.'};
  }
});
const readRuns=defineRead({
  name:'github_dev_list_runs',area:'dev',audience:['B'],
  description:'Inspect scoped run IDs, object records, claims and incomplete state.',
  properties:{owner:OWNER,runId:RUN,max:MAX,cleanupPreview:ALL_PREVIEW},
  handler:async(args,ctx)=>{
    const {account,connection}=scope(args,ctx);
    const limit=boundedRunLimit(args.max??20);
    if(!args.runId){
      if(args.cleanupPreview&&limit>20)
        throw new TypeError('All-runs preview is limited to 20 runs per request.');
      const [items,total]=await Promise.all([
        ctx.db.listDevRuns({account,connection,limit}),
        ctx.db.countDevRuns({account,connection})
      ]);
      if(!args.cleanupPreview)return {account,count:items.length,total_count:total,
        more_may_exist:total>items.length,items};
      const cleanup_previews=[];
      for(const run of items){
        const [objects,intents]=await Promise.all([
          ctx.db.listDevObjects({runId:run.id,account,connection,limit:50}),
          ctx.db.listDevIntents({runId:run.id,account,connection,limit:50})
        ]);
        let journal_ready=false,reason=null,count=null;
        try {
          const plan=planDevCleanup({run,objects,intents,
            moreMayExist:objects.length>=50||intents.length>=50});
          journal_ready=true;count=plan.count;
        }catch(error){reason=error instanceof Error?error.message:'Unable to inspect exact ledger';}
        cleanup_previews.push({run_id:run.id,run_status:run.status,journal_ready,
          remaining_objects:count,block_reason:reason,
          can_request_confirmation:journal_ready&&run.status!=='cleaned',
          remote_verified:false,live_acceptance_verified:false});
      }
      return {account,count:items.length,total_count:total,
        more_may_exist:total>items.length,all_runs_scanned:total===items.length,
        cleanup_previews,note:'Evidence-only scoped journal preview, not GitHub verification. No deletion or cleanup confirmation performed.'};
    }
    if(args.cleanupPreview)throw new TypeError('Use cleanupPreview without runId for the bounded all-runs journal scan.');
    const run=await ctx.db.getDevRun({id:args.runId,account,connection});
    if(!run)throw new TypeError('No development run with that ID belongs to this connection.');
    const [objects,intents]=await Promise.all([
      ctx.db.listDevObjects({runId:args.runId,account,connection,limit}),
      ctx.db.listDevIntents({runId:args.runId,account,connection,limit})
    ]);
    const moreMayExist=objects.length===limit||intents.length===limit;
    const progress=summarizeDevProgress({run,objects,intents,limit,moreMayExist});
    const cleanup=summarizeDevCleanup({run,objects,intents,limit,moreMayExist});
    return {run,objects,intents,limit,more_may_exist:moreMayExist,progress,cleanup,
      note:'Recorded IDs prove only journal persistence, not connected GitHub acceptance. Uncertain steps must be reconciled.'};
  }
});
export const tools=[readScenarios.tool,readRuns.tool];
export const handlers={github_dev_list_scenarios:readScenarios.handler,github_dev_list_runs:readRuns.handler};
