// V-2: a bounded all-runs selection is only a proposal, never deletion authority.
// A paginated journal view cannot prove that it is an atomic snapshot.
import { RUN_ID } from './ledger.js';

export function planBoundedRunSelection({runs,previews,account,connection,totalCount,hasNext,cursor=null,maxRuns=5}) {
  if(!Array.isArray(runs)||!Array.isArray(previews)||runs.length!==previews.length||
    !Number.isSafeInteger(totalCount)||totalCount<runs.length||
    !Number.isSafeInteger(maxRuns)||maxRuns<1||maxRuns>5||
    typeof account!=='string'||!account||typeof connection!=='string'||!connection)
    throw new TypeError('A bounded, connection-scoped cleanup preview is required.');
  const seen=new Set(), eligible=[],blocked=[];
  for(let i=0;i<runs.length;i++){
    const run=runs[i],preview=previews[i];
    if(!RUN_ID.test(run?.id??'')||seen.has(run.id)||
      run.account!==account||run.connection!==connection||
      preview?.run_id!==run.id||preview.run_status!==run.status)
      throw new TypeError('Cleanup selection contains a duplicate or foreign run.');
    seen.add(run.id);
    if(['active','cleaning'].includes(run.status)&&
      preview.journal_ready===true&&preview.can_request_confirmation===true&&
      preview.remote_verified===false){
      if(eligible.length<maxRuns)eligible.push(run.id);
      else blocked.push({run_id:run.id,reason:'Batch size limit: select in another independently confirmed request.'});
    }else blocked.push({run_id:run.id,reason:preview.block_reason??'Run is cleaned or not eligible for confirmed cleanup.'});
  }
  const complete=!cursor&&!hasNext&&totalCount===runs.length;
  return {run_ids:eligible,blocked,limit:maxRuns,total_count:totalCount,
    complete_journal_snapshot:false,all_run_ids_visible:complete,
    can_execute_without_new_confirmation:false,requires_individual_run_confirmation:true,
    note:complete?'Journal inventory only. Every ID still needs fresh GitHub preflight and its own explicit confirmed cleanup.':
      'More runs may exist. Follow the cursor; never interpret a partial page as all-runs deletion authority.'};
}
