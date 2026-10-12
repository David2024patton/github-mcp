import {describe,it,expect} from 'vitest';
import {createFakeDevLedger} from '../../test/helpers/dev-ledger-fake.js';
import {withCleanupExecution} from '../../src/dev/cleanup-execution.js';
import {handlers} from '../../src/tools/dev-runs-read.js';
const owner='example-org',runId='run-executor-001',connection='client-one';
const scope={runId,account:owner,connection};
async function world(){
  const db=createFakeDevLedger();await db.createDevRun({id:runId,account:owner,connection});
  return {db,connection:{client_id:connection,accounts:[owner],default_account:owner,mode:'preview'}};
}
describe('exclusive developer cleanup execution',()=>{
  it('refuses another request while the first worker is awaiting the provider',async()=>{
    const ctx=await world();let finish,started;
    const running=new Promise(resolve=>{started=resolve;});
    const paused=new Promise(resolve=>{finish=resolve;});
    let mutations=0;
    const first=withCleanupExecution(ctx,{owner,runId},async()=>{mutations++;started();await paused;return 'verified';});
    await running;
    try{
      await expect(withCleanupExecution(ctx,{owner,runId},async()=>{mutations++;})).rejects.toThrow(/concurrent/);
      expect(mutations).toBe(1);
    }finally{finish();}
    expect(await first).toBe('verified');
    expect(await ctx.db.getDevCleanupExecution(scope)).toBeNull();
    expect(await withCleanupExecution(ctx,{owner,runId},async()=>true)).toBe(true);
  });
  it.each([403,422,429])('releases a definitely rejected attempt (%s) for fresh guarded retry',async status=>{
    const ctx=await world();
    const error=Object.assign(new Error('Provider rejected'),{status});
    await expect(withCleanupExecution(ctx,{owner,runId},async()=>{throw error;})).rejects.toBe(error);
    expect(await ctx.db.getDevCleanupExecution(scope)).toBeNull();
  });
  it.each([undefined,408,500])('retains an uncertain execution (%s) and blocks automatic takeover',async status=>{
    const ctx=await world(),error=Object.assign(new Error('Unknown outcome'),{status});
    await expect(withCleanupExecution(ctx,{owner,runId},async()=>{throw error;})).rejects.toBe(error);
    expect(await ctx.db.getDevCleanupExecution(scope)).not.toBeNull();
    await expect(withCleanupExecution(ctx,{owner,runId},async()=>true)).rejects.toThrow(/unresolved/);
    const data=await handlers.github_dev_list_runs({runId},ctx);
    expect(data.cleanup_execution).toMatchObject({state:'active_or_unresolved',automatic_takeover_allowed:false});
    expect(data.cleanup_execution).not.toHaveProperty('executor_id');
  });
  it('cannot release another worker claim after losing ownership',async()=>{
    const ctx=await world();ctx.db.releaseDevCleanupExecution=async()=>false;
    await expect(withCleanupExecution(ctx,{owner,runId},async()=>true)).rejects.toThrow(/could not be released/);
    expect(await ctx.db.getDevCleanupExecution(scope)).not.toBeNull();
  });
});
