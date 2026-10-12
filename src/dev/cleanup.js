// Pure recorded-object cleanup plan. Nothing may search GitHub for look-alike tags.
const ORDER=['pr','review_comment','review_thread','pr_label','branch','release','tag','ruleset','webhook','forwarder','check_run','issue','label','workflow_file','fixture_revision','fixture_file','repo'];
export function planDevCleanup({run,objects,intents,moreMayExist=false}) {
  if(!run?.id||!run.account||!run.connection||!Array.isArray(objects)||!Array.isArray(intents))
    throw new TypeError('A scoped run and its exact inventory are required.');
  if(moreMayExist||objects.length>=50||intents.length>=50)
    throw new TypeError('Cleanup inventory could be truncated. Refusing any deletion.');
  if(!['active','cleaning','cleaned'].includes(run.status))throw new TypeError('Unknown cleanup state.');
  if(intents.some(i=>i.status!=='recorded'))
    throw new TypeError('Uncertain or incomplete writes must be reconciled before cleanup.');
  const keys=new Set(),repos=[];
  for(const o of objects) {
    if(o.run_id!==run.id||o.owner?.toLowerCase()!==run.account.toLowerCase()||
      !ORDER.includes(o.object_type)||typeof o.object_id!=='string'||!o.object_id)
      throw new TypeError('Foreign or unsupported exact object identity.');
    const k=JSON.stringify([o.object_type,o.owner,o.object_id]);
    if(keys.has(k))throw new TypeError('Duplicate exact object identity.');
    keys.add(k);
    if(o.object_type==='repo') {
      if(!o.repo||o.object_id.toLowerCase()!==`${o.owner}/${o.repo}`.toLowerCase())
        throw new TypeError('Inconsistent scratch repository identity.');
      repos.push(o);
    }
  }
  if(repos.length>1)throw new TypeError('Multiple scratch repositories require separate runs.');
  // A "recorded" step without its exact durable object is not valid cleanup
  // evidence. Check both directions before allowing any destructive operation.
  const steps=new Set();
  for(const i of intents){
    if(i.run_id!==run.id||typeof i.step_id!=='string'||!i.step_id||
      i.status!=='recorded'||!i.object_id||!i.object_type||!i.owner){
      throw new TypeError('A recorded intent has incomplete or foreign identity.');
    }
    if(steps.has(i.step_id))throw new TypeError('Duplicate recorded intent step.');
    steps.add(i.step_id);
    const object=objects.find(o=>o.object_type===i.object_type&&o.owner===i.owner&&
      o.object_id===i.object_id&&(o.repo??null)===(i.repo??null));
    if(!object||(object.created_sha??null)!==(i.created_sha??null))
      throw new TypeError('A recorded intent has no matching durable object; reconcile before cleanup.');
  }
  if(intents.length>0&&objects.some(o=>!intents.some(i=>i.object_type===o.object_type&&
    i.owner===o.owner&&i.object_id===o.object_id&&(i.repo??null)===(o.repo??null))))
    throw new TypeError('A durable object has no matching recorded intent; reconcile before cleanup.');
  const root=repos[0];
  if(root&&objects.some(o=>o.object_type!=='repo'&&o.repo!==root.repo))
    throw new TypeError('Recorded resource outside the scratch repository.');
  const entries=objects.filter(o=>o.cleaned!==true)
    .sort((a,b)=>ORDER.indexOf(a.object_type)-ORDER.indexOf(b.object_type)||a.object_id.localeCompare(b.object_id))
    .map(o=>({type:o.object_type,owner:o.owner,repo:o.repo,id:o.object_id,
      action:o.object_type==='repo'?'verify-and-delete-scratch-repo':
        root?'verify-as-removed-after-parent-deletion':'verify-and-delete-exact-id'}));
  return {run_id:run.id,account:run.account,connection:run.connection,status:run.status,
    count:entries.length,entries,requires_confirmation:true,remote_verified:false,
    note:'Plan only. Verify server-side scratch designation and exact GitHub identities before each deletion.'};
}
