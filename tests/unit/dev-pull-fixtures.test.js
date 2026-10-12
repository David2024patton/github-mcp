import {describe,expect,it} from 'vitest';
import {makeWorld} from '../../test/helpers/write-contract.js';
import {octo} from '../../src/tools/github-write.js';
import {createOwnedFixtureBranch,commitOwnedFixtureFile} from '../../src/dev/fixtures.js';
import {createOwnedDraftPr,createOwnedRunLabel,labelOwnedDraftPr} from '../../src/dev/pull-fixtures.js';

const id='run-draft-101',owner='example-org',repo='draft-fixture';
const run={runId:id,account:owner,connection:'client-1',owner,repo,scenarios:['stack-of-three']};
const baseSha='a'.repeat(40),headSha='b'.repeat(40),branch=`rtc/${id}/stack-1`;
async function prepared(){
  const w=await makeWorld({scratchAccount:true}),github=await octo(w.ctx,owner);
  w.gh.when('POST /repos/{owner}/{repo}/git/refs').reply(201,{ref:`refs/heads/${branch}`,object:{sha:baseSha}});
  w.gh.when('PUT /repos/{owner}/{repo}/contents/{path}').reply(201,
    {content:{path:`rtc/${id}/stack-1.md`},commit:{sha:headSha}});
  await createOwnedFixtureBranch(w.ctx,{github,run,stepId:'branch-1',name:branch,sha:baseSha});
  await commitOwnedFixtureFile(w.ctx,{github,run,stepId:'file-1',
    path:`rtc/${id}/stack-1.md`,content:'draft fixture',branch});
  return {w,github};
}
const prArgs={run,stepId:'pr-1',head:branch,base:'main',defaultBranch:'main',
  expectedHeadSha:headSha,title:'RTC draft 1'};
const fixture={number:42,draft:true,state:'open',head:{ref:branch},base:{ref:'main'},
  body:`Run-owned draft review fixture.\n\n<!-- rtc_run=${id} -->`};
describe('V-1 durable run-owned draft pull requests',()=>{
  it('creates a real draft from the exact owned commit and journals PR/label assignments',async()=>{
    const {w,github}=await prepared();
    w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200,
      {ref:`refs/heads/${branch}`,object:{sha:headSha}});
    w.gh.when('POST /repos/{owner}/{repo}/pulls').reply(201,fixture);
    w.gh.when('POST /repos/{owner}/{repo}/labels').reply(201,{name:'rtc-run',description:`rtc_run=${id}`});
    w.gh.when('POST /repos/{owner}/{repo}/issues/{issue_number}/labels').reply(200,[{name:'rtc-run'}]);
    const pr=await createOwnedDraftPr(w.ctx,{github,...prArgs});
    const label=await createOwnedRunLabel(w.ctx,{github,run});
    const assigned=await labelOwnedDraftPr(w.ctx,{github,run,stepId:'label-1',prNumber:Number(pr.objectId)});
    expect([pr.objectId,label.objectId,assigned.objectId]).toEqual(['42','rtc-run','42:rtc-run']);
    const objects=await w.db.listDevObjects({runId:id,account:owner,connection:'client-1'});
    expect(objects.map(x=>x.object_type).sort()).toEqual(['branch','fixture_file','label','pr','pr_label']);
    expect(w.gh.calls.find(x=>x.route==='POST /repos/{owner}/{repo}/pulls').body)
      .toMatchObject({head:branch,base:'main',draft:true});
    expect(w.gh.invalid).toEqual([]);
    const again=await createOwnedDraftPr(w.ctx,{github,...prArgs});
    expect(again.replayed).toBe(true);
    expect(w.gh.calls.filter(x=>x.route==='POST /repos/{owner}/{repo}/pulls')).toHaveLength(1);
  });
  it('rejects foreign head, unrecorded SHA, arbitrary production base and changed Git head',async()=>{
    const {w,github}=await prepared();
    for(const wrong of [
      {...prArgs,head:'main'}, {...prArgs,expectedHeadSha:'c'.repeat(40)},
      {...prArgs,base:'production',defaultBranch:'main'}
    ])await expect(createOwnedDraftPr(w.ctx,{github,...wrong})).rejects.toThrow();
    w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200,
      {ref:`refs/heads/${branch}`,object:{sha:'c'.repeat(40)}});
    await expect(createOwnedDraftPr(w.ctx,{github,...prArgs})).rejects.toThrow(/changed/);
    expect(w.gh.calls.filter(x=>x.route==='POST /repos/{owner}/{repo}/pulls')).toHaveLength(0);
  });
  it('marks a GitHub response mismatch uncertain and never reopens on retry',async()=>{
    const {w,github}=await prepared();
    w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200,
      {ref:`refs/heads/${branch}`,object:{sha:headSha}});
    w.gh.when('POST /repos/{owner}/{repo}/pulls').reply(201,{...fixture,draft:false});
    await expect(createOwnedDraftPr(w.ctx,{github,...prArgs})).rejects.toThrow(/exact run-owned draft/);
    await expect(createOwnedDraftPr(w.ctx,{github,...prArgs})).rejects.toThrow(/already claimed or uncertain/);
    expect((await w.db.getDevIntent({runId:id,account:owner,connection:'client-1',stepId:'pr-1'})).status)
      .toBe('uncertain');
    expect(w.gh.calls.filter(x=>x.route==='POST /repos/{owner}/{repo}/pulls')).toHaveLength(1);
  });
});
