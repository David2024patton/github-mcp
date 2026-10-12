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
  gh.when('GET /repos/{owner}/{repo}/branches').reply(200,[{name:'main',commit:{sha:'a'.repeat(40)}}]);
  gh.when('GET /repos/{owner}/{repo}/pulls').reply(200,[]);
  gh.when('GET /repos/{owner}/{repo}/issues').reply(200,[]);
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
  it('refuses to delete a scratch repository containing an unjournaled branch',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
    w.gh.when('GET /repos/{owner}/{repo}/branches').reply(200,[
      {name:'main',commit:{sha:'a'.repeat(40)}},
      {name:'outsider-work',commit:{sha:'b'.repeat(40)}}
    ]);
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(false);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses a foreign PR or issue even when the repository marker matches',async()=>{
    for(const [route,body] of [
      ['GET /repos/{owner}/{repo}/pulls',[{number:55,body:'unrelated',merged:false}]],
      ['GET /repos/{owner}/{repo}/issues',[{number:56,body:'unrelated'}]]
    ]){
      const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
      w.gh.when(route).reply(200,body);
      const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
      expect(out.done).toBe(false);
      expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(false);
      expect(w.gh.invalid).toEqual([]);
    }
  });
  it('refuses an incomplete remote listing instead of assuming there are no foreign artifacts',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
    w.gh.when('GET /repos/{owner}/{repo}/branches').reply(200,[
      {name:'main',commit:{sha:'a'.repeat(40)}}
    ],{'link':'<https://api.github.com/repos/example-org/fixture/branches?page=2>; rel="next"'});
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(false);
  });
  it('refuses a recorded scratch branch whose HEAD changed outside recorded fixture commits',async()=>{
    const w=await makeWorld({scratchAccount:true});await prepare(w);arrange(w.gh,'ok');
    const name=`rtc/${RUN}/feature`;
    await w.db.recordDevObject({runId:RUN,account:OWNER,connection:'client-1',type:'branch',
      owner:OWNER,repo:REPO,objectId:name,createdSha:'a'.repeat(40)});
    w.gh.when('GET /repos/{owner}/{repo}/branches').reply(200,[
      {name:'main',commit:{sha:'a'.repeat(40)}},{name,commit:{sha:'b'.repeat(40)}}
    ]);
    const out=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(out.done).toBe(false);
    expect(w.gh.calls.some(c=>c.route==='DELETE /repos/{owner}/{repo}')).toBe(false);
  });
  it('never allows a production connection to perform developer cleanup',async()=>{
    const w=await makeWorld({scratchAccount:true,mode:'production'});await prepare(w);arrange(w.gh,'ok');
    const result=parse(await def.handler({runId:RUN,repo:REPO,confirm:true},w.ctx));
    expect(result.status).toBe('refused');
    expect(w.gh.calls).toHaveLength(0);
  });
});
