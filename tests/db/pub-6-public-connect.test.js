import crypto, { createHash } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { createTenantDirectory, tenantSchemaName } from '../../src/tenancy/directory.js';
import { createPublicConnect, FORGET_CLIENT, PublicConnectError } from '../../src/tenancy/public-connect.js';
import { parsePublicCode } from '../../src/tenancy/public-code.js';
import { privateTenantToken } from '../../src/tenancy/oauth-token.js';
import { resolvePrivateTenantMcpBearer } from '../../src/tenancy/mcp-route.js';
import { publicAuthorize, publicCallback, publicForget, publicRegister } from '../../src/tenancy/public-http.js';
import { encryptSecret } from '../../src/core/crypto.js';
import { call, json, request } from '../../test/helpers/http-harness.js';

const APP = 960001, ORIGIN = 'https://connect.example.test', CB = 'https://chat.example.test/oauth/callback';
let admin, root, directory, env;
const clients = [], pool = new Map();
const connect = async (url) => { const c = new pg.Client({ connectionString: url }); await c.connect(); clients.push(c); return c; };
const sqlFor = (client) => async (template, ...values) => {
  let query = template[0];
  for (let i = 0; i < values.length; i++) query += '$' + (i + 1) + template[i + 1];
  return (await client.query(query, values)).rows;
};
const rootSqlFactory = () => sqlFor(admin);
const tenantSqlFactory = (url) => {
  if (!pool.has(url)) { const p = connect(url); pool.set(url, async (parts, ...params) => sqlFor(await p)(parts, ...params)); }
  return pool.get(url);
};
// A fake GitHub: people are keyed by the code they present; installations differ per person.
const people = {
  alice: { token: 'tok-alice-0001', id: 31001, login: 'alice-dev', roles: { 'client-co': 'admin' }, installs: [
    { id: 41001, app_id: APP, account: { id: 31001, login: 'alice-dev', type: 'User' }, repository_selection: 'all', suspended_at: null },
    { id: 41002, app_id: APP, account: { id: 51001, login: 'client-co', type: 'Organization' }, repository_selection: 'all', suspended_at: null },
    { id: 41003, app_id: 777, account: { id: 51002, login: 'other-app-org', type: 'Organization' }, repository_selection: 'all', suspended_at: null }] },
  bob: { token: 'tok-bob-00002', id: 31002, login: 'bob-test', installs: [
    { id: 41010, app_id: APP, account: { id: 31002, login: 'bob-test', type: 'User' }, repository_selection: 'all', suspended_at: null }] },
  erin: { token: 'tok-erin-00005', id: 31005, login: 'erin-member', roles: { 'client-co': 'member' }, installs: [
    { id: 41040, app_id: APP, account: { id: 51001, login: 'client-co', type: 'Organization' }, repository_selection: 'all', suspended_at: null }] },
  carol: { token: 'tok-carol-003', id: 31003, login: 'carol-new', installs: [] },
  dave: { token: 'tok-dave-0006', id: 31006, login: 'dave-solo', roles: { 'client-co': 'admin' }, installs: [
    { id: 41050, app_id: APP, account: { id: 51001, login: 'client-co', type: 'Organization' }, repository_selection: 'all', suspended_at: null }] }
};
const fetchImpl = async (url, opts = {}) => {
  if (url === 'https://github.com/login/oauth/access_token') {
    const who = people[String(opts.body.get('code')).split('-')[0]];
    if (!who) return { ok: false, status: 400, json: async () => ({}) };
    return { ok: true, json: async () => ({ access_token: who.token, refresh_token: who.token + '-refresh', expires_in: 28800, refresh_token_expires_in: 15000000 }) };
  }
  const who = Object.values(people).find((p) => opts.headers?.authorization === 'Bearer ' + p.token);
  if (!who) return { ok: false, status: 401, json: async () => ({}) };
  if (url === 'https://api.github.com/user') return { ok: true, status: 200, json: async () => ({ id: who.id, login: who.login, type: 'User' }) };
  if (url.startsWith('https://api.github.com/user/memberships/orgs/')) {
    const org = url.split('/').pop();
    const role = who.roles?.[org];
    return role ? { ok: true, status: 200, json: async () => ({ state: 'active', role, organization: { id: org === 'client-co' ? 51001 : 0 } }) } : { ok: false, status: 404, json: async () => ({}) };
  }
  if (url === 'https://api.github.com/user/memberships/orgs?state=active&per_page=100')
    return { ok: true, status: 200, json: async () => Object.entries(who.roles ?? {}).map(([login, role]) => ({ state: 'active', role, organization: { id: login === 'client-co' ? 51001 : 0, login } })) };
  if (url === 'https://api.github.com/user/installations?per_page=100') return { ok: true, status: 200, json: async () => ({ total_count: who.installs.length, installations: who.installs }) };
  throw new Error('unrecognized fixture route ' + url);
};
const verifier = 'v'.repeat(43), challenge = createHash('sha256').update(verifier).digest('base64url');
const make = (over = {}) => createPublicConnect({ env: { ...env, ...over }, fetchImpl, rootSqlFactory, tenantSqlFactory });
const authorizeParams = (client, extra = {}) => ({ client_id: client.client_id, response_type: 'code', redirect_uri: CB,
  code_challenge: challenge, code_challenge_method: 'S256', state: 'client-nonce', resource: ORIGIN + '/api/mcp', ...extra });
