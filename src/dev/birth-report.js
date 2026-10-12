// V-1 first-create evidence is only an immutable observation. Never elevate
// observed labels, matching names/IDs or an intact journal into delete authority.
import {validateScratchBirthLabels} from './ledger.js';
const SHA=/^[a-f0-9]{40}$/;

export function summarizeScratchBirth({run,objects,intents,birth,listingComplete,includeLabels=false}){
  if(!run?.id||!Array.isArray(objects)||!Array.isArray(intents))
    throw new TypeError('A scoped development run and journal are required.');
  const denied={origin_provenance_verified:false,delete_authority:false,
    remote_readback_verified:false};
  if(!birth)return {state:'not_recorded',...denied,
    next_action:'A first-create label observation is missing. Do not infer GitHub-created labels or authorize repository deletion.'};
  const labels=validateScratchBirthLabels(birth.labels);
  const roots=objects.filter(o=>o.object_type==='repo');
  const steps=intents.filter(i=>['seed-repo','create-scratch-repo'].includes(i.step_id)&&
    i.object_type==='repo'&&i.status==='recorded');
  const exact=listingComplete&&roots.length===1&&steps.length===1&&
    roots[0].run_id===run.id&&steps[0].run_id===run.id&&
    roots[0].owner?.toLowerCase()===run.account?.toLowerCase()&&
    roots[0].repo===birth.repo&&
    roots[0].object_id?.toLowerCase()===`${birth.owner}/${birth.repo}`.toLowerCase()&&
    birth.owner?.toLowerCase()===run.account?.toLowerCase()&&
    SHA.test(birth.source_sha??'')&&roots[0].created_sha===birth.source_sha&&
    steps[0].object_id===roots[0].object_id&&
    steps[0].created_sha===birth.source_sha&&
    steps[0].owner===roots[0].owner&&steps[0].repo===birth.repo;
  const state=!listingComplete?'incomplete_journal':exact?'recorded_observation':'journal_mismatch';
  return {state,initial_sha:birth.source_sha,owner:birth.owner,repo:birth.repo,
    captured_at:birth.captured_at??null,observed_label_count:labels.length,
    ...(includeLabels?{observed_labels:labels}:{}),
    journal_binding_verified:!!exact,...denied,
    next_action:exact
      ? 'Compare full first-observed metadata against an independent current GitHub inventory. This observation is NOT creator provenance or deletion approval.'
      : 'Reconcile the complete scoped journal and original commit before interpreting any birth-label observation.'};
}
