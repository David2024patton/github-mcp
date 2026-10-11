// Contract for the connections list, revoking, the default account, "last used", and the recent-changes read (B-8).
// Run against the in-memory fake and real PostgreSQL.
import { describe, expect, it } from 'vitest';

const REDIRECT = 'https://example.test/cb';
const SCOPE = { defaultAccount: 'example-org', accounts: ['example-org', 'example-user'], mode: 'preview', profile: 'everyday', listing: 'compact' };
const base = { account: 'example-org', repo: 'example-org/hello', mode: 'preview', connection: 'client-1', tool: 'github_sample_write', target: 'example-org/hello#1', summary: 'Do a thing' };

async function login(db, clientId, name, accessToken, extra = {}) {
  await db.createOAuthClient({ clientId, clientSecret: `fixture-secret-${clientId}`, redirectUris: [REDIRECT], clientName: name });
  await db.createAccessToken({ accessToken, refreshToken: `refresh-${accessToken}`, clientId, ...SCOPE, ...extra });
}

export function runConnectionsContract(name, make) {
  describe(`connections: ${name}`, () => {
    it('lists live connector logins with their names and settings, and never a token or hash', async () => {
      const db = await make();
      await login(db, 'client-1', 'Claude', 'access-one');
      await login(db, 'client-2', 'Codex', 'access-two', { mode: 'production', profile: 'full' });
      const list = await db.listConnections();
      expect(list.map((c) => c.client_id).sort()).toEqual(['client-1', 'client-2']);
      const two = list.find((c) => c.client_id === 'client-2');
      expect(two).toMatchObject({ client_name: 'Codex', default_account: 'example-org', accounts: ['example-org', 'example-user'], mode: 'production', profile: 'full', listing: 'compact' });
      const text = JSON.stringify(list);
      for (const secret of ['access-one', 'access-two', 'refresh-', 'fixture-secret', 'token_hash']) expect(text).not.toContain(secret);
    });

    it('leaves out expired and revoked logins, and revoking switches off every token of one login only', async () => {
      const db = await make();
      await login(db, 'client-1', 'Claude', 'access-one');
      await login(db, 'client-2', 'Codex', 'access-two');
      await db.createAccessToken({ accessToken: 'access-old', refreshToken: 'refresh-old', clientId: 'client-2', ttlSeconds: -10, ...SCOPE });
      expect((await db.listConnections()).length).toBe(2);
      expect(await db.revokeConnection('client-1')).toBe(1);
      expect(await db.getAccessToken('access-one')).toBeNull();
      expect(await db.getAccessToken('access-two')).not.toBeNull();
      expect((await db.listConnections()).map((c) => c.client_id)).toEqual(['client-2']);
      expect(await db.revokeConnection('client-1')).toBe(0);
      expect(await db.revokeConnection('nobody')).toBe(0);
    });

    it('changes the default account only to one the login already has, and only for that login', async () => {
      const db = await make();
      await login(db, 'client-1', 'Claude', 'access-one');
      await login(db, 'client-2', 'Codex', 'access-two');
      expect(await db.setConnectionDefaultAccount('client-1', 'example-user')).toBe(1);
      expect((await db.getAccessToken('access-one')).default_account).toBe('example-user');
      expect((await db.getAccessToken('access-two')).default_account).toBe('example-org');
      expect(await db.setConnectionDefaultAccount('client-1', 'someone-else')).toBe(0);
      expect((await db.getAccessToken('access-one')).default_account).toBe('example-user');
      expect(await db.setConnectionDefaultAccount('nobody', 'example-org')).toBe(0);
    });

    it('notes when a connection was last used', async () => {
      const db = await make();
      await login(db, 'client-1', 'Claude', 'access-one');
      expect((await db.listConnections())[0].last_used_at).toBeNull();
      await db.getAccessToken('access-one');
      expect((await db.listConnections())[0].last_used_at).not.toBeNull();
    });
  });

  describe(`recent changes: ${name}`, () => {
    it('lists newest first, hides previews unless asked, and filters by repo, tool, account and time', async () => {
      const db = await make();
      await db.recordChange({ ...base, summary: 'first', dryRun: false });
      await db.recordChange({ ...base, summary: 'second', repo: 'example-org/other', tool: 'github_other_write', dryRun: false });
      await db.recordChange({ ...base, summary: 'third', account: 'example-user', repo: 'example-user/mine', dryRun: false, accessWidening: true });
      await db.recordChange({ ...base, summary: 'preview only', dryRun: true });
      const all = await db.listChanges();
      expect(all.map((c) => c.summary)).toEqual(['third', 'second', 'first']);
      expect(all[0].accessWidening).toBe(true);
      expect(all[1].accessWidening).toBe(false);
      expect((await db.listChanges({ includePreviews: true })).map((c) => c.summary)).toEqual(['preview only', 'third', 'second', 'first']);
      expect((await db.listChanges({ repo: 'Example-Org/Other' })).map((c) => c.summary)).toEqual(['second']);
      expect((await db.listChanges({ tool: 'github_other_write' })).map((c) => c.summary)).toEqual(['second']);
      expect((await db.listChanges({ account: 'EXAMPLE-USER' })).map((c) => c.summary)).toEqual(['third']);
      expect((await db.listChanges({ limit: 1 })).map((c) => c.summary)).toEqual(['third']);
      expect((await db.listChanges({ limit: 0 })).length).toBe(1);
      expect((await db.listChanges({ since: new Date(Date.now() + 3600_000).toISOString() })).length).toBe(0);
      expect((await db.listChanges({ since: new Date(Date.now() - 3600_000).toISOString() })).length).toBe(3);
    });
  });
}