async function signIn(connector, client, who, extra = {}) {
  const started = await connector.start(authorizeParams(client, extra));
  const url = new URL(started.url);
  expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
  return { started, finished: connector.finish({ state: started.csrfState, code: who + '-fixture-code-1', browserCsrf: started.csrfState }) };
}
const exchange = (client, code) => call((req, res) => privateTenantToken(req, res, { env, rootSqlFactory, tenantSqlFactory }),
  request('POST', { grant_type: 'authorization_code', client_id: client.client_id, client_secret: client.client_secret,
    redirect_uri: CB, code, code_verifier: verifier, resource: ORIGIN + '/api/mcp' }));

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Disposable TEST_DATABASE_URL is required.');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname)) throw new Error('Refusing non-local PostgreSQL.');
  admin = await connect(url);
  const ns = 'github_pub6_' + crypto.randomBytes(6).toString('hex');
  await admin.query('CREATE SCHEMA "' + ns + '"'); await admin.query('SET search_path TO "' + ns + '"');
  admin.ns = ns;
  directory = createTenantDirectory(sqlFor(admin)); await directory.initSchema();
  root = createDb(sqlFor(admin)); await root.initSchema();
  env = { VERCEL_ENV: 'production', GITHUB_PRIVATE_TENANT_PILOT: 'enabled', GITHUB_PUBLIC_CONNECT: 'enabled',
    GITHUB_PILOT_APP_ID: String(APP), PUBLIC_BASE_URL: ORIGIN, DATABASE_URL: url,
    GITHUB_PILOT_APP_CLIENT_ID: 'fixture-app-client', GITHUB_PILOT_APP_CLIENT_SECRET: 'fixture-app-secret',
    TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64url'),
    GITHUB_TENANT_ROUTING_KEY: crypto.randomBytes(32).toString('base64url') };
  const secret = (text, kind) => encryptSecret(text, { aad: `github-mcp/app/${APP}/${kind}`, key: Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64url') });
  await root.saveApp({ id: APP, slug: 'public-connect-app', ownerLogin: 'service-owner', ownerType: 'Organization', clientId: 'fixture-app-client',
    clientSecretEnc: secret('fixture-client-secret', 'client_secret'), privateKeyEnc: secret('fixture-private-key', 'private_key'),
    webhookSecretEnc: secret('fixture-webhook-secret', 'webhook_secret'), permissions: { contents: 'read' } });
});
afterAll(async () => {
  if (admin) {
    const ids = await admin.query('SELECT tenant_id FROM gh_tenant_pilot_bootstraps').then((r) => r.rows).catch(() => []);
    for (const r of ids) await admin.query('DROP SCHEMA IF EXISTS "' + tenantSchemaName(r.tenant_id) + '" CASCADE').catch(() => {});
    await admin.query('DROP SCHEMA IF EXISTS "' + admin.ns + '" CASCADE').catch(() => {});
  }
  for (const c of clients.reverse()) await c.end().catch(() => {});
});

