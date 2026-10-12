import {describe,expect,it} from 'vitest';
import {isOwnedFixtureBranch,createOwnedFixtureBranch,commitOwnedFixtureFile} from '../../src/dev/fixtures.js';
import {makeWorld} from '../../test/helpers/write-contract.js';
import {octo} from '../../src/tools/github-write.js';

const id='run-test-101',owner='example-org',repo='scratch-fixture';
const run={runId:id,account:owner,connection:'client-1',owner,repo,scenarios:['failing-ci']};
const sha='b'.repeat(40);
describe('V-1 shared run-owned fixture operations',()=>{
  it('denies foreign/unsafe branch and file inputs before any GitHub request',async()=>{
    const w=await makeWorld({scratchAccount:true});
    const github={request:()=>{throw new Error('unexpected GitHub write');}};
    for(const name of ['main','rtc/another-run/branch','rtc/run-test-101/../main']){
      expect(isOwnedFixtureBranch(id,name)).toBe(false);
      await expect(createOwnedFixtureBranch(w.ctx,{github,run,stepId:'new-test-ref',name,sha})).rejects.toThrow();
    }
    for(const path of ['README.md','rtc/another-run/file.md',
      `rtc/${id}/../other.md`,`rtc/${id}/not-a-script.sh`]){
      await expect(commitOwnedFixtureFile(w.ctx,{github,run,stepId:'test-file',path,content:'safe'})).rejects.toThrow();
    }
    await expect(commitOwnedFixtureFile(w.ctx,{github,run,stepId:'test-file',
      path:`rtc/${id}/change.md`,content:'safe',branch:'main'})).rejects.toThrow();
    expect(w.gh.calls).toEqual([]);
    expect(await w.db.listDevRuns({account:owner,connection:'client-1'})).toEqual([]);
  });
  it('journals the exact branch SHA, file ID and the commit returned by GitHub',async()=>{
    const w=await makeWorld({scratchAccount:true});const github=await octo(w.ctx,owner);
    const branch=`rtc/${id}/review-1`,path=`rtc/${id}/review-1.md`;
    w.gh.when('POST /repos/{owner}/{repo}/git/refs').reply(201,
      {ref:`refs/heads/${branch}`,object:{sha}});
    w.gh.when('PUT /repos/{owner}/{repo}/contents/{path}').reply(201,
      {content:{path},commit:{sha:'c'.repeat(40)}});
    const created=await createOwnedFixtureBranch(w.ctx,{github,run,stepId:'branch-1',name:branch,sha});
    const saved=await commitOwnedFixtureFile(w.ctx,{github,run,stepId:'file-1',path,
      content:'RTC run fixture',branch});
    expect(created).toMatchObject({objectId:branch,createdSha:sha,replayed:false});
    expect(saved).toMatchObject({objectId:path,createdSha:'c'.repeat(40),replayed:false});
    expect((await w.db.listDevObjects({runId:id,account:owner,connection:'client-1'}))
      .map(x=>x.object_type).sort()).toEqual(['branch','fixture_file']);
    expect(w.gh.invalid).toEqual([]);
    const writes=w.gh.calls.filter(x=>['PUT','POST'].includes(x.method));
    expect(writes.map(x=>x.route)).toEqual([
      'POST /repos/{owner}/{repo}/git/refs','PUT /repos/{owner}/{repo}/contents/{path}'
    ]);
    expect(writes[1].body.branch).toBe(branch);
    const again=await createOwnedFixtureBranch(w.ctx,{github,run,stepId:'branch-1',name:branch,sha});
    expect(again.replayed).toBe(true);
    expect(w.gh.calls.filter(x=>x.method==='POST')).toHaveLength(1);
  });
  it('rejects GitHub response mismatches as uncertain, never retries',async()=>{
    const w=await makeWorld({scratchAccount:true});const github=await octo(w.ctx,owner);
    w.gh.when('POST /repos/{owner}/{repo}/git/refs').reply(201,{ref:'refs/heads/wrong',object:{sha}});
    const params={github,run,stepId:'branch-unsafe',name:`rtc/${id}/test-ref`,sha};
    await expect(createOwnedFixtureBranch(w.ctx,params)).rejects.toThrow(/exact test branch/);
    expect((await w.db.getDevIntent({runId:id,account:owner,connection:'client-1',stepId:'branch-unsafe'})).status).toBe('uncertain');
    await expect(createOwnedFixtureBranch(w.ctx,params)).rejects.toThrow(/already claimed or uncertain/);
    expect(w.gh.calls.filter(x=>x.method==='POST')).toHaveLength(1);
  });
});
