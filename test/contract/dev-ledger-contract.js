// V-1 run ledger: identical expectations for fake and disposable PostgreSQL.
import { describe, expect, it } from 'vitest';
export function runDevLedgerContract(label, makeDb) {
  const a={account:'example-org',connection:'client-one'};
  describe(`V-1 run ledger: ${label}`,()=>{
    it('stores forwarders per account and connection, caps them at 20 and never lists the secret', async () => {
      const db = await makeDb();
      const f = (n, extra = {}) => ({ ...a, id: `fwd_${String(n).padStart(16, 'a')}`, url: 'https://app.example.net/hooks/github?x=1', events: ['push', 'pull_request'], secretEnc: 'v1.' + 'x'.repeat(40), ...extra });
      expect(await db.createDevForwarder(f(1, { runId: 'run-fwd-001', repo: 'scratch' }))).toBe(true);
      expect(await db.createDevForwarder(f(1))).toBe(false);
      expect(await db.getDevForwarder({ ...a, id: f(1).id })).toMatchObject({ url: 'https://app.example.net/hooks/github?x=1', events: ['push', 'pull_request'], secret_enc: expect.any(String), run_id: 'run-fwd-001', repo: 'scratch', last_used_at: null });
      expect(await db.getDevForwarder({ account: 'other-org', connection: a.connection, id: f(1).id })).toBeNull();
      expect(await db.getDevForwarder({ ...a, connection: 'client-two', id: f(1).id })).toBeNull();
      const listed = await db.listDevForwarders(a);
      expect(listed).toHaveLength(1);
      expect(JSON.stringify(listed)).not.toContain('secret_enc');
      expect(JSON.stringify(listed)).not.toContain('v1.');
      expect(await db.touchDevForwarder({ ...a, id: f(1).id })).toBe(true);
      expect((await db.getDevForwarder({ ...a, id: f(1).id })).last_used_at).not.toBeNull();
      expect(await db.touchDevForwarder({ ...a, connection: 'client-two', id: f(1).id })).toBe(false);
      for (let n = 2; n <= 20; n += 1) expect(await db.createDevForwarder(f(n))).toBe(true);
      expect(await db.createDevForwarder(f(21))).toBe(false);
      expect(await db.createDevForwarder(f(22, { connection: 'client-two' }))).toBe(true);
      expect(await db.deleteDevForwarder({ ...a, connection: 'client-two', id: f(1).id })).toBe(false);
      expect(await db.deleteDevForwarder({ ...a, id: f(1).id })).toBe(true);
      expect(await db.deleteDevForwarder({ ...a, id: f(1).id })).toBe(false);
      await expect(db.createDevForwarder(f(30, { url: 'x' }))).rejects.toThrow(/URL/);
      await expect(db.createDevForwarder(f(31, { events: ['bad event'] }))).rejects.toThrow(/events/);
      await expect(db.getDevForwarder({ ...a, id: 'nope' })).rejects.toThrow(/forwarder/i);
    });
    it('removes only the forwarders bound to one run, account and connection', async () => {
      const db = await makeDb(); const a = { account: 'example-org', connection: 'fwd-cleanup-one' };
      const f = (n, extra = {}) => ({ ...a, id: `fwd_${String(n).padStart(16, 'b')}`, url: 'https://app.example.net/hook', events: [], secretEnc: 'v1.' + 'y'.repeat(40), ...extra });
      await db.createDevForwarder(f(1, { runId: 'run-fwd-001' })); await db.createDevForwarder(f(2, { runId: 'run-fwd-001' }));
      await db.createDevForwarder(f(3, { runId: 'run-fwd-002' })); await db.createDevForwarder(f(4)); await db.createDevForwarder(f(5, { runId: 'run-fwd-001', connection: 'fwd-cleanup-two' }));
      expect(await db.deleteDevRunForwarders({ ...a, runId: 'run-fwd-001' })).toBe(2);
      expect((await db.listDevForwarders(a)).map((x) => x.id)).toEqual([f(3).id, f(4).id]);
      expect(await db.getDevForwarder({ ...a, connection: 'fwd-cleanup-two', id: f(5).id })).not.toBeNull();
      expect(await db.deleteDevRunForwarders({ ...a, runId: 'run-fwd-001' })).toBe(0);
    });
    it('permits one cleanup executor, isolates scopes and never expires or lets another executor release it',async()=>{
      const db=await makeDb(),runId='run-exclusive-cleanup';
      await db.createDevRun({...a,id:runId});
      const one='11111111-1111-4111-8111-111111111111';
      const two='22222222-2222-4222-8222-222222222222';
      const scope={...a,runId};
      const claimed=await Promise.all([one,two].map(executorId=>db.claimDevCleanupExecution({...scope,executorId})));
      expect(claimed.filter(Boolean)).toHaveLength(1);
      const winner=claimed[0]?one:two,loser=claimed[0]?two:one;
      expect(await db.getDevCleanupExecution(scope)).toMatchObject({acquired_at:expect.anything()});
      expect(await db.getDevCleanupExecution({...scope,connection:'foreign'})).toBeNull();
      expect(await db.releaseDevCleanupExecution({...scope,executorId:loser})).toBe(false);
      expect(await db.releaseDevCleanupExecution({...scope,connection:'foreign',executorId:winner})).toBe(false);
      expect(await db.claimDevCleanupExecution({...scope,executorId:winner})).toBe(false);
      expect(await db.releaseDevCleanupExecution({...scope,executorId:winner})).toBe(true);
      expect(await db.releaseDevCleanupExecution({...scope,executorId:winner})).toBe(false);
      expect(await db.getDevCleanupExecution(scope)).toBeNull();
      expect(await db.claimDevCleanupExecution({...scope,executorId:loser})).toBe(true);
      expect(await db.releaseDevCleanupExecution({...scope,executorId:loser})).toBe(true);
      await expect(db.claimDevCleanupExecution({...scope,executorId:'invalid'})).rejects.toThrow(/UUID/);
      expect(await db.claimDevCleanupExecution({...scope,runId:'run-missing',executorId:one})).toBe(false);
    });
    it('creates an account-scoped run once; duplicate ID cannot be claimed by someone else',async()=>{
      const db=await makeDb(),id='run-ledger-001';
      expect(await db.createDevRun({...a,id,scenarios:['repo-basic']})).toBe(true);
      expect(await db.createDevRun({...a,id,description:'overwrite'})).toBe(false);
      expect(await db.createDevRun({id,account:'other-org',connection:'other'})).toBe(false);
      expect(await db.getDevRun({...a,id})).toMatchObject({id,scenarios:['repo-basic'],status:'active'});
      expect(await db.getDevRun({id,account:'other-org',connection:'other'})).toBeNull();
    });
    it('atomically records the first-create label snapshot with its repo; never grants deletion authority',async()=>{
      const db=await makeDb(),runId='run-birth-001',sha='b'.repeat(40);
      await db.createDevRun({...a,id:runId,scenarios:['repo-basic']});
      const step={...a,runId,stepId:'seed-repo',type:'repo',owner:a.account,repo:'birth',objectName:'birth'};
      expect(await db.claimDevIntent(step)).toBe(true);
      const labels=[{id:11,name:'bug',color:'D73A4A',description:'Something broken'},
        {id:12,name:'question',color:'d876e3',description:null}];
      expect(await db.completeDevBirthIntent({...a,runId,stepId:'seed-repo',
        objectId:`${a.account}/birth`,createdSha:sha,labels})).toBe(true);
      expect(await db.getDevBirthLabels({...a,runId})).toMatchObject({
        owner:a.account,repo:'birth',source_sha:sha,labels:[
          {id:11,name:'bug',color:'d73a4a',description:'Something broken'},
          {id:12,name:'question',color:'d876e3',description:null}]});
      expect(await db.getDevBirthLabels({...a,runId,connection:'intruder'})).toBeNull();
      expect(await db.completeDevBirthIntent({...a,runId,stepId:'seed-repo',
        objectId:`${a.account}/birth`,createdSha:sha,labels:[]})).toBe(false);
      expect(await db.listDevObjects({...a,runId})).toHaveLength(1);
      expect(await db.getDevBirthLabels({...a,runId})).toMatchObject({labels:expect.arrayContaining([
        expect.objectContaining({id:11})])});
    });
    it('refuses duplicate, malformed, foreign or incomplete birth evidence',async()=>{
      const db=await makeDb(),runId='run-birth-002',sha='c'.repeat(40);
      await db.createDevRun({...a,id:runId});
      await db.claimDevIntent({...a,runId,stepId:'seed-repo',type:'repo',
        owner:a.account,repo:'birth',objectName:'birth'});
      const args={...a,runId,stepId:'seed-repo',objectId:`${a.account}/birth`,createdSha:sha};
      for(const labels of [[{id:1,name:'bug',color:'123456'},{id:1,name:'other',color:'123456'}],
        [{id:1,name:'bug',color:'garbage'}],[null]])
        await expect(db.completeDevBirthIntent({...args,labels})).rejects.toThrow();
      await expect(db.completeDevBirthIntent({...args,objectId:'other-org/birth',labels:[]})).rejects.toThrow();
      await expect(db.completeDevBirthIntent({...args,createdSha:'bad',labels:[]})).rejects.toThrow();
      expect(await db.completeDevBirthIntent({...args,connection:'another',labels:[]})).toBe(false);
      expect(await db.getDevBirthLabels({...a,runId})).toBeNull();
      expect(await db.completeDevBirthIntent({...args,labels:[]})).toBe(true);
      expect((await db.getDevBirthLabels({...a,runId})).labels).toEqual([]);
    });
    it('records exact objects atomically, scoped to the owning connection, without duplicate replays',async()=>{
      const db=await makeDb(),runId='run-ledger-002';
      expect(await db.createDevRun({...a,id:runId})).toBe(true);
      const obj={...a,runId,type:'branch',owner:'example-org',repo:'hello',objectId:'rtc/run-ledger-002/feature'};
      expect(await db.recordDevObject(obj)).toBe(true);
      expect(await db.recordDevObject(obj)).toBe(false);
      expect(await db.recordDevObject({...obj,connection:'attacker'})).toBe(false);
      expect(await db.recordDevObject({...obj,runId:'run-unknown'})).toBe(false);
      expect(await db.listDevObjects({...a,runId})).toMatchObject([{object_type:'branch',object_id:obj.objectId,cleaned:false}]);
      expect(await db.listDevObjects({...a,runId,connection:'attacker'})).toEqual([]);
    });
    it('claims a deterministic step once even across concurrent workers; scopes claims to the run owner',async()=>{
      const db=await makeDb(),runId='run-intent-101';
      expect(await db.createDevRun({...a,id:runId})).toBe(true);
      const intent={...a,runId,stepId:'step-1',type:'repo',owner:'example-org',repo:'seeded',objectName:'seeded'};
      const outcomes=await Promise.all([db.claimDevIntent(intent),db.claimDevIntent(intent)]);
      expect(outcomes.sort()).toEqual([false,true]);
      expect(await db.claimDevIntent({...intent,connection:'attacker'})).toBe(false);
      expect(await db.getDevIntent({...a,runId,stepId:'step-1'})).toMatchObject({status:'claimed',object_id:null});
      expect(await db.getDevIntent({...a,runId,stepId:'step-1',connection:'attacker'})).toBeNull();
      await expect(db.claimDevIntent({...intent,stepId:'BAD STEP'})).rejects.toThrow(/step ID/);
    });
    it('records the created object and finished intent together, refuses duplicate completion and foreign scope',async()=>{
      const db=await makeDb(),runId='run-intent-102';
      await db.createDevRun({...a,id:runId});
      const intent={...a,runId,stepId:'step-1',type:'branch',owner:'example-org',repo:'hello',objectName:'rtc/run-intent-102/feature'};
      expect(await db.claimDevIntent(intent)).toBe(true);
      expect(await db.completeDevIntent({...a,runId,stepId:'step-1',objectId:'hijack',connection:'attacker'})).toBe(false);
      const sha='a'.repeat(40);
      expect(await db.completeDevIntent({...a,runId,stepId:'step-1',objectId:intent.objectName,createdSha:sha})).toBe(true);
      expect(await db.completeDevIntent({...a,runId,stepId:'step-1',objectId:intent.objectName})).toBe(false);
      expect(await db.getDevIntent({...a,runId,stepId:'step-1'})).toMatchObject({status:'recorded',object_id:intent.objectName,created_sha:sha});
      expect(await db.listDevObjects({...a,runId})).toEqual(expect.arrayContaining([expect.objectContaining({object_type:'branch',object_id:intent.objectName,created_sha:sha})]));
    });
    it('cannot record two intents under one object identity, including concurrent completion',async()=>{
      const db=await makeDb(),runId='run-intent-collision';
      await db.createDevRun({...a,id:runId});
      const base={...a,runId,type:'branch',owner:a.account,repo:'hello',
        objectName:'rtc/run-intent-collision/shared'};
      await db.claimDevIntent({...base,stepId:'step-one'});
      await db.claimDevIntent({...base,stepId:'step-two'});
      const completed=await Promise.all(['step-one','step-two'].map(stepId=>
        db.completeDevIntent({...a,runId,stepId,objectId:base.objectName})));
      expect(completed.sort()).toEqual([false,true]);
      const intents=await db.listDevIntents({...a,runId});
      expect(intents.filter(x=>x.status==='recorded')).toHaveLength(1);
      expect(intents.filter(x=>x.status==='claimed')).toHaveLength(1);
      expect(await db.listDevObjects({...a,runId})).toHaveLength(1);
      expect(await db.beginDevCleanup({...a,runId})).toBe(false);
    });
    it('does not reinterpret a pre-recorded object as a successful step',async()=>{
      const db=await makeDb(),runId='run-intent-preexisting';
      await db.createDevRun({...a,id:runId});
      const step={...a,runId,type:'branch',owner:a.account,repo:'hello',stepId:'step-one',
        objectName:'rtc/run-intent-preexisting/shared'};
      await db.recordDevObject({...a,runId,type:step.type,owner:step.owner,repo:step.repo,
        objectId:step.objectName,createdSha:'a'.repeat(40)});
      await db.claimDevIntent(step);
      expect(await db.completeDevIntent({...a,runId,stepId:step.stepId,objectId:step.objectName,
        createdSha:'b'.repeat(40)})).toBe(false);
      expect(await db.getDevIntent({...a,runId,stepId:step.stepId})).toMatchObject({status:'claimed',object_id:null});
      expect((await db.listDevObjects({...a,runId}))[0].created_sha).toBe('a'.repeat(40));
    });
    it('uncertain network outcomes stay claimed and cannot replay until explicitly reconciled',async()=>{
      const db=await makeDb(),runId='run-intent-103';
      await db.createDevRun({...a,id:runId});
      const intent={...a,runId,stepId:'step-a',type:'repo',owner:'example-org',repo:'mystery',objectName:'mystery'};
      expect(await db.claimDevIntent(intent)).toBe(true);
      expect(await db.markDevIntentUncertain({...a,runId,stepId:'step-a'})).toBe(true);
      expect(await db.markDevIntentUncertain({...a,runId,stepId:'step-a'})).toBe(false);
      expect(await db.claimDevIntent(intent)).toBe(false);
      expect(await db.getDevIntent({...a,runId,stepId:'step-a'})).toMatchObject({status:'uncertain',object_id:null});
      expect(await db.completeDevIntent({...a,runId,stepId:'step-a',objectId:'mystery'})).toBe(true);
      expect(await db.listDevObjects({...a,runId})).toHaveLength(1);
    });
    it('returns the real run ID on scoped intent reads for safe evidence reports',async()=>{
      const db=await makeDb(),runId='run-list-identity';
      await db.createDevRun({...a,id:runId});
      await db.claimDevIntent({...a,runId,stepId:'one',type:'branch',owner:a.account,
        repo:'hello',objectName:'rtc/run-list-identity/a'});
      expect(await db.getDevIntent({...a,runId,stepId:'one'})).toMatchObject({run_id:runId});
      expect(await db.listDevIntents({...a,runId})).toMatchObject([{run_id:runId}]);
      expect(await db.listDevIntents({...a,runId,connection:'other'})).toEqual([]);
    });
    it('lists only this run\'s claimed steps with a strict limit',async()=>{
      const db=await makeDb(),runId='run-intent-list';
      await db.createDevRun({...a,id:runId});
      const step={...a,runId,type:'branch',owner:'example-org',repo:'hello',objectName:'rtc/run-intent-list/one'};
      await db.claimDevIntent({...step,stepId:'step-1'});
      await db.claimDevIntent({...step,stepId:'step-2'});
      const rows=await db.listDevIntents({...a,runId});
      expect(rows.map(x=>x.step_id)).toEqual(['step-1','step-2']);
      expect(rows.every(x=>x.status==='claimed')).toBe(true);
      expect(await db.listDevIntents({...a,runId,connection:'other'})).toEqual([]);
      expect(await db.listDevIntents({...a,runId,limit:1})).toHaveLength(1);
      await expect(db.listDevIntents({...a,runId,limit:100})).rejects.toThrow(/Limit/);
    });

    it('freezes pending writes, records exact cleanup identities and completes only after every object',async()=>{
      const db=await makeDb(),runId='run-clean-001';
      await db.createDevRun({...a,id:runId});
      const repo={...a,runId,type:'repo',owner:a.account,repo:'fixture',objectId:`${a.account}/fixture`};
      await db.recordDevObject(repo);
      const intent={...a,runId,stepId:'create-branch',type:'branch',owner:a.account,repo:'fixture',objectName:'rtc/run-clean-001/test'};
      await db.claimDevIntent(intent);
      expect(await db.beginDevCleanup({...a,runId})).toBe(false);
      await db.markDevIntentUncertain({...a,runId,stepId:intent.stepId});
      expect(await db.beginDevCleanup({...a,runId})).toBe(false);
      await db.completeDevIntent({...a,runId,stepId:intent.stepId,objectId:intent.objectName});
      expect(await db.beginDevCleanup({...a,runId,connection:'foreign'})).toBe(false);
      expect(await db.beginDevCleanup({...a,runId})).toBe(true);
      expect(await db.claimDevIntent({...intent,stepId:'too-late'})).toBe(false);
      expect(await db.completeDevCleanup({...a,runId})).toBe(false);
      expect(await db.markDevObjectCleaned({...repo,connection:'foreign'})).toBe(false);
      expect(await db.markDevObjectCleaned({...repo,objectId:'similar'})).toBe(false);
      expect(await db.markDevObjectCleaned(repo)).toBe(true);
      expect(await db.markDevObjectCleaned(repo)).toBe(false);
      expect(await db.completeDevCleanup({...a,runId})).toBe(false);
      expect(await db.markDevObjectCleaned({...a,runId,type:'branch',owner:a.account,objectId:intent.objectName})).toBe(true);
      expect(await db.completeDevCleanup({...a,runId})).toBe(true);
      expect(await db.getDevRun({...a,id:runId})).toMatchObject({status:'cleaned',cleaned_at:expect.anything()});
      expect(await db.beginDevCleanup({...a,runId})).toBe(false);
    });
    it('keyset-pages scoped runs without skipping identical timestamps',async()=>{
      const db=await makeDb();
      const ids=['run-page-aaa','run-page-bbb','run-page-ccc'];
      for(const id of ids)await db.createDevRun({...a,id});
      const all=await db.listDevRuns({...a,limit:50});
      expect(all.filter(x=>ids.includes(x.id))).toHaveLength(3);
      const paged=[];
      let after=null;
      for(let i=0;i<50;i++){
        const rows=await db.listDevRuns({...a,limit:1,after});
        if(!rows.length)break;
        paged.push(rows[0].id);
        after={createdAt:new Date(rows[0].created_at).toISOString(),id:rows[0].id};
      }
      expect(paged).toEqual((await db.listDevRuns({...a,limit:50})).map(x=>x.id));
    });
    it('lists only this connection and rejects unbounded requests',async()=>{
      const db=await makeDb();
      expect(await db.createDevRun({...a,id:'run-ledger-003'})).toBe(true);
      expect(await db.createDevRun({id:'run-ledger-004',account:'other-org',connection:'client-two'})).toBe(true);
      expect(await db.countDevRuns(a)).toBeGreaterThanOrEqual(1);
      expect(await db.countDevRuns({...a,connection:'foreign'})).toBe(0);
      const mine=await db.listDevRuns({...a,limit:50});
      expect(mine.some(x=>x.id==='run-ledger-003')).toBe(true);
      expect(mine.every(x=>x.account===a.account&&x.connection===a.connection)).toBe(true);
      await expect(db.listDevRuns({...a,limit:500})).rejects.toThrow(/Limit/);
      await expect(db.recordDevObject({...a,runId:'run-ledger-003',type:'branch',owner:a.account,objectId:'x',createdSha:'bad'})).rejects.toThrow(/Invalid/);
    });
  });
}
