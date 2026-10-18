import { describe, expect, it } from 'vitest';
import { handlers, tools, compareArea } from '../../src/tools/server-diagnostics.js';
import { AREAS, LEVELS } from '../../src/data/permission-needs.js';
import { SETTINGS, findSettings, fill } from '../../src/data/dashboard-map.js';
import { MANIFEST_PERMISSIONS } from '../../src/github/app-manifest.js';
import { parseCatalog } from '../../scripts/check-writes.mjs';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import fs from 'node:fs';

const CATALOG = parseCatalog(fs.readFileSync(new URL('../../docs/TOOL-CATALOG.md', import.meta.url), 'utf8'));
const SECRET = [/gh[pousr]_[A-Za-z0-9]{8,}/, /github_pat_[A-Za-z0-9_]{8,}/];
const call = async (name, w, args) => {
  const r = await handlers[name](args, w.ctx);
  return r?.content ? parse(r) : r;
};

async function appWorld(permissions, extra = {}) {
  const w = await makeWorld({ profile: 'read_only', accounts: ['example-org', 'example-user'], ...extra });
  await w.db.upsertAccount({ login: 'example-org', accountId: 1001, accountType: 'Organization', label: 'Example', credentialKind: 'app', appId: 5150 });
  await w.db.setInstallation('example-org', { installationId: 777, repositorySelection: 'all', permissions, status: 'active' });
  return w;
}

describe('permission needs data', () => {
  it('names only permissions the App manifest asks for, at levels the manifest grants', () => {
    const ids = new Set();
    for (const area of AREAS) {
      expect(ids.has(area.id), area.id).toBe(false);
      ids.add(area.id);
      for (const [permission, need] of Object.entries(area.needs)) {
        expect(MANIFEST_PERMISSIONS[permission], `${area.id}: ${permission}`).toBeDefined();
        expect(LEVELS[need], `${area.id}: ${permission}`).toBeLessThanOrEqual(LEVELS[MANIFEST_PERMISSIONS[permission]]);
      }
    }
  });
  it('compares levels (write covers read, none covers nothing)', () => {
    const area = { needs: { contents: 'write', metadata: 'read' } };
    expect(compareArea(area, { contents: 'write', metadata: 'write' })).toEqual([]);
    expect(compareArea(area, { contents: 'read' })).toEqual([{ permission: 'contents', needed: 'write', granted: 'read' }, { permission: 'metadata', needed: 'read', granted: 'none' }]);
  });
});

