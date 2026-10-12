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
    expect(result.items.filter(x=>x.implemented).map(x=>x.name)).toEqual(['repo-basic','failing-ci']);
    expect(result.note).toMatch(/No GitHub objects/);
    const mine=body(await call(w,'github_dev_list_scenarios',{name:'stack-of-three',repo:'hello',runId:'run-test-1'}));
    expect(mine.plan_only).toBe(true);
    expect(mine.objects).toHaveLength(6);
    expect(mine.execution_available).toBe(false);
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
    await w.db.completeDevIntent({runId:id,account:'example-org',connection:'client-1',stepId:'step-1',objectId:arg.objectName});
    const saved=body(await call(w,'github_dev_list_runs',{runId:id}));
    expect(saved.objects).toEqual([expect.objectContaining({object_id:arg.objectName})]);
    expect(saved.intents[0].status).toBe('recorded');
  });
  it('refuses foreign accounts and IDs, and never exposes an unbounded run listing',async()=>{
    const w=await world();
    expect((await call(w,'github_dev_list_runs',{owner:'another-org'})).isError).toBe(true);
    expect((await call(w,'github_dev_list_runs',{max:500})).isError).toBe(true);
    expect((await call(w,'github_dev_list_runs',{runId:'run-unknown'})).isError).toBe(true);
  });
});
