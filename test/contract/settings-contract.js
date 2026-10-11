// Contract for owner settings, the production switch and "pending owner confirmation" states (B-2). Run against the in-memory
// fake and real PostgreSQL.
import { describe, expect, it } from 'vitest';

const state = (c) => c.repeat(43);

export function runSettingsContract(name, make) {
  describe(`owner settings and production switch: ${name}`, () => {
    it('stores a JSON setting, replaces it, and answers null for an unknown one', async () => {
      const db = await make();
      expect(await db.getSetting('production_names')).toBeNull();
      await db.setSetting('production_names', { environments: ['production'], branches: [] });
      expect(await db.getSetting('production_names')).toEqual({ environments: ['production'], branches: [] });
      await db.setSetting('production_names', { environments: ['live'], branches: ['release/*'] });
      expect(await db.getSetting('production_names')).toEqual({ environments: ['live'], branches: ['release/*'] });
      await expect(db.setSetting('Bad Key', 1)).rejects.toThrow(TypeError);
      await expect(db.setSetting('', 1)).rejects.toThrow(TypeError);
    });

    it('turns production on and off for a known account only', async () => {
      const db = await make();
      await db.upsertAccount({ login: 'example-org', accountId: 1, accountType: 'Organization', label: 'Example', credentialKind: 'app' });
      expect((await db.getAccount('example-org')).production_enabled).toBe(false);
      expect(await db.setProductionEnabled('Example-Org', true)).toBe(true);
      expect((await db.getAccount('example-org')).production_enabled).toBe(true);
      expect((await db.listAccounts())[0].production_enabled).toBe(true);
      expect(await db.setProductionEnabled('example-org', false)).toBe(true);
      expect((await db.getAccount('example-org')).production_enabled).toBe(false);
      expect(await db.setProductionEnabled('nobody', true)).toBe(false);
    });

    it('keeps a pending owner confirmation per account, single use, case-insensitive, and purpose-bound', async () => {
      const db = await make();
      await db.createSetupState({ state: state('a'), purpose: 'enable_production', accountHint: 'Example-Org', ttlSeconds: 600 });
      await db.createSetupState({ state: state('b'), purpose: 'manifest', accountHint: 'example-org' });
      expect(await db.hasPendingSetupState('enable_production', 'example-org')).toBe(true);
      expect(await db.hasPendingSetupState('enable_production', 'other')).toBe(false);
      expect(await db.consumeSetupStateByHint('user_auth', 'example-org')).toBeNull();
      expect(await db.consumeSetupStateByHint('enable_production', 'other')).toBeNull();
      expect(await db.consumeSetupStateByHint('enable_production', '')).toBeNull();
      expect(await db.consumeSetupStateByHint('enable_production', 'example-org')).toEqual({ account_hint: 'Example-Org' });
      expect(await db.consumeSetupStateByHint('enable_production', 'example-org')).toBeNull();
      expect(await db.hasPendingSetupState('enable_production', 'example-org')).toBe(false);
      expect(await db.consumeSetupState(state('b'), 'manifest')).toMatchObject({ account_hint: 'example-org' });
    });

    it('does not offer an expired confirmation', async () => {
      const db = await make();
      await db.createSetupState({ state: state('c'), purpose: 'enable_production', accountHint: 'example-org', ttlSeconds: -5 });
      expect(await db.hasPendingSetupState('enable_production', 'example-org')).toBe(false);
      expect(await db.consumeSetupStateByHint('enable_production', 'example-org')).toBeNull();
    });
  });
}

export function runProtectedContract(name, make) {
  describe(`protected resources list: ${name}`, () => {
    const entry = { kind: 'repo', target: 'Example-Org/Server', level: 'pr-only', reason: 'the server itself' };
    it('saves, lists sorted, changes in place, and removes entries (targets are stored lowercase)', async () => {
      const db = await make();
      expect(await db.listProtectedResources()).toEqual([]);
      await db.saveProtectedResource(entry);
      await db.saveProtectedResource({ kind: 'installation', target: '*', level: 'locked', reason: 'own Apps' });
      await db.saveProtectedResource({ ...entry, level: 'locked', reason: 'now fully locked' });
      const list = await db.listProtectedResources();
      expect(list.map((e) => `${e.kind}:${e.target}:${e.level}`)).toEqual(['installation:*:locked', 'repo:example-org/server:locked']);
      expect(list[1].reason).toBe('now fully locked');
      expect(await db.removeProtectedResource('repo', 'EXAMPLE-ORG/server')).toBe(true);
      expect(await db.removeProtectedResource('repo', 'example-org/server')).toBe(false);
      expect((await db.listProtectedResources()).map((e) => e.target)).toEqual(['*']);
    });
    it('refuses malformed entries with a plain sentence', async () => {
      const db = await make();
      for (const bad of [{ ...entry, kind: 'org' }, { ...entry, level: 'open' }, { ...entry, target: 'no-slash' }, { ...entry, target: 'a/b/c' }, { ...entry, reason: '' },
        { kind: 'installation', target: 'abc', level: 'locked', reason: 'why' }]) {
        await expect(db.saveProtectedResource(bad)).rejects.toThrow(TypeError);
      }
      expect(await db.listProtectedResources()).toEqual([]);
    });
    it('seeds once ever: a removed seed entry is not put back, and existing entries are not overwritten', async () => {
      const db = await make();
      await db.saveProtectedResource({ ...entry, level: 'locked', reason: 'owner choice' });
      expect(await db.seedProtectedResources([entry, { kind: 'repo', target: 'example-org/other', level: 'pr-only', reason: 'seed' }])).toBe(true);
      expect((await db.listProtectedResources()).map((e) => `${e.target}:${e.level}`)).toEqual(['example-org/other:pr-only', 'example-org/server:locked']);
      await db.removeProtectedResource('repo', 'example-org/other');
      expect(await db.seedProtectedResources([{ kind: 'repo', target: 'example-org/other', level: 'pr-only', reason: 'seed' }])).toBe(false);
      expect((await db.listProtectedResources()).map((e) => e.target)).toEqual(['example-org/server']);
    });
  });
}
