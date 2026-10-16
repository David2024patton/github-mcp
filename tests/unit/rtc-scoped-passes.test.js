// R-1 / R-2 / R-3: scoped service passes over the real RTC HTTPS handler, and the pinned Hub RTC 1 conformance runner against it.
import { afterEach, describe, expect, it } from 'vitest';
import { runConformance } from '../../test/upstream/rtc/src/run.js';
import { fixtureRegistry, passWorld, startRtc } from '../../test/helpers/rtc-fixture.js';
import { validateGrant, passRefusal } from '../../src/rtc/pass-scope.js';

const open = [];
afterEach(async () => { while (open.length) await open.pop().close(); });
const serve = async (world, registry, options) => { const s = await startRtc({ world, registry, ...options }); open.push(s); return s; };
const http = async (url, pass, path, body, method) => {
  const response = await fetch(url + path, { method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...(pass ? { authorization: `Bearer ${pass}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json(), retry: response.headers.get('retry-after') };
};

describe('validateGrant: what a pass may be', () => {
  const ok = (input) => validateGrant(input, 'example-org');
  it('defaults to a read-only preview pass at 120 requests a minute', () => {
    expect(ok({})).toMatchObject({ profile: 'read_only', mode: 'preview', allowWrites: false, allowAccessChanges: false, moneyLimitCents: 0, days: 1, ratePerMinute: 120, areas: null, repos: null });
  });
  it.each([
    [{ profile: 'read_only', allowWrites: true }, /read-only pass cannot/],
    [{ profile: 'everyday', allowAccessChanges: true }, /need writes/],
    [{ profile: 'everyday', moneyLimitCents: 100 }, /need writes/],
    [{ profile: 'everyday', mode: 'production' }, /production pass exists to make changes/],
    [{ profile: 'everyday', allowWrites: true, days: 31 }, /1 to 30 days/],
    [{ profile: 'everyday', allowWrites: true, ratePerMinute: 601 }, /1 to 600/],
    [{ profile: 'everyday', allowWrites: true, ratePerMinute: 0 }, /1 to 600/],
    [{ profile: 'everyday', allowWrites: true, repos: ['other-org/x'] }, /can only name repositories of example-org/],
    [{ profile: 'nonsense' }, /profile must be/]
  ])('refuses %j', (input, message) => { expect(() => ok(input)).toThrow(message); });
  it('allows a year only for a pass marked for Robinson\'s Toolkit, and nothing longer', () => {
    expect(ok({ profile: 'everyday', allowWrites: true, forHub: true, days: 365 })).toMatchObject({ days: 365, forHub: true });
    expect(() => ok({ profile: 'everyday', allowWrites: true, forHub: true, days: 366 })).toThrow();
  });
  it('normalises areas and repositories', () => {
    expect(ok({ profile: 'everyday', allowWrites: true, areas: ['pr', 'issue', 'pr'], repos: ['Example-Org/App', 'example-org/app'] })).toMatchObject({ areas: ['issue', 'pr'], repos: ['example-org/app'] });
  });
});

describe('passRefusal: every call a pass causes', () => {
  const pass = (extra) => Object.freeze({ pass: true, allow_writes: true, areas: null, repos: null, ...extra });
  const write = { name: 'github_pr_merge', area: 'pr', writes: true, inputSchema: { properties: { repo: {} } } };
  const read = { name: 'github_pr_get', area: 'pr', inputSchema: { properties: { repo: {} } } };
  it('is silent for connector logins', () => expect(passRefusal({ tool: write, args: {}, connection: { pass: undefined } })).toBeNull());
  it('refuses owner controls even with writes allowed', () => {
    expect(passRefusal({ tool: { name: 'github_set_spend_limit', area: 'server', writes: true }, args: {}, connection: pass() })).toMatch(/Owner controls/);
  });
  it('refuses writes without the writes permission', () => expect(passRefusal({ tool: write, args: { repo: 'a' }, connection: pass({ allow_writes: false }) })).toMatch(/read-only/));
  it('refuses areas outside the list', () => expect(passRefusal({ tool: read, args: { repo: 'a' }, connection: pass({ areas: ['issue'] }) })).toMatch(/does not include the pr area/));
  it('limits a repository pass to its repositories', () => {
    const connection = pass({ repos: ['example-org/app'], default_account: 'example-org' });
    expect(passRefusal({ tool: read, args: { repo: 'app' }, connection })).toBeNull();
    expect(passRefusal({ tool: read, args: { owner: 'example-org', repo: 'APP' }, connection })).toBeNull();
    expect(passRefusal({ tool: read, args: { repo: 'other' }, connection })).toMatch(/outside this pass/);
    expect(passRefusal({ tool: read, args: { owner: 'someone-else', repo: 'app' }, connection })).toMatch(/outside this pass/);
    expect(passRefusal({ tool: { name: 'github_org_list', area: 'org', inputSchema: { properties: {} } }, args: {}, connection })).toMatch(/not repository-specific/);
  });
});

describe('the HTTPS door with scoped passes', () => {
  it('a read-only pass reads, but every change is refused over HTTPS', async () => {
    const world = await passWorld(); const { registry, state } = fixtureRegistry();
    const { url } = await serve(world, registry);
    const readOnly = await world.issue({ profile: 'read_only', allowWrites: false });
    expect((await http(url, readOnly.pass, '/api/tools/github_fixture_read', {})).data).toMatchObject({ ok: true, result: { value: 'initial' } });
    const tools = await http(url, readOnly.pass, '/api/tools?limit=100&listing=catalog');
    expect(tools.data.result.tools.some((t) => t.writes)).toBe(false);
    const blocked = await http(url, readOnly.pass, '/api/tools/github_fixture_write', { value: 'x', confirm: true });
    expect(blocked.status).toBe(403);
    expect(blocked.data.error.code).toBe('refused_by_guard');
    expect(state.value).toBe('initial');
  });
  it('a pass that allows changes previews, applies, reads back and logs through the full write layer', async () => {
    const world = await passWorld(); const { registry, state } = fixtureRegistry();
    const { url } = await serve(world, registry);
    const { pass } = await world.issue({ profile: 'everyday', allowWrites: true });
    const dry = await http(url, pass, '/api/tools/github_fixture_write', { value: 'a', dryRun: true });
    expect(dry.data).toMatchObject({ ok: true, result: { done: false, status: 'preview' }, mode: 'preview' });
    expect(dry.data.result.logged.id).toEqual(expect.any(Number));
    expect(state.value).toBe('initial');
    const applied = await http(url, pass, '/api/tools/github_fixture_write', { value: 'a' });
    expect(applied.data.result).toMatchObject({ done: true, confirmed: true, status: 'applied', logged: { id: expect.any(Number) } });
    expect(state.value).toBe('a');
    const again = await http(url, pass, '/api/tools/github_fixture_write', { value: 'a' });
    expect(again.data.result).toMatchObject({ status: 'replayed' });
    const guarded = await http(url, pass, '/api/tools/github_fixture_guarded', { value: 'g' });
    expect(guarded.data.result).toMatchObject({ done: false, needsConfirmation: true });
    expect(state.guarded).toBe('initial');
  });
  it('a batch never runs a change', async () => {
    const world = await passWorld(); const { registry, state } = fixtureRegistry();
    const { url } = await serve(world, registry);
    const { pass } = await world.issue({});
    const batch = await http(url, pass, '/api/tools/_batch', { calls: [{ name: 'github_fixture_write', args: { value: 'b', confirm: true } }] });
    expect(batch.status).toBe(403);
    expect(state.value).toBe('initial');
  });
  it('refuses access-widening changes unless the pass was issued with that permission', async () => {
    const world = await passWorld(); const { registry } = fixtureRegistry();
    const { url } = await serve(world, registry);
    const plain = await world.issue({ allowAccessChanges: false });
    const refused = await http(url, plain.pass, '/api/tools/github_fixture_access', { value: 'x', confirm: true });
    expect(refused.status).toBe(403);
    expect(refused.data.error).toMatchObject({ code: 'refused_by_guard' });
    expect(refused.data.error.what).toMatch(/not allowed to change who has access/);
    const trusted = await world.issue({ allowAccessChanges: true });
    const needs = await http(url, trusted.pass, '/api/tools/github_fixture_access', { value: 'x' });
    expect(needs.data.result).toMatchObject({ needsConfirmation: true });
  });
  it('limits a repository pass to its repositories, in listing and in calls', async () => {
    const world = await passWorld(); const { registry, state } = fixtureRegistry();
    const { url } = await serve(world, registry);
    const { pass } = await world.issue({ profile: 'read_only', allowWrites: false, repos: ['example-org/app'] });
    const names = (await http(url, pass, '/api/tools?limit=100&listing=catalog')).data.result.tools.map((t) => t.name);
    expect(names).toContain('github_fixture_repo_read');
    expect(names).not.toContain('github_fixture_read');
    expect((await http(url, pass, '/api/tools/github_fixture_repo_read', { owner: 'example-org', repo: 'app' })).status).toBe(200);
    const other = await http(url, pass, '/api/tools/github_fixture_repo_read', { owner: 'example-org', repo: 'secret' });
    expect(other.status).toBe(403);
    expect(other.data.error.what).toMatch(/outside this pass/);
    expect(state.repoReads).toEqual(['example-org/app']);
    expect((await http(url, pass, '/api/tools/github_fixture_read', {})).status).toBe(403);
  });
  it('owner controls are not offered to a pass, and a connector login is not a pass', async () => {
    const world = await passWorld(); const { registry } = fixtureRegistry();
    const { url } = await serve(world, registry);
    const { pass } = await world.issue({ profile: 'full', allowWrites: true });
    const names = (await http(url, pass, '/api/tools?limit=100&listing=catalog')).data.result.tools.map((t) => t.name);
    for (const owner of ['github_set_spend_limit', 'github_enable_production', 'github_revoke_connection', 'github_create_pass', 'github_undo_change']) expect(names).not.toContain(owner);
    expect((await http(url, pass, '/api/tools/github_create_pass', { account: 'example-org', confirm: true })).status).toBe(403);
    expect((await http(url, 'access-client-1', '/api/whoami')).status).toBe(401);
    expect((await http(url, null, '/api/whoami')).status).toBe(401);
  });
  it('whoami says exactly what this pass may do', async () => {
    const world = await passWorld(); const { registry } = fixtureRegistry();
    const { url } = await serve(world, registry);
    const { pass } = await world.issue({ profile: 'everyday', allowWrites: true, areas: ['fixture'], repos: null });
    expect((await http(url, pass, '/api/whoami')).data.result).toMatchObject({ profile: 'everyday', mode: 'preview', areas: ['fixture'], allow_writes: true, allow_access_changes: false, production_access: false, money_limit_cents: 0 });
  });
  it('a production pass needs production switched on, now and on every call', async () => {
    const world = await passWorld(); const { registry } = fixtureRegistry();
    const { url } = await serve(world, registry);
    expect((await world.issue({ mode: 'production', profile: 'everyday', allowWrites: true })).id).toBeNull();
    await world.db.setProductionEnabled('example-org', true);
    const { pass, id } = await world.issue({ mode: 'production', profile: 'everyday', allowWrites: true });
    expect(id).toMatch(/^rtc-/);
    expect((await http(url, pass, '/api/whoami')).data.result).toMatchObject({ mode: 'production', production_access: true });
    await world.db.setProductionEnabled('example-org', false);
    expect((await http(url, pass, '/api/whoami')).status).toBe(403);
  });
  it('enforces the stored request limit with a Retry-After answer', async () => {
    const world = await passWorld(); const { registry } = fixtureRegistry();
    const { url } = await serve(world, registry);
    const { pass } = await world.issue({ ratePerMinute: 3 });
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await http(url, pass, '/api/whoami')).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect((await http(url, pass, '/api/whoami')).retry).toBe('60');
  });
  it('revoking and expiry stop a pass at once', async () => {
    const world = await passWorld(); const { registry } = fixtureRegistry();
    const { url } = await serve(world, registry);
    const { pass, passId } = await world.issue({});
    expect((await http(url, pass, '/api/whoami')).status).toBe(200);
    await world.db.revokeRtcPass(passId);
    const after = await http(url, pass, '/api/whoami');
    expect(after.status).toBe(401);
    expect(after.data.error.code).toBe('pass_revoked');
  });
});

describe('pinned Hub RTC 1 conformance runner against this server\'s real handler', () => {
  it('passes every probe it can run, shares the request limit across two instances, and reports its one known difference honestly', async () => {
    const world = await passWorld(); const { registry } = fixtureRegistry();
    const a = await serve(world, registry); const b = await serve(world, registry);
    const full = await world.issue({ profile: 'everyday', allowWrites: true });
    const readOnly = await world.issue({ profile: 'read_only', allowWrites: false });
    const revoked = await world.issue({}); await world.db.revokeRtcPass(revoked.passId);
    const expired = await world.issue({}); world.db.expireRtcPass(expired.passId);
    const limited = await world.issue({ ratePerMinute: 5 });
    await world.db.createOAuthClient({ clientId: 'hub-client', clientSecret: 'fixture-secret-hub', redirectUris: ['https://example.test/cb'], clientName: 'Hub' });
    await world.db.createAccessToken({ accessToken: 'access-hub', refreshToken: 'refresh-hub', clientId: 'hub-client', defaultAccount: 'example-org', accounts: ['example-org'], mode: 'preview', profile: 'everyday', listing: 'compact' });
    let current = 'access-hub'; let n = 0;
    const oauth = {
      inspect: async (token = current) => { const row = await world.db.getAccessToken(token); return { profile: row.profile, listing: row.listing, mode: row.mode, account: row.default_account }; },
      refresh: async () => { n += 1; const next = `access-hub-${n}`; await world.db.rotateRefreshToken({ refreshToken: n === 1 ? 'refresh-hub' : `refresh-hub-${n - 1}`, clientId: 'hub-client', accessToken: next, newRefreshToken: `refresh-hub-${n}` }); current = next; return next; }
    };
    const result = await runConformance({ url: a.url, passes: { full: full.pass, readOnly: readOnly.pass, expired: expired.pass, revoked: revoked.pass }, oauth, instances: { urls: [a.url, b.url], pass: limited.pass, limit: 5 } });
    const by = (name) => result.checks.find((c) => c.name === name);
    for (const name of ['manifest', 'manifest.openapi', 'catalog', 'meta', 'writes', 'passes', 'passes.read_only', 'passes.expired', 'passes.revoked', 'safety', 'budget', 'oauth.refresh_settings', 'limits.two_instance']) {
      expect(by(name), `${name}: ${by(name)?.message}`).toMatchObject({ ok: true });
    }
    // This server's hard 8 KB wire limit means a single >8 KB string can never be returned in full; recovery is by paging. The
    // pinned runner expects the full text, so this one probe stays an honest, recorded difference and the manifest stays rtc 0.
    expect(by('reads')).toMatchObject({ ok: false });
    expect(result.ok).toBe(false);
  });
  it('detects a nonconforming catalog on the real handler (fault injection)', async () => {
    const world = await passWorld();
    const bad = { tools: [{ name: 'unprefixed_read', description: 'Not prefixed.', area: 'fixture', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: {} } }], handlers: { unprefixed_read: async () => ({}) } };
    const { registry } = fixtureRegistry({ extra: [bad] });
    const { url } = await serve(world, registry);
    const full = await world.issue({ profile: 'everyday', allowWrites: true });
    const result = await runConformance({ url, passes: { full: full.pass } });
    expect(result.checks.find((c) => c.name === 'catalog')).toMatchObject({ ok: false });
    expect(result.checks.find((c) => c.name === 'catalog').message).toMatch(/must start with github_/);
  });
  it('the real manifest stays rtc 0 (not certified)', async () => {
    const world = await passWorld(); const { registry } = fixtureRegistry();
    const { url } = await serve(world, registry, { manifest: false });
    expect((await http(url, null, '/api/contract')).data.rtc).toBe(0);
  });
});
