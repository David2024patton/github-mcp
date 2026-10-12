import {describe,it,expect} from 'vitest';
import {planBoundedRunSelection} from '../../src/dev/cleanup-batch.js';
const account='scratch-org',connection='client-1';
const row=(id,status='active')=>({id,account,connection,status});
const view=(run,ok=true)=>({run_id:run.id,run_status:run.status,journal_ready:ok,
  can_request_confirmation:ok,remote_verified:false,block_reason:ok?null:'Unresolved intent'});
const selection=(runs,change={})=>planBoundedRunSelection({runs,previews:runs.map(x=>view(x)),
  account,connection,totalCount:runs.length,hasNext:false,...change});
describe('bounded all-runs cleanup selection is evidence-only',()=>{
  it('requires separate confirmation and never claims remote readback even for a complete page',()=>{
    const runs=[row('run-one'),row('run-two','cleaning')];
    expect(selection(runs)).toMatchObject({run_ids:['run-one','run-two'],
      all_run_ids_visible:true,complete_journal_snapshot:false,
      requires_individual_run_confirmation:true,can_execute_without_new_confirmation:false});
  });
  it('refuses a partial page as proof of all-runs coverage',()=>{
    const runs=[row('run-one')];
    expect(selection(runs,{totalCount:3,hasNext:true})).toMatchObject({
      all_run_ids_visible:false,run_ids:['run-one'],complete_journal_snapshot:false});
    expect(selection(runs,{cursor:'opaque'}).all_run_ids_visible).toBe(false);
  });
  it('has a hard limit of five and identifies the excess without silently dropping it',()=>{
    const runs=Array.from({length:7},(_,i)=>row('run-'+String(i).padStart(3,'0')));
    const plan=selection(runs);
    expect(plan.run_ids).toHaveLength(5);
    expect(plan.blocked).toHaveLength(2);
    expect(plan.blocked[0].reason).toMatch(/limit/);
    expect(()=>selection(runs,{maxRuns:6})).toThrow(/bounded/);
  });
  it('reports individually blocked, cleaning and cleaned states',()=>{
    const runs=[row('run-good'),row('run-bad'),row('run-done','cleaned')];
    const previews=[view(runs[0]),view(runs[1],false),view(runs[2])];
    const s=selection(runs,{previews});
    expect(s.run_ids).toEqual(['run-good']);
    expect(s.blocked.map(x=>x.run_id)).toEqual(['run-bad','run-done']);
  });
  it('rejects cross-connection, order substitution and duplicate run IDs',()=>{
    const runs=[row('run-one')];
    for(const bad of [
      [row('run-one'),row('run-one')],
      [{...row('run-one'),connection:'other'}],
      [{...row('run-one'),account:'foreign'}],
      [{...row('run-one'),id:'BAD'}]
    ])expect(()=>selection(bad)).toThrow();
    expect(()=>selection(runs,{previews:[view(row('run-two'))]})).toThrow();
    expect(()=>selection(runs,{totalCount:0})).toThrow();
  });
});