describe('PUB-6 public simple connect (dark) in REAL PostgreSQL', () => {
  it('is completely off unless the flag, production and the private machinery are all on', async () => {
    for (const over of [{ GITHUB_PUBLIC_CONNECT: undefined }, { VERCEL_ENV: 'preview' }, { GITHUB_PRIVATE_TENANT_PILOT: 'disabled' }]) {
      await expect(make(over).registerClient({ redirect_uris: [CB] })).rejects.toThrow(/could not verify/);
    }
    const res = await call((req, r) => publicRegister(req, r, { env: { ...env, GITHUB_PUBLIC_CONNECT: undefined } }), request('POST', { redirect_uris: [CB] }));
    expect(res.statusCode).toBe(404);
  });

  it('registers public clients (hash only), validating and capping them', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB], client_name: 'ChatGPT' });
    expect(client.client_id).toMatch(/^pcl_/);
    const row = await directory.getPublicClient(client.client_id);
    expect(row.secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain(client.client_secret);
    await expect(c.registerClient({ redirect_uris: ['http://evil.example.test/cb'] })).rejects.toBeInstanceOf(PublicConnectError);
    await expect(c.registerClient({ redirect_uris: [] })).rejects.toBeInstanceOf(PublicConnectError);
    const total = (await admin.query('SELECT count(*)::int n FROM gh_public_clients')).rows[0].n;
    await expect(make({ GITHUB_PUBLIC_MAX_CLIENTS: String(total) }).registerClient({ redirect_uris: [CB] })).rejects.toMatchObject({ code: 'capacity' });
  });

  it('signs a developer in once and connects their own account AND a client organization in one connection', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB], client_name: 'ChatGPT' });
    const { started, finished } = await signIn(c, client, 'alice');
    const result = await finished;
    const target = new URL(result.redirect);
    expect(target.origin + target.pathname).toBe(CB);
    expect(target.searchParams.get('state')).toBe('client-nonce');
    expect(target.searchParams.get('iss')).toBe(ORIGIN);
    const code = target.searchParams.get('code');
    const selector = parsePublicCode(code);
    expect(selector).not.toBeNull();
    // the same single-use state can never be replayed
    await expect(c.finish({ state: started.csrfState, code: 'alice-fixture-code-2', browserCsrf: started.csrfState })).rejects.toThrow();
    const done = await exchange(client, code);
    expect(done.statusCode).toBe(200);
    const token = json(done);
    expect(token.access_token).toMatch(/^tac_/);
    const { tenantId } = selector;
    const tenantDb = createDb(tenantSqlFactory(env.DATABASE_URL + '#'.repeat(0)) && (await (async () => { const { openAuthorizedTenantDb } = await import('../../src/tenancy/directory.js'); return (await openAuthorizedTenantDb({ directory, tenantId, verifiedIdentityId: selector.identityId, connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory })).sql; })()));
    const grant = await tenantDb.getAccessToken(token.access_token);
    expect(grant.accounts).toEqual(['alice-dev', 'client-co']);
    expect(grant.default_account).toBe('alice-dev');
    expect(grant.mode).toBe('production');
    expect(grant.profile).toBe('full');
    // a code works exactly once, and a wrong secret is refused
    expect((await exchange(client, code)).statusCode).not.toBe(200);
    const bad = await call((req, res) => privateTenantToken(req, res, { env, rootSqlFactory, tenantSqlFactory }),
      request('POST', { grant_type: 'authorization_code', client_id: client.client_id, client_secret: 'wrong-secret-value', redirect_uri: CB, code, code_verifier: verifier, resource: ORIGIN + '/api/mcp' }));
    expect(bad.statusCode).toBe(401);
    // the access token reaches this person's own sealed GitHub authorization, for each account
    const routed = await resolvePrivateTenantMcpBearer({ authorization: 'Bearer ' + token.access_token, env, fetchImpl, rootSqlFactory, tenantSqlFactory });
    expect(await routed.credentials.token({ account: 'alice-dev', cred: 'U' })).toBe(people.alice.token);
    expect(await routed.credentials.token({ account: 'client-co', cred: 'U' })).toBe(people.alice.token);
    // refresh works through the same route
    const refreshed = await call((req, res) => privateTenantToken(req, res, { env, rootSqlFactory, tenantSqlFactory }),
      request('POST', { grant_type: 'refresh_token', client_id: client.client_id, client_secret: client.client_secret, refresh_token: token.refresh_token, resource: ORIGIN + '/api/mcp' }));
    expect(refreshed.statusCode).toBe(200);
    // the other app's installation was never connected
    expect(await tenantDb.getAccount('other-app-org')).toBeNull();
  });

  it('connects only the named accounts when some are typed, and never an account the person cannot see', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const only = await (await signIn(c, client, 'alice', { account: 'Client-Co' })).finished;
    const sel = parsePublicCode(new URL(only.redirect).searchParams.get('code'));
    const exchanged = json(await exchange(client, new URL(only.redirect).searchParams.get('code')));
    expect(exchanged.access_token).toBeDefined();
    expect(sel.tenantId).toBeDefined();
    const stranger = await (await signIn(c, client, 'bob', { account: 'client-co' })).finished;
    expect(stranger.install.url).toMatch(/^https:\/\/github\.com\/apps\/public-connect-app\/installations\/new\?state=pc\./);
  });

  it('gives each person their own isolated tenant and refuses a code carried to another person', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const a = await (await signIn(c, client, 'alice')).finished, b = await (await signIn(c, client, 'bob')).finished;
    const sa = parsePublicCode(new URL(a.redirect).searchParams.get('code')), sb = parsePublicCode(new URL(b.redirect).searchParams.get('code'));
    expect(sa.tenantId).not.toBe(sb.tenantId);
    expect(sa.identityId).not.toBe(sb.identityId);
    // Alice's code with Bob's tenant marker cannot be redeemed: the marker only selects a tenant, the code row decides.
    const forged = new URL(a.redirect).searchParams.get('code').replace(/^pc\.[0-9a-f]{32}\.[0-9a-f]{32}/, `pc.${sb.tenantId.replaceAll('-', '')}.${sb.identityId.replaceAll('-', '')}`);
    expect((await exchange(client, forged)).statusCode).not.toBe(200);
  });

  it('sends a person with no installation to GitHub, resumes after install, and gives a clear answer if still missing', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const first = await (await signIn(c, client, 'carol')).finished;
    const installState = new URL(first.install.url).searchParams.get('state');
    expect(first.install.csrfState).toBe(installState);
    await expect(c.resumeInstall({ state: installState, browserCsrf: 'x'.repeat(installState.length) })).rejects.toThrow();
    const resumed = await c.resumeInstall({ state: installState, browserCsrf: installState });
    expect(resumed.url).toContain('https://github.com/login/oauth/authorize?');
    await expect(c.resumeInstall({ state: installState, browserCsrf: installState })).rejects.toThrow();
    await expect(c.finish({ state: resumed.csrfState, code: 'carol-fixture-code-1', browserCsrf: resumed.csrfState })).rejects.toMatchObject({ code: 'no_installation' });
    // now the App is "installed" for carol and a fresh connect completes
    people.carol.installs = [{ id: 41020, app_id: APP, account: { id: 31003, login: 'carol-new', type: 'User' }, repository_selection: 'selected', suspended_at: null }];
    const done = await (await signIn(c, client, 'carol')).finished;
    expect(done.redirect).toContain(CB);
  });

  it('connects what is available first, then offers accounts without the App; adding is optional and one-use', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    // dave administers an installed organization; his own personal account has no App yet.
    const first = await (await signIn(c, client, 'dave')).finished;
    expect(first.redirect).toBeUndefined();
    expect(first.accounts.connected).toEqual(['client-co']);
    expect(first.accounts.offers).toEqual([{ login: 'dave-solo', id: 31006, type: 'User' }]);
    // the connection already exists, so skipping loses nothing
    const skipped = await c.godChoose({ handle: first.accounts.handle, browserCsrf: first.accounts.handle, choice: 'continue' });
    expect(skipped.redirect).toContain(CB);
    expect(new URL(skipped.redirect).searchParams.get('code')).toBeTruthy();
    await expect(c.godChoose({ handle: first.accounts.handle, browserCsrf: first.accounts.handle, choice: 'continue' })).rejects.toThrow();
    // God mode still gets its extra-keys page after the accounts step
    const again = await (await signIn(c, client, 'dave', { tier: 'god' })).finished;
    const toGod = await c.godChoose({ handle: again.accounts.handle, browserCsrf: again.accounts.handle, choice: 'continue' });
    expect(toGod.god.accounts.map((a) => a.login)).toEqual(['client-co']);
    // adding sends the person to GitHub's install page aimed at that account, and a bad choice is refused
    const third = await (await signIn(c, client, 'dave')).finished;
    await expect(c.godChoose({ handle: third.accounts.handle, browserCsrf: third.accounts.handle, choice: 'add', offerIndex: '5' })).rejects.toThrow();
    const fourth = await (await signIn(c, client, 'dave')).finished;
    const added = await c.godChoose({ handle: fourth.accounts.handle, browserCsrf: fourth.accounts.handle, choice: 'add', offerIndex: '0' });
    const addUrl = new URL(added.install.url);
    expect(addUrl.href).toMatch(/^https:\/\/github\.com\/apps\/public-connect-app\/installations\/new\?state=pc\./);
    expect(addUrl.searchParams.get('suggested_target_id')).toBe('31006');
    // back from installing: both accounts are connected and nothing more is offered
    people.dave.installs.push({ id: 41051, app_id: APP, account: { id: 31006, login: 'dave-solo', type: 'User' }, repository_selection: 'all', suspended_at: null });
    const resumed = await c.resumeInstall({ state: addUrl.searchParams.get('state'), browserCsrf: addUrl.searchParams.get('state') });
    const done = await c.finish({ state: resumed.csrfState, code: 'dave-fixture-code-1', browserCsrf: resumed.csrfState });
    expect(done.accounts).toBeUndefined();
    expect(done.redirect).toContain(CB);
    people.dave.installs.pop();
    // someone who names accounts is never offered more
    const named = await (await signIn(c, client, 'dave', { account: 'client-co' })).finished;
    expect(named.redirect).toContain(CB);
  });

  it('rejects a mismatched browser cookie before any GitHub request, and unknown or revoked clients', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const started = await c.start(authorizeParams(client));
    await expect(c.finish({ state: started.csrfState, code: 'alice-fixture-code-1', browserCsrf: 'wrong-cookie-' + 'x'.repeat(50) })).rejects.toThrow();
    await expect(c.start(authorizeParams(client, { redirect_uri: 'https://elsewhere.example.test/cb' }))).rejects.toThrow();
    await expect(c.start(authorizeParams(client, { resource: 'https://elsewhere.example.test/api/mcp' }))).rejects.toThrow();
    await expect(c.start(authorizeParams(client, { account: 'not valid!' }))).rejects.toThrow();
    await expect(c.start(authorizeParams(client, { scope: 'admin everything' }))).rejects.toThrow();
    await expect(c.start(authorizeParams(client, { scope: 'github.notifications.read' }))).resolves.toBeTruthy();
    const a = await (await signIn(c, client, 'alice')).finished;
    expect(await directory.deletePublicClient(client.client_id)).toBe(true);
    expect((await exchange(client, new URL(a.redirect).searchParams.get('code'))).statusCode).toBe(401);
  });

  it('holds hard caps: self-serve tenants and open sign-ins', async () => {
    const existing = (await admin.query('SELECT count(*)::int n FROM gh_tenant_pilot_bootstraps')).rows[0].n;
    const c = make({ GITHUB_PUBLIC_MAX_TENANTS: String(existing) });
    const client = await c.registerClient({ redirect_uris: [CB] });
    people.dave = { token: 'tok-dave-0004', id: 31004, login: 'dave-new', installs: [{ id: 41030, app_id: APP, account: { id: 31004, login: 'dave-new', type: 'User' }, repository_selection: 'all', suspended_at: null }] };
    await expect((await signIn(c, client, 'dave')).finished).rejects.toMatchObject({ code: 'capacity' });
    // someone already counted can still sign in again
    expect((await (await signIn(c, client, 'alice')).finished).redirect).toContain(CB);
    const open = (await admin.query('SELECT count(*)::int n FROM gh_public_flows WHERE expires_at > now()')).rows[0].n;
    await expect(make({ GITHUB_PUBLIC_MAX_OPEN_FLOWS: String(open) }).start(authorizeParams(client))).rejects.toMatchObject({ code: 'capacity' });
  });

  it('God mode adds an extra-keys step per connected account and still finishes with a normal code', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const result = await (await signIn(c, client, 'alice', { tier: 'god' })).finished;
    expect(result.redirect).toBeUndefined();
    expect(result.god.accounts.map((a) => a.login)).toEqual(['alice-dev', 'client-co']);
    const handle = result.god.handle;
    await expect(c.godChoose({ handle, browserCsrf: 'x'.repeat(handle.length), choice: 'finish' })).rejects.toThrow();
    const picked = await c.godChoose({ handle, browserCsrf: handle, choice: 'notifications', account: 'client-co' });
    expect(picked.optional).toMatchObject({ kind: 'K', account: 'client-co', oauth: true });
    await expect(c.godChoose({ handle, browserCsrf: handle, choice: 'finish' })).rejects.toThrow();
    const second = await (await signIn(c, client, 'alice', { tier: 'god' })).finished;
    const org = await c.godChoose({ handle: second.god.handle, browserCsrf: second.god.handle, choice: 'package', account: 'client-co' });
    expect(org.optional).toMatchObject({ kind: 'P', account: 'client-co' });
    const third = await (await signIn(c, client, 'alice', { tier: 'god' })).finished;
    await expect(c.godChoose({ handle: third.god.handle, browserCsrf: third.god.handle, choice: 'package', account: 'alice-dev' })).rejects.toThrow();
    const fourth = await (await signIn(c, client, 'alice', { tier: 'god' })).finished;
    const fin = await c.godChoose({ handle: fourth.god.handle, browserCsrf: fourth.god.handle, choice: 'finish' });
    const code = new URL(fin.redirect).searchParams.get('code');
    expect((await exchange(client, code)).statusCode).toBe(200);
  });

  it('the web pages render plain English, set strict cookies and never echo untrusted input', async () => {
    const client = await make().registerClient({ redirect_uris: [CB], client_name: '<script>alert(1)</script>' });
    const page = await call((req, res) => publicAuthorize(req, res, { env, connect: make() }), request('GET', authorizeParams(client)));
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('God mode');
    expect(page.body).toContain('Standard');
    expect(page.body).toContain('chat.example.test');
    expect(page.body).toContain('Read-only');
    expect(page.body).toContain('Sign in with GitHub');
    expect(page.body).not.toContain('<script>alert');
    expect(String(page.headers['Set-Cookie'])).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    expect(page.headers['Content-Security-Policy']).toContain("default-src 'none'");
    const refused = await call((req, res) => publicCallback(req, res, { env, connect: make() }), { ...request('GET', { state: 'pc.' + 'a'.repeat(40), code: 'alice-fixture-code-1' }), headers: {} });
    expect(refused.statusCode).toBe(403);
    expect(refused.body).not.toMatch(/stack|sql|token/i);
    const off = await call((req, res) => publicAuthorize(req, res, { env: { ...env, GITHUB_PUBLIC_CONNECT: undefined } }), request('GET', authorizeParams(client)));
    expect(off.statusCode).toBe(404);
  });
});

