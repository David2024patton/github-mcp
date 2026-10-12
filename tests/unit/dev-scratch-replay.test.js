import {describe,expect,it} from 'vitest';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';
import * as tool from '../../src/tools/dev-scratch-write.js';

const OWNER='example-org',REPO='scratch-replay',ID='run-replay-101';
const SHA='c'.repeat(40);
const repo=(more={})=>({full_name:`${OWNER}/${REPO}`,private:true,default_branch:'main',
  description:`Scratch fixture rtc_run=${ID}`,...more});
const args={name:REPO,runId:ID,confirm:true};
const step={runId:ID,account:OWNER,connection:'client-1',
  stepId:'create-scratch-repo',type:'repo',owner:OWNER,repo:REPO,objectName:REPO};
async function world({recorded=true,scenario='repo-basic',liveSha=SHA,
  changedRepo={},status='active'}={}){
  const w=await makeWorld({scratchAccount:true});
  await w.db.createDevRun({id:ID,account:OWNER,connection:'client-1',
    scenarios:[scenario]});
  expect(await w.db.claimDevIntent(step)).toBe(true);
  if(recorded)expect(await w.db.completeDevIntent({
    ...step,objectId:`${OWNER}/${REPO}`,createdSha:SHA})).toBe(true);
  w.gh.when('GET /repos/{owner}/{repo}').reply(200,repo(changedRepo));
  w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200,{
    ref:'refs/heads/main',object:{sha:liveSha}
  });
  if(status==='cleaning')expect(await w.db.beginDevCleanup({
    runId:ID,account:OWNER,connection:'client-1'})).toBe(true);
  return w;
}
const invoke=w=>tool.handlers.github_dev_create_scratch_repo(args,w.ctx);
const writes=w=>w.gh.calls.filter(x=>['POST','PUT','PATCH','DELETE'].includes(x.method));

describe('V-1 verified duplicate scratch create and interruption recovery',()=>{
  it('returns the exact durable same-run repository without a second create',async()=>{
    const w=await world();
    const result=parse(await invoke(w));
    expect(result).toMatchObject({done:true,status:'applied',confirmed:true,
      result:expect.objectContaining({replayed:true,full_name:`${OWNER}/${REPO}`})});
    expect(w.gh.calls.filter(x=>x.route==='GET /repos/{owner}/{repo}/git/ref/{ref}')).toHaveLength(2);
    expect(writes(w)).toHaveLength(0);
    expect(w.gh.invalid).toEqual([]);
  });
  it('serializes duplicate confirmed requests without another remote create',async()=>{
    const w=await world();
    const results=(await Promise.all([invoke(w),invoke(w)])).map(parse);
    expect(results.every(x=>x.done!==false||x.status==='replayed')).toBe(true);
    expect(writes(w)).toHaveLength(0);
  });
  for(const variant of [
    {name:'remote default moved',setup:{liveSha:'d'.repeat(40)}},
    {name:'repo changed to public',setup:{changedRepo:{private:false}}},
    {name:'foreign run marker',setup:{changedRepo:{description:'rtc_run=other-run'}}},
    {name:'outstanding uncertain step',setup:{recorded:false}},
    {name:'wrong scenario',setup:{scenario:'failing-ci'}},
    {name:'cleanup already started',setup:{status:'cleaning'}}
  ]){
    it(`refuses ${variant.name} without creating or mutating a repository`,async()=>{
      const w=await world(variant.setup);
      const result=parse(await invoke(w));
      expect(result.done).toBe(false);
      expect(writes(w)).toEqual([]);
      expect(w.gh.invalid).toEqual([]);
    });
  }
});
