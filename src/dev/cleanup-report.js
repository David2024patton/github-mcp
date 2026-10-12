// V-2 recorded cleanup evidence. A journal is not live GitHub readback.
const TYPES=new Set(['repo','branch','pr','issue','label','pr_label','tag','release','ruleset',
  'webhook','forwarder','check_run','workflow_file','fixture_file','fixture_revision',
  'review_comment','review_thread']);
export function summarizeDevCleanup({run,objects,intents,limit=50,moreMayExist=false}){
  if(!run?.id||!run.account||!run.connection||!Array.isArray(objects)||
    !Array.isArray(intents)||!Number.isInteger(limit)||limit<1||limit>50)
    throw new TypeError('A scoped run, complete objects/intents and a bounded limit are required.');
  const listing_complete=!moreMayExist&&objects.length<limit&&intents.length<limit;
  const issues=[];
  const exact=new Set();
  const items=objects.map(o=>{
    const key=JSON.stringify([o.object_type,o.owner,o.object_id]);
    if(!TYPES.has(o.object_type)||!o.object_id||!o.owner||
      o.run_id!==run.id||String(o.owner).toLowerCase()!==String(run.account).toLowerCase()||exact.has(key))
      issues.push({type:'identity_mismatch',object_id:String(o.object_id??'')});
    exact.add(key);
    return {type:o.object_type,owner:o.owner,repo:o.repo??null,id:o.object_id,
      recorded_sha:o.created_sha??null,cleaned_in_ledger:o.cleaned===true,
      state:o.cleaned===true?'marked_cleaned':'pending_cleanup',
      live_remote_absence_verified:false};
  }).sort((a,b)=>a.cleaned_in_ledger-b.cleaned_in_ledger||
    String(a.type).localeCompare(String(b.type))||String(a.id).localeCompare(String(b.id)));
  const claimed=intents.filter(i=>i.status==='claimed').map(i=>i.step_id);
  const uncertain=intents.filter(i=>i.status==='uncertain').map(i=>i.step_id);
  for(const i of intents) {
    const matching=i.status==='recorded'?objects.find(o=>
      o.object_type===i.object_type&&o.owner===i.owner&&o.object_id===i.object_id&&
      (o.repo??null)===(i.repo??null)&&(o.created_sha??null)===(i.created_sha??null)):null;
    if(i.run_id!==run.id||!['recorded','uncertain','claimed'].includes(i.status)||
      (i.status==='recorded'&&!matching))
      issues.push({type:'intent_mismatch',step_id:String(i.step_id??'')});
  }
  const remaining=items.filter(x=>!x.cleaned_in_ledger).length;
  const completed=items.length-remaining;
  if(run.status==='cleaned'&&remaining!==0)issues.push({type:'cleaned_run_with_pending_objects'});
  if(run.status==='active'&&completed!==0)issues.push({type:'active_run_with_cleaned_objects'});
  if(run.status==='cleaned'&&(uncertain.length||claimed.length))
    issues.push({type:'cleaned_run_with_unresolved_intents'});
  let state='not_started',next_action='Request a dry-run preview for an exact owned run before confirming cleanup.';
  if(!listing_complete){state='incomplete_listing';next_action='Request max: 50; if still capped, reconcile using paginated ledger reads before attempting cleanup.';}
  else if(issues.length){state='ledger_conflict';next_action='Resolve conflicting run identities and row states; do not send any GitHub mutation.';}
  else if(uncertain.length||claimed.length){state='reconciliation_required';next_action='Reconcile each pending or uncertain step by its exact GitHub ID; never blindly replay a create.';}
  else if(run.status==='cleaned'){state='ledger_cleaned';next_action='Cleanup is marked complete in the journal; connected external acceptance is not proven by this report.';}
  else if(run.status==='cleaning'){state='partial_cleanup';next_action=remaining===0?'Finalize after fresh remote readback and audit.':'Confirm and resume the exact run; completed object rows must not be deleted twice.';}
  else if(run.status!=='active'){state='unknown_run_status';next_action='Investigate unknown lifecycle state before touching GitHub.';}
  return {run_id:run.id,owner:run.account,connection:run.connection,
    status:run.status,cleaned_at:run.cleaned_at??null,state,listing_complete,
    listed_count:items.length,cleaned_count:listing_complete?completed:null,
    remaining_count:listing_complete?remaining:null,
    pending_claims:claimed,uncertain_claims:uncertain,issues,
    items,can_resume:listing_complete&&issues.length===0&&!claimed.length&&!uncertain.length&&run.status==='cleaning',
    live_acceptance_verified:false,remote_absence_verified:false,next_action};
}