describe('github_check_permissions', () => {
  it('separates complete App grants from the unverified package credential capability', async () => {
    const w = await appWorld({ ...MANIFEST_PERMISSIONS });
    const out = await call('github_check_permissions', w, { account: 'example-org' });
    expect(out.accounts[0]).toMatchObject({ login: 'example-org', status: 'capability unverified', areas_missing: 0, areas_unverified: 1, areas_ok: AREAS.length - 1 });
    expect(out.checked_areas).toBe(AREAS.length);
  });
  it('names the exact permission to add and where to add it', async () => {
    const w = await appWorld({ metadata: 'read', contents: 'write', issues: 'read' });
    const out = await call('github_check_permissions', w, { account: 'example-org' });
    const acct = out.accounts[0];
    expect(acct.status).toBe('permissions missing');
    expect(acct.add_these).toContain('pull_requests: write (now none)');
    expect(acct.add_these).toContain('issues: write (now read)');
    expect(acct.add_these.join()).not.toContain('contents');
    expect(acct.how).toContain('https://github.com/organizations/example-org/settings/installations/777');
    expect(acct.areas.find((a) => a.area === 'pull-requests').missing).toEqual([{ permission: 'pull_requests', needed: 'write', granted: 'none' }]);
    const one = await call('github_check_permissions', w, { account: 'example-org', area: 'content' });
    expect(one).toMatchObject({ checked_areas: 1 });
    expect(one.accounts[0].status).toBe('all good');
    const full = await call('github_check_permissions', w, { account: 'example-org', area: 'issues', detail: 'full' });
    expect(full.accounts[0].areas[0]).toMatchObject({ area: 'issues', ok: false });
  });
  it('names the packages, runner and merge-queue gaps for an installation created before Y-1, and never calls a missing permission ok', async () => {
    const { packages, organization_self_hosted_runners, merge_queues, ...older } = MANIFEST_PERMISSIONS; // eslint-disable-line no-unused-vars
    const w = await appWorld(older);
    const out = await call('github_check_permissions', w, { account: 'example-org' });
    const acct = out.accounts[0];
    expect(acct.status).toBe('permissions missing');
    expect(acct.add_these).toEqual(expect.arrayContaining(['organization_self_hosted_runners: write (now none)', 'merge_queues: write (now none)']));
    expect(acct.areas.map((a) => a.area)).toEqual(expect.arrayContaining(['packages', 'runners', 'merge-queue']));
    expect((await call('github_check_permissions', w, { account: 'example-org', area: 'packages' })).accounts[0].status).toBe('capability unverified');
  });
  it.each(['brief', 'full'])('accepts package grants but keeps runtime capability unverified without requesting impossible consent (%s)', async (detail) => {
    const w = await appWorld({ packages: 'write' });
    const out = await call('github_check_permissions', w, { account: 'example-org', area: 'packages', detail });
    expect(out).toMatchObject({ checked_areas: 1, accounts: [{
      login: 'example-org', status: 'capability unverified', areas_ok: 0, areas_missing: 0, areas_unverified: 1,
      areas: [{ area: 'packages', capability: 'unverified', missing: [], note: expect.stringContaining('classic package token') }]
    }] });
    if (detail === 'full') expect(out.accounts[0].areas[0]).toMatchObject({ permissions_ok: true, ok: false });
    expect(out.accounts[0]).not.toHaveProperty('add_these');
    expect(out.accounts[0]).not.toHaveProperty('how');
  });
  it.each([{}, { packages: 'read' }, { organization_packages: 'write' }])(
    'still refuses to mark an unavailable or insufficient packages grant as ready: %j', async (permissions) => {
      // Include metadata so absent packages is a known permission map rather than an unrecorded installation.
      const w = await appWorld({ metadata: 'read', ...permissions });
      const acct = (await call('github_check_permissions', w, { account: 'example-org', area: 'packages' })).accounts[0];
      expect(acct.status).toBe('capability unverified');
      expect(acct).not.toHaveProperty('add_these');
      expect(acct.areas[0].missing).toEqual([]);
      expect(acct.areas[0].note).toContain('classic package token');
    });
  it('explains fine-grained, not-installed, and unknown cases instead of guessing', async () => {
    const w = await appWorld({});
    const all = await call('github_check_permissions', w, {});
    const byLogin = Object.fromEntries(all.accounts.map((a) => [a.login, a]));
    expect(byLogin['example-user'].status).toBe('fine-grained token');
    expect(byLogin['example-org'].status).toBe('unknown');
    await w.db.setInstallationStatus('example-org', 'suspended');
    expect((await call('github_check_permissions', w, { account: 'example-org' })).accounts[0].status).toBe('not installed');
  });
  it('rejects an unknown area and an account outside the connection', async () => {
    const w = await appWorld({ ...MANIFEST_PERMISSIONS });
    await expect(call('github_check_permissions', w, { area: 'nope' })).rejects.toThrow(/Unknown area/);
    await expect(call('github_check_permissions', w, { account: 'other-org' })).rejects.toThrow(/not one of the GitHub accounts/);
  });
});

describe('github_rate_status', () => {
  const live = { resources: { core: { limit: 5000, used: 12, remaining: 4988, reset: 1_790_000_000 }, graphql: { limit: 5000, used: 0, remaining: 5000, reset: 1_790_000_000 }, search: { limit: 30, used: 1, remaining: 29, reset: 1_790_000_000 }, scim: { limit: 1, used: 0, remaining: 1, reset: 1_790_000_000 } } };
  it('shows what the server last saw, a block in force, and the live numbers', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    await w.db.recordRateState({ account: 'example-org', resource: 'core', remaining: 0, resetAt: new Date(Date.now() + 600_000), blockedUntil: new Date(Date.now() + 600_000) });
    w.gh.when('GET /rate_limit').reply(200, live);
    const out = await call('github_rate_status', w, { account: 'example-org' });
    const acct = out.accounts[0];
    expect(acct.last_seen.core.remaining).toBe(0);
    expect(acct.blocked[0]).toMatch(/^core until /);
    expect(acct.live.core).toMatchObject({ limit: 5000, remaining: 4988 });
    expect(acct.live).not.toHaveProperty('scim');
    const full = await call('github_rate_status', w, { account: 'example-org', detail: 'full' });
    expect(full.accounts[0].live).toHaveProperty('scim');
  });
  it('can skip the live call, and reports (does not throw) when GitHub cannot be asked', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    expect((await call('github_rate_status', w, { live: false })).accounts[0]).not.toHaveProperty('live');
    w.gh.when('GET /rate_limit').reply(500, { message: 'boom' });
    const out = await call('github_rate_status', w, {});
    expect(out.accounts[0].live_unavailable).toContain('could not be asked');
    expect(JSON.stringify(out)).not.toMatch(SECRET[0]);
  });
  it('reports a missing credential plainly and refuses an outside account', async () => {
    const w = await makeWorld({ profile: 'read_only', accounts: ['example-org', 'bare-org'] });
    await w.db.upsertAccount({ login: 'bare-org', accountId: 9, accountType: 'Organization', label: 'Bare', credentialKind: 'app' });
    const out = await call('github_rate_status', w, { account: 'bare-org' });
    expect(out.accounts[0].live_unavailable).toContain('No GitHub credential');
    await expect(call('github_rate_status', w, { account: 'elsewhere' })).rejects.toThrow(/not one of the GitHub accounts/);
  });
});

