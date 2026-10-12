import {describe,expect,it} from 'vitest';
import {createDispatch} from '../../src/tools/dispatch.js';
import {mergeNamespaces} from '../../src/core/registry.js';
import * as dev from '../../src/tools/dev-runs-read.js';
import {createFakeDb} from '../../test/helpers/fake-db.js';

const connection=Object.freeze({client_id:'client-1',default_account:'example-org',
  accounts:['example-org'],mode:'preview',profile:'read_only',listing:'catalog'});
const dispatch=createDispatch();
async function world(){
  const db=createFakeDb();await db.initSchema();
  await db.upsertAccount({login:'example-org',accountId:1001,accountType:'Organization',label:'Example',credentialKind:'app'});
  return {db,connection};
}
const call=(w,name,args={})=>dispatch({registry:mergeNamespaces([dev]),name,args,...w});
const body=r=>r.structuredContent??JSON.parse(r.content[0].text);

describe('V-1 public developer inspection',()=>{
  it('exposes seven truthful plan-only scenarios with no network calls or mutation',async()=>{
    const w=await world();
    const result=body(await call(w,'github_dev_list_scenarios'));
    expect(result.items).toHaveLength(7);
    expect(result.items.every(x=>x.execution_available===false&&['plan_only','scratch_gate_required'].includes(x.status))).toBe(true);
    expect(result.items.filter(x=>x.implemented).map(x=>x.name)).toEqual(['repo-basic','failing-ci','pr-with-threads','stack-of-three','release-train','protected-main']);
    expect(result.note).toMatch(/No GitHub objects/);
    const mine=await call(w,'github_dev_list_scenarios',{name:'pr-with-threads',repo:'hello',runId:'run-test-1'});
    expect(mine.isError).toBe(true); // unverified scratch account must not receive executable plan
    const denied=await call(w,'github_dev_list_scenarios',{name:'repo-basic',repo:'hello',runId:'run-test-1'});
    expect(denied.isError).toBe(true);
    expect((await w.db.listDevRuns({account:'example-org',connection:'client-1'}))).toEqual([]);
  });
  it('does not let callers assert a scratch account through arguments',async()=>{
    const w=await world();
    const bad=await call(w,'github_dev_list_scenarios',{name:'repo-basic',repo:'hello',runId:'run-test-2',scratch:true});
    expect(bad.isError).toBe(true);
    const foreign=await call(w,'github_dev_list_scenarios',{name:'stack-of-three',repo:'hello',runId:'run-test-2',owner:'not-connected'});
    expect(foreign.isError).toBe(true);
  });
  it('lists only the connection\'s runs and read-back of exact claims and IDs',async()=>{
    const w=await world(),id='run-inspect-1';
    await w.db.createDevRun({id,account:'example-org',connection:'client-1',scenarios:['stack-of-three']});
    await w.db.createDevRun({id:'run-inspect-2',account:'example-org',connection:'another'});
    const arg={runId:id,account:'example-org',connection:'client-1',type:'branch',owner:'example-org',repo:'hello',stepId:'step-1',objectName:'rtc/run-inspect-1/review'};
    await w.db.claimDevIntent(arg);
    await w.db.markDevIntentUncertain({runId:id,account:'example-org',connection:'client-1',stepId:'step-1'});
    const listing=body(await call(w,'github_dev_list_runs'));
    expect(listing.items.map(x=>x.id)).toEqual([id]);
    const result=body(await call(w,'github_dev_list_runs',{runId:id,max:20}));
    expect(result.intents).toEqual([expect.objectContaining({step_id:'step-1',status:'uncertain',object_id:null})]);
    expect(result.objects).toEqual([]);
    expect(result.progress).toMatchObject({state:'reconciliation_required',live_acceptance_verified:false,
      uncertain_steps:['step-1'],expected_object_count:14});
    await w.db.completeDevIntent({runId:id,account:'example-org',connection:'client-1',stepId:'step-1',objectId:arg.objectName});
    const saved=body(await call(w,'github_dev_list_runs',{runId:id}));
    expect(saved.objects).toEqual([expect.objectContaining({object_id:arg.objectName})]);
    expect(saved.intents[0].status).toBe('recorded');
    expect(saved.progress).toMatchObject({state:'partial',missing_object_count:13,
      ledger_identities_match:true,live_acceptance_verified:false});
  });
  it('exposes only scoped first-create evidence; never treats observation as cleanup authority',async()=>{
    const w=await world(),id='run-birth-inspect',account='example-org',connectionId='client-1';
    const a={runId:id,account,connection:connectionId};
    const repo='birth-inspect',sha='d'.repeat(40);
    await w.db.createDevRun({id,account,connection:connectionId,scenarios:['repo-basic']});
    await w.db.claimDevIntent({...a,stepId:'seed-repo',type:'repo',owner:account,repo,objectName:repo});
    expect(await w.db.completeDevBirthIntent({...a,stepId:'seed-repo',
      objectId:`${account}/${repo}`,createdSha:sha,labels:[
        {id:123,name:'bug',color:'D73A4A',description:'First observed'}]})).toBe(true);
    const summary=body(await call(w,'github_dev_list_runs',{runId:id,max:50}));
    expect(summary.birth_label_observation).toMatchObject({
      state:'recorded_observation',initial_sha:sha,observed_label_count:1,
      journal_binding_verified:true,origin_provenance_verified:false,
      delete_authority:false,remote_readback_verified:false});
    expect(summary.birth_label_observation.observed_labels).toBeUndefined();
    const full=body(await call(w,'github_dev_list_runs',{runId:id,max:50,includeBirthLabels:true}));
    expect(full.birth_label_observation.observed_labels).toEqual([
      {id:123,name:'bug',color:'d73a4a',description:'First observed'}]);
    const intruder={...w,connection:{...w.connection,client_id:'another-client'}};
    expect((await call(intruder,'github_dev_list_runs',{runId:id,includeBirthLabels:true})).isError).toBe(true);
    expect((await call(w,'github_dev_list_runs',{includeBirthLabels:true})).isError).toBe(true);
  });
  it("previews only the current connection's bounded cleanup journals without remote claims",async()=>{
    const w=await world(),a={account:'example-org',connection:'client-1'};
    await w.db.createDevRun({...a,id:'run-preview-a'});
    await w.db.recordDevObject({...a,runId:'run-preview-a',type:'branch',owner:a.account,
      repo:'host',objectId:'rtc/run-preview-a/one',createdSha:'a'.repeat(40)});
    await w.db.createDevRun({...a,id:'run-preview-b'});
    await w.db.claimDevIntent({...a,runId:'run-preview-b',stepId:'claim',
      type:'branch',owner:a.account,repo:'host',objectName:'rtc/run-preview-b/one'});
    await w.db.createDevRun({id:'run-preview-other',account:'example-org',connection:'other'});
    const partial=body(await call(w,'github_dev_list_runs',{max:1}));
    expect(partial).toMatchObject({count:1,total_count:2,more_may_exist:true});
    const scan=body(await call(w,'github_dev_list_runs',{max:20,cleanupPreview:true}));
    expect(scan).toMatchObject({count:2,total_count:2,all_runs_scanned:true,more_may_exist:false});
    expect(scan.cleanup_previews).toHaveLength(2);
    expect(scan.cleanup_previews.find(x=>x.run_id==='run-preview-a')).toMatchObject({
      journal_ready:true,remaining_objects:1,remote_verified:false
    });
    expect(scan.cleanup_previews.find(x=>x.run_id==='run-preview-b')).toMatchObject({
      journal_ready:false,can_request_confirmation:false
    });
    expect((await call(w,'github_dev_list_runs',{max:21,cleanupPreview:true})).isError).toBe(true);
    expect((await call(w,'github_dev_list_runs',{runId:'run-preview-a',cleanupPreview:true})).isError).toBe(true);
    expect((await w.db.listDevRuns(a)).length).toBe(2);
  });
  it('refuses a scratch cleanup preview whose journal contains a non-scenario resource',async()=>{
    const w=await world(),a={account:'example-org',connection:'client-1'};
    await w.db.createDevRun({...a,id:'run-scope-proof',scenarios:['repo-basic']});
    await w.db.recordDevObject({...a,runId:'run-scope-proof',
      type:'repo',owner:a.account,repo:'scratch',objectId:'example-org/scratch',
      createdSha:'a'.repeat(40)});
    const good=body(await call(w,'github_dev_list_runs',{cleanupPreview:true}));
    expect(good.cleanup_previews[0]).toMatchObject({
      journal_ready:true,remote_verified:false,can_request_confirmation:true
    });
    await w.db.recordDevObject({...a,runId:'run-scope-proof',
      type:'tag',owner:a.account,repo:'scratch',objectId:'v0.1.0'});
    const bad=body(await call(w,'github_dev_list_runs',{cleanupPreview:true}));
    expect(bad.cleanup_previews[0]).toMatchObject({
      journal_ready:false,remote_verified:false,can_request_confirmation:false
    });
    expect(bad.cleanup_previews[0].block_reason).toMatch(/non-scenario/i);
    expect(bad.bounded_selection.run_ids).toEqual([]);
    expect((await w.db.listDevObjects({...a,runId:'run-scope-proof'}))).toHaveLength(2);
  });
  it('pages stable scoped run IDs through opaque cursors and rejects forged handles',async()=>{
    const w=await world();
    for(const id of ['run-cursor-aa','run-cursor-bb','run-cursor-cc'])
      await w.db.createDevRun({id,account:'example-org',connection:'client-1'});
    const seen=[],cursors=new Set();
    let cursor;
    for(let i=0;i<4;i++){
      const page=body(await call(w,'github_dev_list_runs',{max:1,...(cursor?{cursor}:{})}));
      seen.push(...page.items.map(x=>x.id));
      if(!page.next_cursor)break;
      expect(cursors.has(page.next_cursor)).toBe(false);
      cursors.add(page.next_cursor);cursor=page.next_cursor;
    }
    expect(seen).toEqual(['run-cursor-cc','run-cursor-bb','run-cursor-aa']);
    expect((await call(w,'github_dev_list_runs',{cursor:'bad-cursor',max:1})).isError).toBe(true);
    expect((await call(w,'github_dev_list_runs',{runId:'run-cursor-aa',cursor})).isError).toBe(true);
    const complete=body(await call(w,'github_dev_list_runs',{max:10,cleanupPreview:true}));
    expect(complete).toMatchObject({next_cursor:null,all_runs_scanned:true,snapshot_not_atomic:true});
  });
  it('refuses foreign accounts and IDs, and never exposes an unbounded run listing',async()=>{
    const w=await world();
    expect((await call(w,'github_dev_list_runs',{owner:'another-org'})).isError).toBe(true);
    expect((await call(w,'github_dev_list_runs',{max:500})).isError).toBe(true);
    expect((await call(w,'github_dev_list_runs',{runId:'run-unknown'})).isError).toBe(true);
  });
});