describe('PUB-6 God-mode keys, revocation and the MCP gate', () => {
  it('saves a notifications token for ONE account of a multi-account connection and returns a working code', async () => {
    const { createPrivateOptionalEnrollment } = await import('../../src/tenancy/optional-setup.js');
    const { openAuthorizedTenantDb } = await import('../../src/tenancy/directory.js');
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const result = await (await signIn(c, client, 'alice', { tier: 'god' })).finished;
    const handle = result.god.handle;
    const picked = await c.godChoose({ handle, browserCsrf: handle, choice: 'notifications', account: 'client-co' });
    const fetchWithScopes = async (url, opts) => {
      if (url === 'https://api.github.com/notifications?per_page=1') return { ok: true, status: 200, headers: { get: () => 'notifications' } };
      return fetchImpl(url, opts);
    };
    const enrollment = createPrivateOptionalEnrollment({ env, fetchImpl: fetchWithScopes, directoryFactory: () => createTenantDirectory(rootSqlFactory()),
      tenantAccess: (dir, claim) => openAuthorizedTenantDb({ directory: dir, tenantId: claim.tenantId, verifiedIdentityId: claim.identityId, connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory }) });
    // a token that belongs to a DIFFERENT GitHub person is refused
    await expect(enrollment.finish({ state: picked.optional.state, action: 'save', value: people.bob.token })).rejects.toThrow();
    const again = await c.godChoose({ handle: (await (await signIn(c, client, 'alice', { tier: 'god' })).finished).god.handle, browserCsrf: undefined, choice: 'finish' }).catch(() => null);
    expect(again).toBeNull();
    const second = await (await signIn(c, client, 'alice', { tier: 'god' })).finished;
    const pick2 = await c.godChoose({ handle: second.god.handle, browserCsrf: second.god.handle, choice: 'notifications', account: 'client-co' });
    const saved = await enrollment.finish({ state: pick2.optional.state, action: 'save', value: people.alice.token });
    expect(saved.status).toBe('read-observed-at-enrollment');
    const code = new URL(saved.destination).searchParams.get('code');
    expect(parsePublicCode(code)).not.toBeNull();
    const exchanged = await exchange(client, code);
    expect(exchanged.statusCode).toBe(200);
    const bearer = json(exchanged).access_token;
    const routed = await resolvePrivateTenantMcpBearer({ authorization: 'Bearer ' + bearer, env, fetchImpl, rootSqlFactory, tenantSqlFactory });
    expect(routed).not.toBeNull();
    expect((await routed.db.getAccessToken(bearer)).accounts).toEqual(['alice-dev', 'client-co']);
  });

  it('the MCP gate refuses a public connection once its client is deleted or the person is revoked', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const r = await (await signIn(c, client, 'bob')).finished;
    const token = json(await exchange(client, new URL(r.redirect).searchParams.get('code')));
    const gate = () => resolvePrivateTenantMcpBearer({ authorization: 'Bearer ' + token.access_token, env, fetchImpl, rootSqlFactory, tenantSqlFactory });
    expect(await gate()).not.toBeNull();
    // A forged token for another tenant with this client's name is refused by signature alone.
    expect(await resolvePrivateTenantMcpBearer({ authorization: 'Bearer tac_' + 'A'.repeat(86) + '_' + 'B'.repeat(43), env, fetchImpl, rootSqlFactory, tenantSqlFactory })).toBeNull();
    const sel = parsePublicCode(new URL(r.redirect).searchParams.get('code'));
    expect(await directory.revokePilotIdentity(sel.tenantId, sel.identityId, sel.identityId)).toBe(true);
    expect(await gate()).toBeNull();
    const refresh = await call((req, res) => privateTenantToken(req, res, { env, rootSqlFactory, tenantSqlFactory }),
      request('POST', { grant_type: 'refresh_token', client_id: client.client_id, client_secret: client.client_secret, refresh_token: token.refresh_token, resource: ORIGIN + '/api/mcp' }));
    expect(refresh.statusCode).toBe(401);
    const other = await c.registerClient({ redirect_uris: [CB] });
    const r2 = await (await signIn(c, other, 'alice')).finished;
    const t2 = json(await exchange(other, new URL(r2.redirect).searchParams.get('code')));
    expect(await directory.deletePublicClient(other.client_id)).toBe(true);
    expect(await resolvePrivateTenantMcpBearer({ authorization: 'Bearer ' + t2.access_token, env, fetchImpl, rootSqlFactory, tenantSqlFactory })).toBeNull();
  });
});

