import {describe,it,expect} from 'vitest';
export function runScratchAccountContract(title, getDb) {
  describe(title+' IN-06 scratch database gate',()=>{
    it('rejects absent installation, disallowed selection and production-enabled app',async()=>{
      const db=await getDb();
      await db.upsertAccount({login:'scratch-org',accountId:900,accountType:'Organization',
        label:'Test',credentialKind:'app',appId:5150});
      expect(await db.setScratchAccount('scratch-org',true)).toBe(false);
      await db.setInstallation('scratch-org',{installationId:777,repositorySelection:'selected',
        status:'active',permissions:{}});
      expect(await db.setScratchAccount('scratch-org',true)).toBe(false);
      await db.setInstallation('scratch-org',{installationId:777,repositorySelection:'all',
        status:'active',permissions:{}});
      await db.setProductionEnabled('scratch-org',true);
      expect(await db.setScratchAccount('scratch-org',true)).toBe(false);
      expect((await db.getAccount('scratch-org')).is_scratch).toBe(false);
      await db.setProductionEnabled('scratch-org',false);
      expect(await db.setScratchAccount('scratch-org',true)).toBe(true);
      expect((await db.getAccount('scratch-org')).is_scratch).toBe(true);
      await db.setInstallationStatus('scratch-org','suspended');
      expect(await db.setScratchAccount('scratch-org',true)).toBe(false);
      expect(await db.setScratchAccount('scratch-org',false)).toBe(true);
      expect((await db.getAccount('scratch-org')).is_scratch).toBe(false);
    });
    it('rejects personal and non-App credentials regardless of claimed installation',async()=>{
      const db=await getDb();
      await db.upsertAccount({login:'personal',accountId:901,accountType:'User',
        label:'Personal',credentialKind:'app',appId:5150});
      await db.setInstallation('personal',{installationId:777,repositorySelection:'all',
        status:'active',permissions:{}});
      expect(await db.setScratchAccount('personal',true)).toBe(false);
      await db.upsertAccount({login:'token-org',accountId:902,accountType:'Organization',
        label:'Token',credentialKind:'fine_grained'});
      await db.setInstallation('token-org',{installationId:778,repositorySelection:'all',
        status:'active',permissions:{}});
      expect(await db.setScratchAccount('token-org',true)).toBe(false);
      await expect(db.setScratchAccount('token-org','true')).rejects.toThrow(/boolean/);
    });
  });
}
