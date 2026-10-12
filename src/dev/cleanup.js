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
