import {describe,expect,it} from 'vitest';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';
import {verifySeedResumeOrigin} from '../../src/dev/scratch-origin.js';
import * as seed from '../../src/tools/dev-seed-write.js';

const ID='run-resume-101',OWNER='example-org',REPO='resume-demo';
const ORIGINAL='a'.repeat(40),WORKFLOW='b'.repeat(40);
const file=`.github/workflows/rtc-${ID}.yml`;
const existing={full_name:`${OWNER}/${REPO}`,private:true,default_branch:'main',
  description:`Developer fixture rtc_run=${ID} (repo-basic)`};
const root={status:'recorded',object_type:'repo',object_name:REPO,
  object_id:`${OWNER}/${REPO}`,owner:OWNER,repo:REPO,created_sha:ORIGINAL};
const wf={status:'recorded',object_type:'workflow_file',object_name:file,
  object_id:file,owner:OWNER,repo:REPO,created_sha:WORKFLOW};
function stub(sha=ORIGINAL) {
  const calls=[];
  return {calls,github:{request:async(route,params)=>{
    calls.push({route,params});
    return {data:{ref:'refs/heads/main',object:{sha}}};
  }}};
}
describe('verified origin before resuming previously created scratch seed',()=>{
  it('requires exact origin before allowing another seed write',async()=>{
    const {github,calls}=stub();
    await expect(verifySeedResumeOrigin(github,{owner:OWNER,repo:REPO,runId:ID,
      existing,repoIntent:root})).resolves.toMatchObject({
      initial_sha:ORIGINAL,expected_default_sha:ORIGINAL,verified:true});
    expect(calls).toHaveLength(1);
    expect(calls[0].route).toBe('GET /repos/{owner}/{repo}/git/ref/{ref}');
  });
  it('permits only a proven recorded workflow advancement of default',async()=>{
    const {github}=stub(WORKFLOW);
    await expect(verifySeedResumeOrigin(github,{owner:OWNER,repo:REPO,runId:ID,
      existing,repoIntent:root,workflowIntent:wf})).resolves.toMatchObject({
      expected_default_sha:WORKFLOW,verified:true});
  });
  it('refuses changed, missing, uncertain or forged commit authority',async()=>{
    for(const entry of [
      {repoIntent:{...root,created_sha:null}},
      {repoIntent:{...root,object_id:'other/repository'}},
      {repoIntent:root,workflowIntent:{...wf,status:'uncertain'}},
      {repoIntent:root,workflowIntent:{...wf,object_name:'foreign.yml'}},
      {repoIntent:root,existing:{...existing,private:false}}
    ]){
      const {github,calls}=stub();
      await expect(verifySeedResumeOrigin(github,{
        owner:OWNER,repo:REPO,runId:ID,existing,repoIntent:root,...entry
      })).rejects.toThrow();
      expect(calls).toHaveLength(0);
    }
    await expect(verifySeedResumeOrigin(stub(WORKFLOW).github,{
      owner:OWNER,repo:REPO,runId:ID,existing,repoIntent:root
    })).rejects.toThrow(/moved/i);
  });
  it('blocks the actual seed write door when an existing default commit has changed',async()=>{
    const w=await makeWorld({scratchAccount:true});
    await w.db.createDevRun({id:ID,account:OWNER,connection:'client-1',scenarios:['repo-basic']});
    const claim={runId:ID,account:OWNER,connection:'client-1',stepId:'seed-repo',
      type:'repo',owner:OWNER,repo:REPO,objectName:REPO};
    expect(await w.db.claimDevIntent(claim)).toBe(true);
    expect(await w.db.completeDevIntent({...claim,objectId:`${OWNER}/${REPO}`,
      createdSha:ORIGINAL})).toBe(true);
    w.gh.when('GET /repos/{owner}/{repo}').reply(200,existing);
    w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200,{
      ref:'refs/heads/main',object:{sha:WORKFLOW}});
    const response=parse(await seed.handlers.github_dev_seed({
      repo:REPO,runId:ID,scenario:'repo-basic',confirm:true
    },w.ctx));
    expect(response.done).toBe(false);
    expect(w.gh.calls.filter(x=>['POST','PUT','PATCH','DELETE'].includes(x.method))).toEqual([]);
    expect(w.gh.invalid).toEqual([]);
    expect(await w.db.getDevIntent({...claim,stepId:'seed-workflow'})).toBeNull();
  });
});
