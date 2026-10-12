import {describe,it,expect} from 'vitest';
import {summarizeDevProgress} from '../../src/dev/progress.js';
const run={id:'run-proof',scenarios:['repo-basic'],status:'active'};
const obj=(type,id)=>({object_type:type,object_id:id,owner:'example-org',repo:'scratch',cleaned:false});
const intent=(o,status='recorded')=>({object_type:o.object_type,object_id:o.object_id,
 owner:o.owner,repo:o.repo,step_id:`step-${o.object_type}`,status});
const objects=[obj('repo','example-org/scratch'),obj('workflow_file','workflow.yml'),obj('label','rtc-run')];
const intents=objects.map(o=>intent(o));
const call=(moreMayExist=false,o=objects,i=intents,other={})=>summarizeDevProgress({
 run,objects:o,intents:i,limit:20,moreMayExist,...other
});
describe('V-1 read-only durable progress evidence',()=>{
 it('reports fully paired records but never claims connected/live acceptance',()=>{
  expect(call()).toMatchObject({state:'recorded_complete',expected_object_count:3,
    listed_object_count:3,recorded_intent_count:3,missing_object_count:0,
    ledger_identities_match:true,listing_complete:true,live_acceptance_verified:false});
 });
 it('blocks completion when identities differ despite matching total counts',()=>{
  const bad=[...intents.slice(0,2),{...intents[2],object_id:'foreign-label'}];
  expect(call(false,objects,bad)).toMatchObject({state:'identity_review_required',
    ledger_identities_match:false,live_acceptance_verified:false});
 });
 it('refuses confidence on capped results or unresolved remote intent',()=>{
  expect(call(true)).toMatchObject({state:'incomplete_listing',listing_complete:false,
    missing_object_count:null});
  expect(call(false,objects,[...intents.slice(0,2),intent(objects[2],'uncertain')]))
    .toMatchObject({state:'reconciliation_required',uncertain_steps:['step-label']});
  expect(call(false,objects,[...intents.slice(0,2),intent(objects[2],'claimed')]))
    .toMatchObject({state:'pending_claims',claimed_steps:['step-label']});
 });
 it('distinguishes genuinely incomplete and cleaned/unknown runs',()=>{
  expect(call(false,objects.slice(0,2),intents.slice(0,2)))
    .toMatchObject({state:'partial',missing_object_count:1});
  expect(call(false,[{...objects[0],cleaned:true},...objects.slice(1)],intents))
    .toMatchObject({state:'identity_review_required',cleaned_object_count:1});
  expect(call(false,[],[],{run:{...run,scenarios:['unrecognized']}}))
    .toMatchObject({state:'unknown_scenario',expected_object_count:null});
 });
});
