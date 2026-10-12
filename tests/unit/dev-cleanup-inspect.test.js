import {describe,it,expect} from 'vitest';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {mergeNamespaces} from '../../src/core/registry.js';
import * as mod from '../../src/tools/dev-cleanup-inspect.js';
import * as runs from '../../src/tools/dev-runs-read.js';

const OWNER='example-org',REPO='fixture',RUN='run-inspect-204';
const data={full_name:`${OWNER}/${REPO}`,private:true,
  description:`Developer fixture for rtc_run=${RUN}`,default_branch:'main'};
const EMPTY={total_count:0};
async function world({birth=false}={}){
  const w=await makeWorld({scratchAccount:true});
  await w.db.createDevRun({id:RUN,account:OWNER,connection:'client-1',scenarios:['repo-basic']});
  const scope={runId:RUN,account:OWNER,connection:'client-1'};
  if(birth){
    await w.db.claimDevIntent({...scope,stepId:'seed-repo',
      type:'repo',owner:OWNER,repo:REPO,objectName:REPO});
    await w.db.completeDevBirthIntent({...scope,stepId:'seed-repo',
      objectId:`${OWNER}/${REPO}`,createdSha:'a'.repeat(40),
      labels:[{id:11,name:'bug',color:'d73a4a',description:null}]});
  }else await w.db.recordDevObject({...scope,type:'repo',owner:OWNER,
    repo:REPO,objectId:`${OWNER}/${REPO}`,createdSha:'a'.repeat(40)});
  w.gh.when('GET /repos/{owner}/{repo}').reply(200,data);
  for(const route of ['branches','pulls','issues','tags','releases','rulesets','hooks','milestones',
    'deployments','labels','issues/comments','pulls/comments'])
    w.gh.when(`GET /repos/{owner}/{repo}/${route}`).reply(200,route==='branches'
      ? [{name:'main',commit:{sha:'a'.repeat(40)}}]:[]);
  w.gh.when('GET /repos/{owner}/{repo}/environments').reply(200,{...EMPTY,environments:[]});
  w.gh.when('GET /repos/{owner}/{repo}/actions/runs').reply(200,{...EMPTY,workflow_runs:[]});
  w.gh.when('GET /repos/{owner}/{repo}/actions/artifacts').reply(200,{...EMPTY,artifacts:[]});
  w.gh.when('GET /repos/{owner}/{repo}/actions/workflows').reply(200,{...EMPTY,workflows:[]});
  return w;
}
const handler=mod.inspectCleanupPreview;
const args={repo:REPO,runId:RUN};
describe('V-2 exact remote read-only cleanup preflight',()=>{
  it('reports an unresolved executor without remote writes, takeover or hidden executor identity',async()=>{
    const w=await world();
    await w.db.claimDevCleanupExecution({runId:RUN,account:OWNER,connection:'client-1',
      executorId:'11111111-1111-4111-8111-111111111111'});
    const out=await handler(args,w.ctx);
    expect(out).toMatchObject({status:'blocked',blocker_code:'CLEANUP_EXECUTION_UNRESOLVED',
      deletion_authorized:false,destructive_operations_performed:false});
    expect(w.gh.calls).toHaveLength(0);
    expect(JSON.stringify(out)).not.toContain('11111111-1111');
  });
  it('inspects all supported remote inventories without any GitHub writes or run freeze',async()=>{
    const w=await world();
    const out=await handler(args,w.ctx);
    expect(out).toMatchObject({status:'remote_snapshot_accepted',
      deletion_authorized:false,destructive_operations_performed:false,
      inventory_counts:{branches:1,labels:0},snapshot_atomic:false});
    expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
    expect(w.gh.invalid).toEqual([]);
    expect(await w.db.getDevRun({id:RUN,account:OWNER,connection:'client-1'}))
      .toMatchObject({status:'active'});
  });
  it('pinpoints observed default labels as an unresolved ownership blocker',async()=>{
    const w=await world();
    w.gh.when('GET /repos/{owner}/{repo}/labels')
      .reply(200,[{id:7,name:'bug',color:'d73a4a'}]);
    const out=await handler(args,w.ctx);
    expect(out).toMatchObject({status:'blocked',
      blocker_code:'LABEL_PROVENANCE_UNVERIFIED',phase:'scratch_remote_inventory',
      deletion_authorized:false});
    expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
  });
  it('does not convert failed/incomplete GitHub inventories to safe deletion',async()=>{
    for(const {status,body,headers} of [
      {status:403,body:{message:'Forbidden'}},
      {status:200,body:[{name:'main'}],headers:{link:'<https://api.github.com/repos/example-org/fixture/branches?page=2>; rel="next"'}}
    ]){
      const w=await world();
      w.gh.when('GET /repos/{owner}/{repo}/branches').reply(status,body,headers);
      const out=await handler(args,w.ctx);
      expect(out.status).not.toBe('remote_snapshot_accepted');
      expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
    }
  });
  it('refuses cross-connection and production access before remote reads',async()=>{
    const w=await world();
    await expect(handler({owner:'other-org',...args},w.ctx)).rejects.toThrow();
    await expect(handler(args,{...w.ctx,connection:{...w.connection,mode:'production'}}))
      .rejects.toThrow(/preview-only/);
    expect(w.gh.calls).toEqual([]);
  });
  it('compares exact first-observed label IDs while deletion remains refused',async()=>{
    const w=await world({birth:true});
    w.gh.when('GET /repos/{owner}/{repo}/labels').reply(200,[
      {id:11,name:'bug',color:'d73a4a',description:null},
      {id:15,name:'foreign',color:'ff0000',description:'new'}]);
    w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200,
      {ref:'refs/heads/main',object:{sha:'a'.repeat(40)}});
    const out=await handler({...args,includeBirthLabels:true},w.ctx);
    expect(out).toMatchObject({status:'blocked',blocker_code:'LABEL_PROVENANCE_UNVERIFIED',
      birth_label_drift:{state:'compared',journal_binding_verified:true,
        default_branch_commit_unchanged:true,exact_observation_unchanged:false,
        creator_provenance_verified:false,deletion_authorized:false}});
    expect(out.birth_label_drift.added_after_observation.map(x=>x.id)).toEqual([15]);
    expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
    expect((await w.db.getDevRun({id:RUN,account:OWNER,connection:'client-1'})).status).toBe('active');
  });
  it('makes no creator claim when the first-create observation is absent',async()=>{
    const w=await world();
    const out=await handler({...args,includeBirthLabels:true},w.ctx);
    expect(out.birth_label_drift).toMatchObject({journal_binding_verified:false,
      creator_provenance_verified:false,deletion_authorized:false});
    expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
  });
  it('remains read-only through the MCP dispatcher',async()=>{
    const w=await world();
    const registry=mergeNamespaces([runs]);
    const d=createDispatch({credentials:w.credentials,fetch:w.gh.fetch,now:w.ctx.now});
    const out=parse(await d({registry,name:'github_dev_list_runs',args:{...args,remoteCleanupPreview:true},
      connection:w.connection,db:w.db}));
    expect(out).toMatchObject({status:'remote_snapshot_accepted',deletion_authorized:false});
    expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
  });
});
