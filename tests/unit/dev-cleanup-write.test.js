import {describe,expect,it} from 'vitest';
import {runWriteContract,makeWorld,parse} from '../../test/helpers/write-contract.js';
import * as mod from '../../src/tools/dev-cleanup-write.js';
const RUN='run-clean-204',REPO='fixture',OWNER='example-org';
const repo={full_name:`${OWNER}/${REPO}`,private:true,description:`Developer fixture for rtc_run=${RUN}`,default_branch:'main'};
const def={tool:mod.tools[0],handler:mod.handlers.github_dev_cleanup};
async function prepare(world){
  await world.db.createDevRun({id:RUN,account:OWNER,connection:'client-1',scenarios:['repo-basic']});
  await world.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',
    type:'repo',owner:OWNER,repo:REPO,objectId:`${OWNER}/${REPO}`});
}
function arrange(gh,outcome){
  gh.when('GET /repos/{owner}/{repo}').replySequence([
    {status:200,body:repo},{status:200,body:repo},{status:200,body:repo},{status:200,body:repo},
    outcome==='mismatch'?{status:200,body:repo}:{status:404,body:{message:'Not Found'}},
    outcome==='mismatch'?{status:200,body:repo}:{status:404,body:{message:'Not Found'}}
  ]);
  gh.when('DELETE /repos/{owner}/{repo}').reply(204);
}
runWriteContract({label:'github_dev_cleanup exact scratch',definition:def,
  args:{runId:RUN,repo:REPO},scratchAccount:true,previewOnly:true,
  needsConfirm:true,expectedWrites:1,prepare,arrange});
describe('V-2 protected run deletion',()=>{
  it('refuses unverified owner and non-scratch account before any remote read',async()=>{
    const w=await makeWorld();await prepare(w);arrange(w.gh,'ok');
    const result=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(result.done).toBe(false);
    expect(w.gh.calls).toHaveLength(0);
  });
  it('rejects a mismatched private repository identity without sending DELETE',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w);
    w.gh.when('GET /repos/{owner}/{repo}').reply(200,{...repo,description:'foreign'});
    const result=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(result.done).toBe(false);
    expect(w.gh.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
  });
  it('refuses a prefix-collision scratch marker before deleting any repository',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w);
    w.gh.when('GET /repos/{owner}/{repo}').reply(200,{
      ...repo,description:'Developer fixture rtc_run='+RUN+'-other (repo-basic)'
    });
    const result=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(result.done).toBe(false);
    expect(w.gh.calls.filter(c=>c.method==='DELETE')).toHaveLength(0);
  });
  it('never allows a production connection to perform developer cleanup',async()=>{
    const w=await makeWorld({scratchAccount:true,mode:'production'});await prepare(w);arrange(w.gh,'ok');
    const result=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(result.status).toBe('refused');
    expect(w.gh.calls).toHaveLength(0);
  });
});