describe('PUB-6 display time zone', () => {
  it('saves the zone chosen on the sign-in page for that person only, keeps it when later left blank, and refuses a fake zone', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    await expect(c.start(authorizeParams(client, { time_zone: 'Mars/Base' }))).rejects.toThrow();
    const one = await (await signIn(c, client, 'alice', { time_zone: 'America/Denver' })).finished;
    const token = json(await exchange(client, new URL(one.redirect).searchParams.get('code')));
    const routed = await resolvePrivateTenantMcpBearer({ authorization: 'Bearer ' + token.access_token, env, fetchImpl, rootSqlFactory, tenantSqlFactory });
    expect(await routed.db.getSetting('time_zone')).toBe('America/Denver');
    const again = await (await signIn(c, client, 'alice')).finished;
    const token2 = json(await exchange(client, new URL(again.redirect).searchParams.get('code')));
    const routed2 = await resolvePrivateTenantMcpBearer({ authorization: 'Bearer ' + token2.access_token, env, fetchImpl, rootSqlFactory, tenantSqlFactory });
    expect(await routed2.db.getSetting('time_zone')).toBe('America/Denver');
    const other = await (await signIn(c, client, 'bob')).finished;
    const tokenB = json(await exchange(client, new URL(other.redirect).searchParams.get('code')));
    const routedB = await resolvePrivateTenantMcpBearer({ authorization: 'Bearer ' + tokenB.access_token, env, fetchImpl, rootSqlFactory, tenantSqlFactory });
    expect(await routedB.db.getSetting('time_zone')).toBeNull();
  });
});

