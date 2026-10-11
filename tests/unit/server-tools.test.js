import { describe, expect, it } from 'vitest';
import { tools, handlers } from '../../src/tools/server.js';
import { GITHUB_API_VERSION } from '../../src/github/client.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';

// Fake values only. The ciphertext columns hold obvious markers so a leak is easy to spot.
const MARKERS = ['CIPHERTEXT-USER-TOKEN', 'CIPHERTEXT-REFRESH', 'CIPHERTEXT-FINE', 'CIPHERTEXT-CLASSIC'];
const SHAPES = [/ghp_[A-Za-z0-9]{6,}/, /ghs_[A-Za-z0-9]{6,}/, /github_pat_[A-Za-z0-9_]{6,}/, /BEGIN [A-Z ]*PRIVATE KEY/, /CIPHERTEXT-/];
const T0 = Date.UTC(2026, 9, 10, 18, 0, 0);

async function setup() {
  const db = createFakeDb({ clock: () => T0 });
  await db.initSchema();
  await db.upsertAccount({ login: 'example-org', accountId: 1, accountType: 'Organization', label: 'Example Org', appId: 42 });
  await db.upsertAccount({ login: 'example-user', accountId: 2, accountType: 'User', label: 'Example User', credentialKind: 'fine_grained' });
  await db.upsertAccount({ login: 'hidden-org', accountId: 3, accountType: 'Organization', label: 'Hidden' });
  await db.setInstallation('example-org', { installationId: 9, repositorySelection: 'all', permissions: { contents: 'write' }, status: 'active' });
  await db.setUserAuthorization('example-org', { userLogin: 'chris-example', tokenEnc: MARKERS[0], tokenExpiresAt: new Date(T0 + 1e6), refreshEnc: MARKERS[1], refreshExpiresAt: new Date(T0 + 1e9) });
  await db.setFineGrainedToken('example-user', { enc: MARKERS[2], last4: 'wxyz' });
  await db.setClassicToken('example-org', { enc: MARKERS[3], scopes: ['notifications'], last4: 'abcd' });
  await db.recordRateState({ account: 'example-org', resource: 'core', remaining: 4321, resetAt: new Date(T0 + 1800e3) });
  const connection = Object.freeze({ default_account: 'example-org', accounts: ['example-org', 'example-user'], mode: 'preview', profile: 'everyday', listing: 'catalog' });
  return { db, connection };
}
const run = async (name, args, ctx) => handlers[name](args, ctx);
const text = (value) => JSON.stringify(value);
const noSecrets = (value) => { for (const shape of SHAPES) expect(text(value)).not.toMatch(shape); };

describe('server tools', () => {
  it('are named github_*, read-only in shape, with short descriptions and a schema that rejects extra input', () => {
    for (const t of tools) {
      expect(t.name).toMatch(/^github_[a-z_]+$/);
      expect(t.description.length).toBeLessThanOrEqual(160);
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(typeof handlers[t.name]).toBe('function');
    }
  });

  it('github_list_accounts shows only the connection\'s accounts and never any ciphertext', async () => {
    const ctx = await setup();
    for (const detail of ['brief', 'full']) {
      const out = await run('github_list_accounts', { detail }, ctx);
      expect(out.count).toBe(2);
      expect(out.accounts.map((a) => a.login)).toEqual(['example-org', 'example-user']);
      noSecrets(out);
      expect(text(out)).not.toContain('hidden-org');
    }
    const brief = (await run('github_list_accounts', {}, ctx)).accounts[0];
    expect(brief).toMatchObject({ login: 'example-org', default: true, installation_status: 'active', production_enabled: false, credentials: ['app_installation', 'user_authorization', 'classic_notifications_token'] });
    const full = (await run('github_list_accounts', { detail: 'full' }, ctx)).accounts;
    expect(full[0].credentials).toEqual([
      { type: 'app_installation', repository_selection: 'all' }, { type: 'user_authorization', user: 'chris-example' },
      { type: 'classic_notifications_token', scopes: ['notifications'], last4: 'abcd' }
    ]);
    expect(full[1].credentials).toEqual([{ type: 'fine_grained_token', last4: 'wxyz' }]);
  });

  it('fields narrows the result and unknown fields are dropped', async () => {
    const ctx = await setup();
    const out = await run('github_list_accounts', { fields: ['login', 'nonsense', 'installation_status'] }, ctx);
    expect(out.accounts[0]).toEqual({ login: 'example-org', installation_status: 'active' });
  });

  it('refuses a bad detail or fields value with a plain message', async () => {
    const ctx = await setup();
    await expect(run('github_list_accounts', { detail: 'everything' }, ctx)).rejects.toThrow(/detail/);
    await expect(run('github_whoami', { fields: 'login' }, ctx)).rejects.toThrow(/fields/);
  });

  it('github_whoami reports the connection, API version, rate budget and spend limit in dollars', async () => {
    const ctx = await setup();
    const out = await run('github_whoami', {}, ctx);
    expect(out).toMatchObject({ mode: 'preview', profile: 'everyday', listing: 'catalog', default_account: 'example-org', github_api_version: GITHUB_API_VERSION });
    expect(out.accounts.map((a) => a.login)).toEqual(['example-org', 'example-user']);
    const [org, user] = out.accounts;
    expect(org.rate).toMatchObject({ resource: 'core', remaining: 4321, blocked_until: null });
    expect(org.rate.resets_at_display).toMatch(/MDT|MST/);
    expect(user.rate.remaining).toBeNull();
    expect(org).toMatchObject({ spend_limit_cents: 0, spend_limit_display: '$0.00' });
    expect(out.unknown_accounts).toBeUndefined();
    noSecrets(out);
  });

  it('github_whoami shows a block with its reset time and names connection accounts the server does not hold', async () => {
    const { db } = await setup();
    await db.recordRateState({ account: 'example-org', resource: 'core', remaining: 0, resetAt: new Date(T0 + 600e3), blockedUntil: new Date(T0 + 600e3) });
    const connection = { default_account: 'example-org', accounts: ['example-org', 'gone-org'], mode: 'production', profile: 'read_only', listing: 'compact' };
    const out = await run('github_whoami', { detail: 'full', fields: ['login', 'rate', 'spend_limit_display'] }, { db, connection });
    expect(out.unknown_accounts).toEqual(['gone-org']);
    expect(out.accounts[0].rate.blocked_until_display).toMatch(/MDT|MST/);
    expect(Object.keys(out.accounts[0]).sort()).toEqual(['login', 'rate', 'spend_limit_display']);
    noSecrets(out);
  });

  it('stays under 8 KB and holds nothing token- or key-shaped or ciphertext-like in full detail', async () => {
    const { db, connection } = await setup();
    await db.setAccountPlan('example-org', 'team');
    for (const name of ['github_whoami', 'github_list_accounts']) {
      const out = await run(name, { detail: 'full' }, { db, connection });
      noSecrets(out);
      expect(text(out).length).toBeLessThan(8 * 1024);
    }
  });
});