describe('github_where_is_setting', () => {
  it('finds a setting by plain words and fills in the organization', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    const out = await call('github_where_is_setting', w, { query: 'how do I require two-factor?' });
    const s = out.settings[0];
    expect(s.setting).toContain('two-factor');
    expect(s.url).toBe('https://github.com/organizations/example-org/settings/security');
    expect(s.steps[0]).toMatchObject({ n: 1 });
    expect(s.verifyWith).toMatchObject({ tool: 'github_admin_check_setting', args: { owner: 'example-org', settingId: 'org-require-2fa', expectedBoolean: true }, field: 'verified', equals: true });
    const named = await call('github_where_is_setting', w, { query: '2fa', org: 'example-org' });
    expect(named.settings[0].url).toContain('/organizations/example-org/');
  });
  it('says when there is a read-back and when there is none', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    const pw = (await call('github_where_is_setting', w, { query: 'change my password' })).settings[0];
    expect(pw.verifyWith).toBeNull();
    expect(pw.check).toContain('tell me when it is done');
    expect(pw.url).toBe('https://github.com/settings/security');
  });
  it('uses the selected enrolled personal identity for user-profile links and no other org', async()=>{
    const w=await makeWorld({profile:'read_only',accounts:['example-org','alternate-account']});
    const row=await w.db.getAccount('alternate-account');
    await w.db.setUserAuthorization('alternate-account',{
      userLogin:'another-owner',tokenEnc:row.user_token_enc,
      tokenExpiresAt:row.user_token_expires_at,refreshEnc:row.user_refresh_enc,
      refreshExpiresAt:row.user_refresh_expires_at});
    const first=await call('github_where_is_setting',w,{query:'pinned repositories'});
    expect(first.settings.find(s=>s.scope==='user').url).toBe('https://github.com/example-owner');
    const chosen=await call('github_where_is_setting',w,{query:'pinned repositories',org:'alternate-account'});
    expect(chosen.settings.find(s=>s.scope==='user').url).toBe('https://github.com/another-owner');
    expect(JSON.stringify(chosen.settings)).not.toContain('https://github.com/alternate-account');
    expect(w.gh.calls).toHaveLength(0);
  });
  it('withholds profile links instead of using the organization when personal U is absent',async()=>{
    const w=await makeWorld({profile:'read_only'});
    await w.db.clearUserAuthorization('example-org');
    const out=await call('github_where_is_setting',w,{query:'pinned repositories'});
    expect(out.settings.find(s=>s.scope==='user')).toMatchObject({
      url:null,identity:'not_verified',reason:expect.stringContaining('not be inferred')
    });
    const org=await call('github_where_is_setting',w,{query:'require two-factor'});
    expect(org.settings.find(s=>s.scope==='org').url).toContain('organizations/example-org/');
    expect(w.gh.calls).toHaveLength(0);
  });
  it('admits when nothing matches and refuses an empty query or an outside organization', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    const none = await call('github_where_is_setting', w, { query: 'zzzz qqqq' });
    expect(none.found).toBe(0);
    expect(none.try_words.length).toBeGreaterThan(0);
    await expect(call('github_where_is_setting', w, { query: '  ' })).rejects.toThrow(/Say which setting/);
    await expect(call('github_where_is_setting', w, { query: '2fa', org: 'elsewhere' })).rejects.toThrow(/not one of the GitHub accounts/);
  });
});

describe('the dashboard map', () => {
  it('has unique ids, https links, numbered-able steps, an expected result, and only real catalog tools for read-backs', () => {
    const ids = new Set();
    for (const s of SETTINGS) {
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(s.url, s.id).toMatch(/^https:\/\/github\.com\//);
      expect(s.steps.length, s.id).toBeGreaterThan(0);
      for (const step of s.steps) expect(step.action && step.target, s.id).toBeTruthy();
      expect(s.expected, s.id).toBeTruthy();
      expect(['org', 'user', 'repo']).toContain(s.scope);
      if (s.verifyWith) expect(CATALOG.has(s.verifyWith.tool), `${s.id}: ${s.verifyWith.tool}`).toBe(true);
    }
  });
  it('covers each thing the catalog says GitHub has no API for', () => {
    const covered = ['two-factor', 'saml', 'plan', 'marketplace', 'password', 'oauth', 'token policy', 'copilot', 'notification email', 'security log', 'sponsors', 'delete', 'transfer', 'reminders', 'interaction'];
    for (const word of covered) expect(findSettings(word).length, word).toBeGreaterThan(0);
  });
  it('fills only the placeholders it knows and leaves the rest', () => {
    expect(fill({ a: ['{org}/x', '{user}'], b: 1 }, { org: 'o', user: null })).toEqual({ a: ['o/x', '{user}'], b: 1 });
  });
});

describe('the tool descriptions', () => {
  it('are short, read-only, and present in the catalog', () => {
    for (const t of tools) {
      expect(t.description.length, t.name).toBeLessThanOrEqual(160);
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(CATALOG.has(t.name), t.name).toBe(true);
    }
  });
});
