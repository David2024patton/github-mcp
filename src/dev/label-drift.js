// Exact first-observed label IDs detect remote drift, not GitHub creator provenance.
import {validateScratchBirthLabels} from './ledger.js';
export function compareObservedScratchLabels(birth,remote){
  const initial=validateScratchBirthLabels(birth),current=validateScratchBirthLabels(remote);
  const previous=new Map(initial.map(x=>[x.id,x])),latest=new Map(current.map(x=>[x.id,x]));
  const added=current.filter(x=>!previous.has(x.id));
  const missing=initial.filter(x=>!latest.has(x.id));
  const changed=initial.filter(before=>{
    const after=latest.get(before.id);
    return after&&(before.name!==after.name||before.color!==after.color||
      before.description!==after.description);
  }).map(before=>({id:before.id,before,after:latest.get(before.id)}));
  return {initial_count:initial.length,live_count:current.length,
    unchanged_count:initial.length-missing.length-changed.length,
    added_after_observation:added,missing_since_observation:missing,
    changed_since_observation:changed,
    exact_observation_unchanged:!added.length&&!missing.length&&!changed.length,
    creator_provenance_verified:false,default_labels_owned_by_run:false,
    deletion_authorized:false,snapshot_atomic:false,
    note:'Exact IDs detect additions, removals and repurposing after the first read; matching default labels do not prove who created them.'};
}
