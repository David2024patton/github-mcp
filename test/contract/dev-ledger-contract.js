// V-1 run ledger: identical expectations for fake and disposable PostgreSQL.
import { describe, expect, it } from 'vitest';
export function runDevLedgerContract(label, makeDb) {
  const a={account:'example-org',connection:'client-one'};
  describe(`V-1 run ledger: ${label}`,()=>{
    it('creates an account-scoped run once; duplicate ID cannot be claimed by someone else',async()=>{
      const db=await makeDb(),id='run-ledger-001';
      expect(await db.createDevRun({...a,id,scenarios:['repo-basic']})).toBe(true);
      expect(await db.createDevRun({...a,id,description:'overwrite'})).toBe(false);
      expect(await db.createDevRun({id,account:'other-org',connection:'other'})).toBe(false);
      expect(await db.getDevRun({...a,id})).toMatchObject({id,scenarios:['repo-basic'],status:'active'});
      expect(await db.getDevRun({id,account:'other-org',connection:'other'})).toBeNull();
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
    it('lists only this connection and rejects unbounded requests',async()=>{
      const db=await makeDb();
      expect(await db.createDevRun({...a,id:'run-ledger-003'})).toBe(true);
      expect(await db.createDevRun({id:'run-ledger-004',account:'other-org',connection:'client-two'})).toBe(true);
      const mine=await db.listDevRuns({...a,limit:50});
      expect(mine.some(x=>x.id==='run-ledger-003')).toBe(true);
      expect(mine.every(x=>x.account===a.account&&x.connection===a.connection)).toBe(true);
      await expect(db.listDevRuns({...a,limit:500})).rejects.toThrow(/Limit/);
      await expect(db.recordDevObject({...a,runId:'run-ledger-003',type:'branch',owner:a.account,objectId:'x',createdSha:'bad'})).rejects.toThrow(/Invalid/);
    });
  });
}