describe('PUB-6 branding', () => {
  it('shows the Robinson look and icon on the connect page and lists the icon on the MCP server', async () => {
    const { serverInfo, BRAND_CSS, iconBytes } = await import('../../src/brand/brand.js');
    const client = await make().registerClient({ redirect_uris: [CB] });
    const page = await call((req, res) => publicAuthorize(req, res, { env, connect: make() }), request('GET', authorizeParams(client)));
    expect(page.body).toContain('GitHub by Robinson AI Systems');
    expect(page.body).toContain('/brand/icon-256.png');
    expect(page.body).toContain('#00B67A');
    expect(page.headers['Content-Security-Policy']).toContain("img-src 'self'");
    expect(BRAND_CSS).toContain('#0C0C0C');
    const info = serverInfo(ORIGIN);
    expect(info.title).toBe('GitHub by Robinson AI Systems');
    expect(info.icons[0].src).toBe(ORIGIN + '/brand/icon-256.png');
    expect(serverInfo(null).icons).toBeUndefined();
    expect(iconBytes(256).subarray(0, 4).toString('hex')).toBe('89504e47');
  });
});

describe('PUB-6 who may connect which account', () => {
  it('lets a person connect only their own account or an organization they administer', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    // Erin can SEE the client organization's installation but is only a member: nothing is connected, no tenant data written.
    const first = await (await signIn(c, client, 'erin')).finished;
    expect(first.install).toBeDefined();
    const resumed = await c.resumeInstall({ state: first.install.csrfState, browserCsrf: first.install.csrfState });
    await expect(c.finish({ state: resumed.csrfState, code: 'erin-fixture-code-1', browserCsrf: resumed.csrfState })).rejects.toMatchObject({ code: 'no_installation' });
    const erinTenant = await admin.query("SELECT count(*)::int n FROM gh_tenant_identities WHERE provider_subject='31005'");
    expect(erinTenant.rows[0].n).toBe(0);
    // A personal installation whose account id is not the signed-in person is refused too.
    const spoof = { ...people.erin.installs[0], account: { id: 99999, login: 'someone-else', type: 'User' } };
    people.erin.installs = [spoof];
    const again = await (await signIn(c, client, 'erin', { account: 'someone-else' })).finished;
    expect(again.install).toBeDefined();
  });
});

