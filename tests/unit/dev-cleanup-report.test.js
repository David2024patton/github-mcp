import {describe,expect,it} from 'vitest';
import {summarizeDevCleanup} from '../../src/dev/cleanup-report.js';
const run={id:'run-audit-001',account:'example-org',connection:'client-1',status:'active'};
const obj=(id,cleaned=false)=>({run_id:run.id,object_type:'branch',owner:run.account,
  repo:'project',object_id:id,created_sha:'f'.repeat(40),cleaned});
describe('V-2 durable per-object cleanup evidence',()=>{
 it('starts as not-started and marks every exact journal object pending, without remote claims',()=>{
   const x=summarizeDevCleanup({run,objects:[obj('rtc/run-audit-001/a')],intents:[]});
   expect(x).toMatchObject({state:'not_started',remaining_count:1,cleaned_count:0,
     listing_complete:true,live_acceptance_verified:false,remote_absence_verified:false});
   expect(x.items[0]).toMatchObject({id:'rtc/run-audit-001/a',state:'pending_cleanup',
     cleaned_in_ledger:false,live_remote_absence_verified:false});
 });
 it('gives a scoped, resumable partial report without re-deleting completed rows',()=>{
   const x=summarizeDevCleanup({run:{...run,status:'cleaning'},objects:[
     obj('rtc/run-audit-001/a',true),obj('rtc/run-audit-001/b')],intents:[]});
   expect(x).toMatchObject({state:'partial_cleanup',remaining_count:1,cleaned_count:1,can_resume:true});
   expect(x.items.map(y=>y.state)).toEqual(['pending_cleanup','marked_cleaned']);
 });
 it('does not confuse ledger-cleaned with external verified acceptance',()=>{
   const x=summarizeDevCleanup({run:{...run,status:'cleaned',cleaned_at:new Date()},objects:[
     obj('rtc/run-audit-001/a',true)],intents:[]});
   expect(x).toMatchObject({state:'ledger_cleaned',remaining_count:0,live_acceptance_verified:false});
   expect(x.can_resume).toBe(false);
 });
 it('refuses completeness claims on truncated/foreign or inconsistent rows',()=>{
   expect(summarizeDevCleanup({run,objects:[obj('rtc/run-audit-001/a')],intents:[],limit:1}).state)
    .toBe('incomplete_listing');
   expect(summarizeDevCleanup({run,objects:[{...obj('a'),owner:'foreign'}],intents:[]}).state)
    .toBe('ledger_conflict');
   expect(summarizeDevCleanup({run:{...run,status:'cleaned'},objects:[obj('a')],intents:[]}).state)
    .toBe('ledger_conflict');
 });
 it('recognizes correctly scoped recorded intents and rejects orphaned evidence',()=>{
   const branch=obj('rtc/run-audit-001/a');
   const step={run_id:run.id,step_id:'branch',object_type:'branch',owner:run.account,repo:'project',
     object_id:branch.object_id,created_sha:branch.created_sha,status:'recorded'};
   expect(summarizeDevCleanup({run,objects:[branch],intents:[step]})).toMatchObject({
     state:'not_started',issues:[],listing_complete:true
   });
   expect(summarizeDevCleanup({run,objects:[branch],intents:[{...step,object_id:'other'}]})).toMatchObject({
     state:'ledger_conflict',issues:[{type:'intent_mismatch',step_id:'branch'}]
   });
 });
 it('surfaces uncertain and pending intents without treating them as safe retries',()=>{
   const intents=[{run_id:run.id,step_id:'s1',status:'uncertain'},{run_id:run.id,step_id:'s2',status:'claimed'}];
   const x=summarizeDevCleanup({run:{...run,status:'cleaning'},objects:[obj('a')],intents});
   expect(x).toMatchObject({state:'reconciliation_required',can_resume:false,
     uncertain_claims:['s1'],pending_claims:['s2']});
 });
});