describe('PUB-6 letting the assistant make changes', () => {
  it('default: changes are on for the accounts the person owns, still gated; read-only chosen: preview only', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const on = await (await signIn(c, client, 'alice')).finished;
    const tokenOn = json(await exchange(client, new URL(on.redirect).searchParams.get('code')));
    const routedOn = await resolvePrivateTenantMcpBearer({ authorization: 'Bearer ' + tokenOn.access_token, env, fetchImpl, rootSqlFactory, tenantSqlFactory });
    expect(routedOn).not.toBeNull();
    const grantOn = await routedOn.db.getAccessToken(tokenOn.access_token);
    expect(grantOn.mode).toBe('production');
    expect(grantOn.accounts).toEqual(['alice-dev', 'client-co']);
    for (const login of grantOn.accounts) expect((await routedOn.db.getAccount(login)).production_enabled).toBe(true);
    // choosing read-only is preview, and the gate still accepts it
    const off = await (await signIn(c, client, 'alice', { read_only: 'yes' })).finished;
    const tokenOff = json(await exchange(client, new URL(off.redirect).searchParams.get('code')));
    const routedOff = await resolvePrivateTenantMcpBearer({ authorization: 'Bearer ' + tokenOff.access_token, env, fetchImpl, rootSqlFactory, tenantSqlFactory });
    expect((await routedOff.db.getAccessToken(tokenOff.access_token)).mode).toBe('preview');
    // an organization the person does not administer is never switched on
    people.erin.installs = [{ id: 41040, app_id: APP, account: { id: 51001, login: 'client-co', type: 'Organization' }, repository_selection: 'all', suspended_at: null }];
    const denied = await (await signIn(c, client, 'erin')).finished;
    expect(denied.install).toBeDefined();
    // God mode keeps the choice through the extra-keys page
    const god = await (await signIn(c, client, 'alice', { tier: 'god' })).finished;
    const fin = await c.godChoose({ handle: god.god.handle, browserCsrf: god.god.handle, choice: 'finish' });
    const tokenGod = json(await exchange(client, new URL(fin.redirect).searchParams.get('code')));
    const routedGod = await resolvePrivateTenantMcpBearer({ authorization: 'Bearer ' + tokenGod.access_token, env, fetchImpl, rootSqlFactory, tenantSqlFactory });
    expect((await routedGod.db.getAccessToken(tokenGod.access_token)).mode).toBe('production');
  });
});

describe('PUB-6 owner usage summary', () => {
  it('adds up each person\'s assistant calls (counts only), skips old hours, and never shows names', async () => {
    const people2 = await admin.query("SELECT tenant_id FROM gh_tenant_pilot_bootstraps WHERE account_login='public-connect' ORDER BY created_at LIMIT 2").then((r) => r.rows);
    expect(people2.length).toBe(2);
    const put = async (tenantId, hour, outcome, count) => {
      const schema = tenantSchemaName(String(tenantId));
      await admin.query(`INSERT INTO "${schema}".gh_tenant_runtime_metrics (hour,event,outcome,latency_bucket,count)
        VALUES (date_trunc('hour', now()) - ($1 * interval '1 hour'),'mcp',$2,'lt100ms',$3)
        ON CONFLICT (hour,event,outcome,latency_bucket) DO UPDATE SET count = EXCLUDED.count`, [hour, outcome, count]);
    };
    await put(people2[0].tenant_id, 0, 'ok', 10);
    await put(people2[0].tenant_id, 0, 'refused', 2);
    await put(people2[1].tenant_id, 0, 'ok', 5);
    await put(people2[1].tenant_id, 0, 'throttled', 1);
    await put(people2[1].tenant_id, 72, 'error', 4); // three days ago: in the week, not the day
    await put(people2[1].tenant_id, 24 * 20, 'ok', 99); // twenty days ago: in neither
    const { publicUsageSummary } = await import('../../src/tenancy/usage-summary.js');
    const out = await publicUsageSummary(rootSqlFactory(), { connectionString: process.env.TEST_DATABASE_URL, sqlFactory: tenantSqlFactory });
    expect(out.peopleConnected).toBeGreaterThanOrEqual(2);
    expect(out.unreadable).toBe(0);
    expect(out.lastDay.ok).toBeGreaterThanOrEqual(15);
    expect(out.lastDay.refused).toBeGreaterThanOrEqual(2);
    expect(out.lastDay.throttled).toBeGreaterThanOrEqual(1);
    expect(out.lastDay.errors).toBe(0);
    expect(out.lastWeek.errors).toBe(4);
    expect(out.lastWeek.calls).toBe(out.lastWeek.ok + out.lastWeek.refused + out.lastWeek.throttled + out.lastWeek.errors);
    expect(JSON.stringify(out)).not.toMatch(/alice|bob|tok-|@/);
  });
});

describe('PUB-6 owner deletes one public person\'s data', () => {
  it('removes that person completely, keeps everyone else, and refuses organization names', async () => {
    const { forgetPublicPerson, findPublicTenantsByLogin } = await import('../../src/tenancy/forget-person.js');
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const tokenFor = async (who) => {
      const fin = await (await signIn(c, client, who)).finished;
      return json(await exchange(client, new URL(fin.redirect).searchParams.get('code')));
    };
    const gate = (t) => resolvePrivateTenantMcpBearer({ authorization: 'Bearer ' + t.access_token, env, fetchImpl, rootSqlFactory, tenantSqlFactory });
    const alice = await tokenFor('alice'), bob = await tokenFor('bob');
    const aliceCtx = await gate(alice), bobCtx = await gate(bob);
    expect(aliceCtx).not.toBeNull(); expect(bobCtx).not.toBeNull();
    const opts = { connectionString: process.env.TEST_DATABASE_URL, sqlFactory: tenantSqlFactory };
    const aliceTenant = await admin.query("SELECT tenant_id FROM gh_tenant_pilot_bootstraps b JOIN gh_tenant_identities i ON i.id=b.identity_id WHERE b.account_login='public-connect' AND i.provider_subject=$1", ['31001']).then((r) => r.rows[0].tenant_id);
    const schemaExists = async (id) => (await admin.query('SELECT 1 FROM information_schema.schemata WHERE schema_name=$1', [tenantSchemaName(String(id))])).rowCount === 1;
    expect(await schemaExists(aliceTenant)).toBe(true);
    // an organization name never identifies a person; a name nobody connected finds nothing
    expect(await findPublicTenantsByLogin(rootSqlFactory(), 'client-co', opts)).toEqual([]);
    expect(await forgetPublicPerson(directory, rootSqlFactory(), 'nobody-here', opts)).toBe(0);
    await expect(forgetPublicPerson(directory, rootSqlFactory(), 'bad name!', opts)).rejects.toThrow();
    expect(await forgetPublicPerson(directory, rootSqlFactory(), 'alice-dev', opts)).toBe(1);
    // alice is gone everywhere: namespace, root rows, identity, and her token no longer works
    expect(await schemaExists(aliceTenant)).toBe(false);
    for (const table of ['gh_tenants', 'gh_tenant_memberships', 'gh_tenant_pilot_bootstraps', 'gh_tenant_pilot_allowlist']) {
      const col = table === 'gh_tenants' ? 'id' : 'tenant_id';
      expect((await admin.query(`SELECT 1 FROM ${table} WHERE ${col}=$1`, [aliceTenant])).rowCount).toBe(0);
    }
    expect((await admin.query("SELECT 1 FROM gh_tenant_identities WHERE provider_subject='31001'")).rowCount).toBe(0);
    expect(await gate(alice)).toBeNull();
    // bob is untouched
    expect(await gate(bob)).not.toBeNull();
    expect(await directory.forgetPublicTenant(aliceTenant)).toBe(false);
    // a private (non-public) tenant can never be removed this way
    const priv = await admin.query("SELECT tenant_id FROM gh_tenant_pilot_bootstraps WHERE account_login<>'public-connect' LIMIT 1").then((r) => r.rows[0]);
    if (priv) await expect(directory.forgetPublicTenant(String(priv.tenant_id))).rejects.toThrow();
    // she can connect again afterwards as a brand-new person
    expect(await gate(await tokenFor('alice'))).not.toBeNull();
  });
});

describe('PUB-6 a person deletes their own data', () => {
  it('needs a GitHub sign-in, one use of the confirm step, and removes only that person', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const tokenFor = async (who) => {
      const fin = await (await signIn(c, client, who)).finished;
      return json(await exchange(client, new URL(fin.redirect).searchParams.get('code')));
    };
    const gate = (t) => resolvePrivateTenantMcpBearer({ authorization: 'Bearer ' + t.access_token, env, fetchImpl, rootSqlFactory, tenantSqlFactory });
    const alice = await tokenFor('alice'), bob = await tokenFor('bob');
    expect(await gate(alice)).not.toBeNull();
    const signInToForget = async (who) => {
      const started = await c.startForget();
      expect(new URL(started.url).origin + new URL(started.url).pathname).toBe('https://github.com/login/oauth/authorize');
      return c.finish({ state: started.csrfState, code: who + '-fixture-code-1', browserCsrf: started.csrfState });
    };
    // someone who never connected is told so, and is not enrolled by asking
    const before = (await admin.query('SELECT count(*)::int AS n FROM gh_tenant_identities')).rows[0].n;
    expect(await signInToForget('erin')).toEqual({ forget: { none: true } });
    expect((await admin.query('SELECT count(*)::int AS n FROM gh_tenant_identities')).rows[0].n).toBe(before);
    // the built-in page's client can never be used for a normal connection
    await expect(c.start(authorizeParams({ client_id: FORGET_CLIENT }))).rejects.toThrow();
    // alice signs in, gets one confirm handle that only her browser cookie can use
    const asked = await signInToForget('alice');
    expect(asked.forget.handle).toMatch(/^pc\./);
    await expect(c.forgetConfirm({ handle: asked.forget.handle, browserCsrf: 'x'.repeat(asked.forget.handle.length) })).rejects.toThrow();
    // a confirm handle is not a God-mode handle, and cannot be used as one
    await expect(c.godChoose({ handle: asked.forget.handle, browserCsrf: asked.forget.handle, choice: 'finish' })).rejects.toThrow();
    // (the two failed attempts above used the handle up or left it; ask again for a clean one)
    const again = await signInToForget('alice');
    expect(await c.forgetConfirm({ handle: again.forget.handle, browserCsrf: again.forget.handle })).toBe(true);
    await expect(c.forgetConfirm({ handle: again.forget.handle, browserCsrf: again.forget.handle })).rejects.toThrow();
    expect(await gate(alice)).toBeNull();
    expect(await gate(bob)).not.toBeNull();
    expect(await signInToForget('alice')).toEqual({ forget: { none: true } });
  });
  it('shows plain-English pages and refuses a post without the browser cookie', async () => {
    const connect = make();
    const page = await call((req, res) => publicForget(req, res, { env, connect }), request('GET', { forget: '1' }));
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Delete my data');
    expect(String(page.headers['Set-Cookie'])).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    const refused = await call((req, res) => publicForget(req, res, { env, connect }),
      request('POST', { forget: '1', action: 'start', form_csrf: 'x'.repeat(43) }, { origin: ORIGIN }));
    expect(refused.statusCode).toBe(403);
    // A second press (the cookie was used up) or a browser with no cookie gets a plain explanation, not the generic refusal.
    const client = await make().registerClient({ redirect_uris: [CB] });
    const blocked = await call((req, res) => publicAuthorize(req, res, { env, connect: make() }),
      request('POST', { ...authorizeParams(client), form_csrf: 'x'.repeat(43) }, { origin: ORIGIN }));
    expect(blocked.statusCode).toBe(403);
    expect(blocked.body).toContain('already used');
    const off = await call((req, res) => publicForget(req, res, { env: { ...env, GITHUB_PUBLIC_CONNECT: undefined }, connect }), request('GET', { forget: '1' }));
    expect(off.statusCode).toBe(404);
  });
});
