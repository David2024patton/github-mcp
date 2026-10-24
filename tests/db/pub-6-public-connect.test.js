import crypto, { createHash } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { createTenantDirectory, tenantSchemaName } from '../../src/tenancy/directory.js';
import { createPublicConnect, FORGET_CLIENT, MANAGE_CLIENT, PublicConnectError } from '../../src/tenancy/public-connect.js';
import { parsePublicCode } from '../../src/tenancy/public-code.js';
import { privateTenantToken } from '../../src/tenancy/oauth-token.js';
import { resolvePrivateTenantMcpBearer } from '../../src/tenancy/mcp-route.js';
import { publicApprove, publicAuthorize, publicCallback, publicForget, publicManage, publicRegister } from '../../src/tenancy/public-http.js';
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
  const started = await connector.begin(authorizeParams(client, extra));
  const url = new URL(started.url);
  expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
  return { started, finished: connector.finish({ state: started.state, code: who + '-fixture-code-1' }) };
}
/** Sign in and tap Approve (optionally Read-only). Returns the app's redirect address. */
async function approved(connector, client, who, { readOnly = false, extra = {} } = {}) {
  const result = await (await signIn(connector, client, who, extra)).finished;
  if (!result.approve) throw new Error('expected the Approve page, got ' + Object.keys(result));
  return (await connector.approve({ handle: result.approve.handle, choice: 'approve', readOnly })).redirect;
}
const codeOf = (redirect) => new URL(redirect).searchParams.get('code');
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

const tenantOf = async (selector) => {
  const { openAuthorizedTenantDb } = await import('../../src/tenancy/directory.js');
  return createDb((await openAuthorizedTenantDb({ directory, tenantId: selector.tenantId, verifiedIdentityId: selector.identityId, connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory })).sql);
};
const gateFor = (token) => resolvePrivateTenantMcpBearer({ authorization: 'Bearer ' + token.access_token, env, fetchImpl, rootSqlFactory, tenantSqlFactory });
const tokenFor = async (c, client, who, opts) => json(await exchange(client, codeOf(await approved(c, client, who, opts))));

describe('PUB-6 public simple connect in REAL PostgreSQL', () => {
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

  it('one sign-in connects their own account AND a client organization, but only after Approve', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB], client_name: 'ChatGPT' });
    const { started, finished } = await signIn(c, client, 'alice');
    const result = await finished;
    // Nothing reaches the app yet: the person sees who is signed in and which site gets access.
    expect(result.redirect).toBeUndefined();
    expect(result.approve).toMatchObject({ signedInAs: 'alice-dev', appName: 'ChatGPT', appHost: 'chat.example.test' });
    expect(result.approve.accounts.map((a) => a.login)).toEqual(['alice-dev', 'client-co']);
    // the same single-use GitHub state can never be replayed
    await expect(c.finish({ state: started.state, code: 'alice-fixture-code-2' })).rejects.toThrow();
    const { redirect } = await c.approve({ handle: result.approve.handle, choice: 'approve' });
    // the Approve handle is one use
    await expect(c.approve({ handle: result.approve.handle, choice: 'approve' })).rejects.toThrow();
    const target = new URL(redirect);
    expect(target.origin + target.pathname).toBe(CB);
    expect(target.searchParams.get('state')).toBe('client-nonce');
    expect(target.searchParams.get('iss')).toBe(ORIGIN);
    const code = target.searchParams.get('code');
    const selector = parsePublicCode(code);
    expect(selector).not.toBeNull();
    const done = await exchange(client, code);
    expect(done.statusCode).toBe(200);
    const token = json(done);
    expect(token.access_token).toMatch(/^tac_/);
    const tenantDb = await tenantOf(selector);
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
    const routed = await gateFor(token);
    expect(await routed.credentials.token({ account: 'alice-dev', cred: 'U' })).toBe(people.alice.token);
    expect(await routed.credentials.token({ account: 'client-co', cred: 'U' })).toBe(people.alice.token);
    const refreshed = await call((req, res) => privateTenantToken(req, res, { env, rootSqlFactory, tenantSqlFactory }),
      request('POST', { grant_type: 'refresh_token', client_id: client.client_id, client_secret: client.client_secret, refresh_token: token.refresh_token, resource: ORIGIN + '/api/mcp' }));
    expect(refreshed.statusCode).toBe(200);
    // the other app's installation was never connected
    expect(await tenantDb.getAccount('other-app-org')).toBeNull();
  });

  it('Cancel sends the app access_denied and no code', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const result = await (await signIn(c, client, 'alice')).finished;
    const { redirect } = await c.approve({ handle: result.approve.handle, choice: 'cancel' });
    const url = new URL(redirect);
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('code')).toBeNull();
    expect(url.searchParams.get('state')).toBe('client-nonce');
    await expect(c.approve({ handle: result.approve.handle, choice: 'approve' })).rejects.toThrow();
    await expect(c.approve({ handle: result.approve.handle, choice: 'something-else' })).rejects.toThrow();
  });

  it('gives each person their own isolated tenant and refuses a code carried to another person', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const a = await approved(c, client, 'alice'), b = await approved(c, client, 'bob');
    const sa = parsePublicCode(codeOf(a)), sb = parsePublicCode(codeOf(b));
    expect(sa.tenantId).not.toBe(sb.tenantId);
    expect(sa.identityId).not.toBe(sb.identityId);
    const forged = codeOf(a).replace(/^pc\.[0-9a-f]{32}\.[0-9a-f]{32}/, `pc.${sb.tenantId.replaceAll('-', '')}.${sb.identityId.replaceAll('-', '')}`);
    expect((await exchange(client, forged)).statusCode).not.toBe(200);
  });

  it('a person with no installation gets the install page, resumes after installing, and is told plainly if still missing', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const first = await (await signIn(c, client, 'carol')).finished;
    expect(first.install).toMatchObject({ signedInAs: 'carol-new', again: false });
    const installState = new URL(first.install.url).searchParams.get('state');
    expect(first.install.url).toMatch(/^https:\/\/github\.com\/apps\/public-connect-app\/installations\/new\?state=pc\./);
    const resumed = await c.resumeInstall({ state: installState });
    expect(resumed.url).toContain('https://github.com/login/oauth/authorize?');
    await expect(c.resumeInstall({ state: installState })).rejects.toThrow();
    const still = await c.finish({ state: resumed.state, code: 'carol-fixture-code-1' });
    expect(still.install).toMatchObject({ again: true });
    // now the App is "installed" for carol and a fresh connect reaches Approve
    people.carol.installs = [{ id: 41020, app_id: APP, account: { id: 31003, login: 'carol-new', type: 'User' }, repository_selection: 'selected', suspended_at: null }];
    expect(await approved(c, client, 'carol')).toContain(CB);
  });

  it('offers accounts without the App on the Approve page (to add later) and never loops into an install', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    // dave administers an installed organization; his own personal account has no App yet.
    const first = await (await signIn(c, client, 'dave')).finished;
    expect(first.approve.accounts.map((a) => a.login)).toEqual(['client-co']);
    expect(first.approve.others).toEqual(['dave-solo']);
    expect(first.approve.manageUrl).toBe(ORIGIN + '/connection');
    const { redirect } = await c.approve({ handle: first.approve.handle, choice: 'approve' });
    expect(codeOf(redirect)).toBeTruthy();
  });

  it('refuses unknown or revoked clients and bad requests before any GitHub request', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    await expect(c.begin(authorizeParams(client, { redirect_uri: 'https://elsewhere.example.test/cb' }))).rejects.toThrow();
    await expect(c.begin(authorizeParams(client, { resource: 'https://elsewhere.example.test/api/mcp' }))).rejects.toThrow();
    await expect(c.begin(authorizeParams(client, { scope: 'admin everything' }))).rejects.toThrow();
    await expect(c.begin(authorizeParams(client, { scope: 'github.notifications.read' }))).resolves.toBeTruthy();
    await expect(c.begin(authorizeParams({ client_id: MANAGE_CLIENT }))).rejects.toThrow();
    await expect(c.finish({ state: 'pc.' + 'a'.repeat(40), code: 'alice-fixture-code-1' })).rejects.toThrow();
    const a = await approved(c, client, 'alice');
    expect(await directory.deletePublicClient(client.client_id)).toBe(true);
    expect((await exchange(client, codeOf(a))).statusCode).toBe(401);
  });

  it('holds hard caps: self-serve tenants and open sign-ins', async () => {
    const existing = (await admin.query('SELECT count(*)::int n FROM gh_tenant_pilot_bootstraps')).rows[0].n;
    const c = make({ GITHUB_PUBLIC_MAX_TENANTS: String(existing) });
    const client = await c.registerClient({ redirect_uris: [CB] });
    people.zed = { token: 'tok-zed-00004', id: 31004, login: 'zed-new', installs: [{ id: 41030, app_id: APP, account: { id: 31004, login: 'zed-new', type: 'User' }, repository_selection: 'all', suspended_at: null }] };
    await expect((await signIn(c, client, 'zed')).finished).rejects.toMatchObject({ code: 'capacity' });
    expect(await approved(c, client, 'alice')).toContain(CB);
    const open = (await admin.query('SELECT count(*)::int n FROM gh_public_flows WHERE expires_at > now()')).rows[0].n;
    await expect(make({ GITHUB_PUBLIC_MAX_OPEN_FLOWS: String(open) }).begin(authorizeParams(client))).rejects.toMatchObject({ code: 'capacity' });
  });

  it('web pages: straight to GitHub, no cookies, plain English, never echo untrusted input', async () => {
    const client = await make().registerClient({ redirect_uris: [CB], client_name: '<script>alert(1)</script>' });
    const go = await call((req, res) => publicAuthorize(req, res, { env, connect: make() }), request('GET', authorizeParams(client)));
    expect(go.statusCode).toBe(302);
    expect(go.headers.Location).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
    expect(go.headers['Set-Cookie']).toBeUndefined();
    const state = new URL(go.headers.Location).searchParams.get('state');
    const page = await call((req, res) => publicCallback(req, res, { env, connect: make() }), request('GET', { state, code: 'alice-fixture-code-1' }));
    expect(page.statusCode).toBe(200);
    expect(page.headers['Set-Cookie']).toBeUndefined();
    expect(page.body).toContain('Approve the connection');
    expect(page.body).toContain('alice-dev');
    expect(page.body).toContain('chat.example.test');
    expect(page.body).toContain('Read-only');
    expect(page.body).not.toContain('<script>alert');
    expect(page.headers['Content-Security-Policy']).toContain("default-src 'none'");
    expect(page.headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    const handle = /name="handle" value="([^"]+)"/.exec(page.body)[1];
    // a post naming another site is refused, even with the real handle
    const foreign = await call((req, res) => publicApprove(req, res, { env, connect: make() }),
      request('POST', { step: 'approve', handle, choice: 'approve' }, { origin: 'https://evil.example.test' }));
    expect(foreign.statusCode).toBe(403);
    // our own page's post (some in-app browsers send no Origin at all) is answered with the hand-back page
    const ok = await call((req, res) => publicApprove(req, res, { env, connect: make() }), request('POST', { step: 'approve', handle, choice: 'approve' }));
    expect(ok.statusCode).toBe(200);
    expect(ok.headers.Location).toBeUndefined();
    const target = /http-equiv="refresh" content="0;url=([^"]+)"/.exec(ok.body)?.[1]?.replaceAll('&amp;', '&');
    expect(target).toContain(CB);
    expect(new URL(target).searchParams.get('code')).toBeTruthy();
    expect(ok.headers['Referrer-Policy']).toBe('no-referrer');
    // the same page posted again: a plain "expired" page, no detail
    const again = await call((req, res) => publicApprove(req, res, { env, connect: make() }), request('POST', { step: 'approve', handle, choice: 'approve' }));
    expect(again.statusCode).toBe(403);
    expect(again.body).toContain('This step has expired');
    expect(again.body).not.toMatch(/stack|sql|token/i);
    // an old consent form posted after this change gets a plain explanation
    const old = await call((req, res) => publicAuthorize(req, res, { env, connect: make() }), request('POST', { ...authorizeParams(client), form_csrf: 'x'.repeat(43) }));
    expect(old.statusCode).toBe(410);
    const off = await call((req, res) => publicAuthorize(req, res, { env: { ...env, GITHUB_PUBLIC_CONNECT: undefined } }), request('GET', authorizeParams(client)));
    expect(off.statusCode).toBe(404);
  });

  it('the MCP gate refuses a public connection once its client is deleted or the person is revoked', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const r = await approved(c, client, 'bob');
    const token = json(await exchange(client, codeOf(r)));
    expect(await gateFor(token)).not.toBeNull();
    expect(await resolvePrivateTenantMcpBearer({ authorization: 'Bearer tac_' + 'A'.repeat(86) + '_' + 'B'.repeat(43), env, fetchImpl, rootSqlFactory, tenantSqlFactory })).toBeNull();
    const sel = parsePublicCode(codeOf(r));
    expect(await directory.revokePilotIdentity(sel.tenantId, sel.identityId, sel.identityId)).toBe(true);
    expect(await gateFor(token)).toBeNull();
    const refresh = await call((req, res) => privateTenantToken(req, res, { env, rootSqlFactory, tenantSqlFactory }),
      request('POST', { grant_type: 'refresh_token', client_id: client.client_id, client_secret: client.client_secret, refresh_token: token.refresh_token, resource: ORIGIN + '/api/mcp' }));
    expect(refresh.statusCode).toBe(401);
    const other = await c.registerClient({ redirect_uris: [CB] });
    const t2 = await tokenFor(c, other, 'alice');
    expect(await directory.deletePublicClient(other.client_id)).toBe(true);
    expect(await gateFor(t2)).toBeNull();
  });
});

describe('PUB-6 branding', () => {
  it('shows the Robinson look and icon on the pages and lists the icon on the MCP server', async () => {
    const { serverInfo, BRAND_CSS, iconBytes } = await import('../../src/brand/brand.js');
    const page = await call((req, res) => publicManage(req, res, { env, connect: make() }), request('GET', { manage: '1' }));
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
    const erinTenant = await admin.query("SELECT count(*)::int n FROM gh_tenant_identities WHERE provider_subject='31005'");
    expect(erinTenant.rows[0].n).toBe(0);
    // A personal installation whose account id is not the signed-in person is refused too.
    const spoof = { ...people.erin.installs[0], account: { id: 99999, login: 'someone-else', type: 'User' } };
    const saved = people.erin.installs;
    people.erin.installs = [spoof];
    expect((await (await signIn(c, client, 'erin')).finished).install).toBeDefined();
    people.erin.installs = saved;
  });
});

describe('PUB-6 letting the assistant make changes', () => {
  it('default: changes are on for the accounts the person owns, still gated; Read-only ticked: preview only', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const tokenOn = await tokenFor(c, client, 'alice');
    const routedOn = await gateFor(tokenOn);
    const grantOn = await routedOn.db.getAccessToken(tokenOn.access_token);
    expect(grantOn.mode).toBe('production');
    for (const login of grantOn.accounts) expect((await routedOn.db.getAccount(login)).production_enabled).toBe(true);
    const tokenOff = await tokenFor(c, client, 'alice', { readOnly: true });
    // Read-only is the read_only profile (every change tool refused), not only preview mode (review finding on #337)
    expect((await (await gateFor(tokenOff)).db.getAccessToken(tokenOff.access_token))).toMatchObject({ mode: 'preview', profile: 'read_only' });
  });
});

describe('My connection', () => {
  const manageSignIn = async (c, who) => {
    const started = await c.startManage();
    expect(new URL(started.url).origin + new URL(started.url).pathname).toBe('https://github.com/login/oauth/authorize');
    return c.finish({ state: started.state, code: who + '-fixture-code-1' });
  };

  it('someone who never connected is told so and is not enrolled', async () => {
    const c = make();
    people.newbie = { token: 'tok-newbie-07', id: 31007, login: 'newbie', installs: [] };
    const before = (await admin.query('SELECT count(*)::int AS n FROM gh_tenant_identities')).rows[0].n;
    expect(await manageSignIn(c, 'newbie')).toEqual({ manage: { none: true, signedInAs: 'newbie' } });
    expect((await admin.query('SELECT count(*)::int AS n FROM gh_tenant_identities')).rows[0].n).toBe(before);
  });

  it('adds a newly installed account to an app that is already connected, without reconnecting', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB], client_name: 'Claude' });
    const token = await tokenFor(c, client, 'dave');
    expect((await (await gateFor(token)).db.getAccessToken(token.access_token)).accounts).toEqual(['client-co']);
    const page = await manageSignIn(c, 'dave');
    expect(page.manage.offers).toEqual([{ login: 'dave-solo', id: 31006, type: 'User' }]);
    expect(page.manage.connections.map((x) => x.name)).toEqual(['Claude']);
    // "Add dave-solo" sends the person to GitHub's install page aimed at that account
    const added = await c.manageAction({ handle: page.manage.handle, action: 'add', value: 'dave-solo' });
    const addUrl = new URL(added.go);
    expect(addUrl.href).toMatch(/^https:\/\/github\.com\/apps\/public-connect-app\/installations\/new\?state=pc\./);
    expect(addUrl.searchParams.get('suggested_target_id')).toBe('31006');
    // the page handle was used up
    await expect(c.manageAction({ handle: page.manage.handle, action: 'refresh' })).rejects.toThrow();
    // back from installing, the person signs in once more (silently) and lands on My connection with both accounts
    people.dave.installs.push({ id: 41051, app_id: APP, account: { id: 31006, login: 'dave-solo', type: 'User' }, repository_selection: 'all', suspended_at: null });
    const resumed = await c.resumeInstall({ state: addUrl.searchParams.get('state') });
    const back = await c.finish({ state: resumed.state, code: 'dave-fixture-code-1' });
    expect(back.manage.accounts.map((a) => a.login).sort()).toEqual(['client-co', 'dave-solo']);
    expect(back.manage.offers).toEqual([]);
    expect((await (await gateFor(token)).db.getAccessToken(token.access_token)).accounts).toEqual(['client-co', 'dave-solo']);
    people.dave.installs.pop();
  });

  it('read-only switch, time zone and disconnect act on this person only; bad values are refused', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB], client_name: 'ChatGPT' });
    const alice = await tokenFor(c, client, 'alice'), bob = await tokenFor(c, client, 'bob');
    let page = (await manageSignIn(c, 'alice')).manage;
    page = (await c.manageAction({ handle: page.handle, action: 'read_only' })).manage;
    expect(page.notice).toMatch(/can now look, but not change anything/);
    expect(await (await gateFor(alice)).db.getAccessToken(alice.access_token)).toMatchObject({ mode: 'preview', profile: 'read_only' });
    expect(await (await gateFor(bob)).db.getAccessToken(bob.access_token)).toMatchObject({ mode: 'production', profile: 'full' });
    // the switch still covers an app whose one-hour access lapsed but can renew it, and refresh keeps the choice
    const aliceDb = (await gateFor(alice)).db;
    const refreshed = await call((req, res) => privateTenantToken(req, res, { env, rootSqlFactory, tenantSqlFactory }),
      request('POST', { grant_type: 'refresh_token', client_id: client.client_id, client_secret: client.client_secret, refresh_token: alice.refresh_token, resource: ORIGIN + '/api/mcp' }));
    expect(refreshed.statusCode).toBe(200);
    const alice2 = json(refreshed);
    expect(await aliceDb.getAccessToken(alice2.access_token)).toMatchObject({ mode: 'preview', profile: 'read_only' });
    page = (await c.manageAction({ handle: page.handle, action: 'allow_changes' })).manage;
    expect(await (await gateFor(alice2)).db.getAccessToken(alice2.access_token)).toMatchObject({ mode: 'production', profile: 'full' });
    Object.assign(alice, alice2);
    await expect(c.manageAction({ handle: page.handle, action: 'time_zone', value: 'Mars/Base' })).rejects.toThrow();
    page = (await manageSignIn(c, 'alice')).manage;
    page = (await c.manageAction({ handle: page.handle, action: 'time_zone', value: 'America/Denver' })).manage;
    expect(page.timeZone).toBe('America/Denver');
    expect(await (await gateFor(alice)).db.getSetting('time_zone')).toBe('America/Denver');
    expect(await (await gateFor(bob)).db.getSetting('time_zone')).toBeNull();
    // an app whose one-hour access has lapsed (but can still renew) is still listed and can be disconnected (review finding on #337)
    const sel = parsePublicCode(codeOf(await approved(c, client, 'alice')));
    const tdb = await tenantOf(sel);
    await (await import('../../src/tenancy/directory.js')).openAuthorizedTenantDb({ directory, tenantId: sel.tenantId, verifiedIdentityId: sel.identityId, connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory })
      .then(({ sql }) => sql`UPDATE oauth_tokens SET expires_at = now() - interval '1 minute' WHERE kind = 'connector'`);
    expect((await tdb.listConnections()).filter((x) => x.kind === 'connector')).toEqual([]);
    page = (await manageSignIn(c, 'alice')).manage;
    expect(page.connections.map((x) => x.name)).toContain('ChatGPT');
    // only this person's own apps can be disconnected; another value is refused
    await expect(c.manageAction({ handle: page.handle, action: 'disconnect', value: 'pcl_not_mine_at_all_000000000000' })).rejects.toThrow();
    page = (await manageSignIn(c, 'alice')).manage;
    const target = page.connections.find((x) => x.name === 'ChatGPT');
    page = (await c.manageAction({ handle: page.handle, action: 'disconnect', value: target.clientId })).manage;
    expect(page.notice).toMatch(/Disconnected/);
    expect(await gateFor(alice)).toBeNull();
    expect(await gateFor(bob)).not.toBeNull();
    // a handle from someone else's page, or a made-up action, is refused
    await expect(c.manageAction({ handle: page.handle, action: 'drop_tables' })).rejects.toThrow();
  });

  it('web page: a GitHub sign-in button, posts refused from another site, no cookies', async () => {
    const start = await call((req, res) => publicManage(req, res, { env, connect: make() }), request('GET', { manage: '1' }));
    expect(start.statusCode).toBe(200);
    expect(start.body).toContain('Sign in with GitHub');
    expect(start.headers['Set-Cookie']).toBeUndefined();
    const go = await call((req, res) => publicManage(req, res, { env, connect: make() }), request('GET', { manage: '1', go: '1' }));
    expect(go.statusCode).toBe(302);
    expect(go.headers.Location).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
    const state = new URL(go.headers.Location).searchParams.get('state');
    const page = await call((req, res) => publicCallback(req, res, { env, connect: make() }), request('GET', { state, code: 'alice-fixture-code-1' }));
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('My connection');
    expect(page.body).toContain('Delete my data');
    const handle = /name="handle" value="([^"]+)"/.exec(page.body)[1];
    const foreign = await call((req, res) => publicManage(req, res, { env, connect: make() }),
      request('POST', { handle, action: 'read_only', value: '' }, { origin: 'https://evil.example.test' }));
    expect(foreign.statusCode).toBe(403);
    const master = await call((req, res) => publicManage(req, res, { env, connect: make() }), request('POST', { handle, action: 'master', value: '' }, { origin: ORIGIN }));
    expect(master.statusCode).toBe(303);
    expect(master.headers.Location).toMatch(new RegExp('^' + ORIGIN + '/api/tenant/optional\\?master_link='));
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
    await put(people2[1].tenant_id, 72, 'error', 4);
    await put(people2[1].tenant_id, 24 * 20, 'ok', 99);
    const { publicUsageSummary } = await import('../../src/tenancy/usage-summary.js');
    const out = await publicUsageSummary(rootSqlFactory(), { connectionString: process.env.TEST_DATABASE_URL, sqlFactory: tenantSqlFactory });
    expect(out.peopleConnected).toBeGreaterThanOrEqual(2);
    expect(out.unreadable).toBe(0);
    expect(out.lastDay.ok).toBeGreaterThanOrEqual(15);
    expect(out.lastDay.refused).toBeGreaterThanOrEqual(2);
    expect(out.lastDay.throttled).toBeGreaterThanOrEqual(1);
    expect(out.lastWeek.errors).toBeGreaterThanOrEqual(4);
    expect(out.lastWeek.calls).toBe(out.lastWeek.ok + out.lastWeek.refused + out.lastWeek.throttled + out.lastWeek.errors);
    expect(JSON.stringify(out)).not.toMatch(/alice|bob|tok-|@/);
  });
});

describe('PUB-6 owner deletes one public person\'s data', () => {
  it('removes that person completely, keeps everyone else, and refuses organization names', async () => {
    const { forgetPublicPerson, findPublicTenantsByLogin } = await import('../../src/tenancy/forget-person.js');
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const alice = await tokenFor(c, client, 'alice'), bob = await tokenFor(c, client, 'bob');
    expect(await gateFor(alice)).not.toBeNull(); expect(await gateFor(bob)).not.toBeNull();
    const opts = { connectionString: process.env.TEST_DATABASE_URL, sqlFactory: tenantSqlFactory };
    const aliceTenant = await admin.query("SELECT tenant_id FROM gh_tenant_pilot_bootstraps b JOIN gh_tenant_identities i ON i.id=b.identity_id WHERE b.account_login='public-connect' AND i.provider_subject=$1", ['31001']).then((r) => r.rows[0].tenant_id);
    const schemaExists = async (id) => (await admin.query('SELECT 1 FROM information_schema.schemata WHERE schema_name=$1', [tenantSchemaName(String(id))])).rowCount === 1;
    expect(await schemaExists(aliceTenant)).toBe(true);
    expect(await findPublicTenantsByLogin(rootSqlFactory(), 'client-co', opts)).toEqual([]);
    expect(await forgetPublicPerson(directory, rootSqlFactory(), 'nobody-here', opts)).toBe(0);
    await expect(forgetPublicPerson(directory, rootSqlFactory(), 'bad name!', opts)).rejects.toThrow();
    expect(await forgetPublicPerson(directory, rootSqlFactory(), 'alice-dev', opts)).toBe(1);
    expect(await schemaExists(aliceTenant)).toBe(false);
    for (const table of ['gh_tenants', 'gh_tenant_memberships', 'gh_tenant_pilot_bootstraps', 'gh_tenant_pilot_allowlist']) {
      const col = table === 'gh_tenants' ? 'id' : 'tenant_id';
      expect((await admin.query(`SELECT 1 FROM ${table} WHERE ${col}=$1`, [aliceTenant])).rowCount).toBe(0);
    }
    expect((await admin.query("SELECT 1 FROM gh_tenant_identities WHERE provider_subject='31001'")).rowCount).toBe(0);
    expect(await gateFor(alice)).toBeNull();
    expect(await gateFor(bob)).not.toBeNull();
    expect(await directory.forgetPublicTenant(aliceTenant)).toBe(false);
    const priv = await admin.query("SELECT tenant_id FROM gh_tenant_pilot_bootstraps WHERE account_login<>'public-connect' LIMIT 1").then((r) => r.rows[0]);
    if (priv) await expect(directory.forgetPublicTenant(String(priv.tenant_id))).rejects.toThrow();
    expect(await gateFor(await tokenFor(c, client, 'alice'))).not.toBeNull();
  });
});

describe('PUB-6 a person deletes their own data', () => {
  it('needs a GitHub sign-in, one use of the confirm step, and removes only that person', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const alice = await tokenFor(c, client, 'alice'), bob = await tokenFor(c, client, 'bob');
    expect(await gateFor(alice)).not.toBeNull();
    const signInToForget = async (who) => {
      const started = await c.startForget();
      expect(new URL(started.url).origin + new URL(started.url).pathname).toBe('https://github.com/login/oauth/authorize');
      return c.finish({ state: started.state, code: who + '-fixture-code-1' });
    };
    const before = (await admin.query('SELECT count(*)::int AS n FROM gh_tenant_identities')).rows[0].n;
    expect(await signInToForget('erin')).toEqual({ forget: { none: true } });
    expect((await admin.query('SELECT count(*)::int AS n FROM gh_tenant_identities')).rows[0].n).toBe(before);
    await expect(c.begin(authorizeParams({ client_id: FORGET_CLIENT }))).rejects.toThrow();
    const asked = await signInToForget('alice');
    expect(asked.forget).toMatchObject({ signedInAs: 'alice-dev' });
    // a confirm handle is not an Approve or My connection handle, and using it wrongly spends it
    await expect(c.approve({ handle: asked.forget.handle, choice: 'approve' })).rejects.toThrow();
    await expect(c.forgetConfirm({ handle: asked.forget.handle })).rejects.toThrow();
    const again = await signInToForget('alice');
    expect(await c.forgetConfirm({ handle: again.forget.handle })).toBe(true);
    await expect(c.forgetConfirm({ handle: again.forget.handle })).rejects.toThrow();
    expect(await gateFor(alice)).toBeNull();
    expect(await gateFor(bob)).not.toBeNull();
    expect(await signInToForget('alice')).toEqual({ forget: { none: true } });
  });
  it('shows plain-English pages, needs no cookie, and refuses a post from another site', async () => {
    const connect = make();
    const page = await call((req, res) => publicForget(req, res, { env, connect }), request('GET', { forget: '1' }));
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Delete my data');
    expect(page.headers['Set-Cookie']).toBeUndefined();
    const start = await call((req, res) => publicForget(req, res, { env, connect }), request('POST', { forget: '1', action: 'start' }, { origin: ORIGIN }));
    expect(start.statusCode).toBe(303);
    expect(start.headers.Location).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
    const foreign = await call((req, res) => publicForget(req, res, { env, connect }), request('POST', { forget: '1', action: 'start' }, { origin: 'https://evil.example.test' }));
    expect(foreign.statusCode).toBe(403);
    const off = await call((req, res) => publicForget(req, res, { env: { ...env, GITHUB_PUBLIC_CONNECT: undefined }, connect }), request('GET', { forget: '1' }));
    expect(off.statusCode).toBe(404);
  });
});

describe('GOD-1 the master token (one classic token, kind M)', () => {
  const scopesHeader = (value) => ({ get: (name) => (String(name).toLowerCase() === 'x-oauth-scopes' ? value : null) });
  const fetchMaster = (scopes) => async (url, opts) => {
    const out = await fetchImpl(url, opts);
    if (url === 'https://api.github.com/user' && scopes !== undefined) return { ...out, headers: scopesHeader(scopes) };
    return out;
  };
  const enrollmentWith = async (fetchFn) => {
    const { createPrivateOptionalEnrollment } = await import('../../src/tenancy/optional-setup.js');
    const { openAuthorizedTenantDb } = await import('../../src/tenancy/directory.js');
    return createPrivateOptionalEnrollment({ env, fetchImpl: fetchFn, directoryFactory: () => createTenantDirectory(rootSqlFactory()),
      tenantAccess: (dir, claim) => openAuthorizedTenantDb({ directory: dir, tenantId: claim.tenantId, verifiedIdentityId: claim.identityId, connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory }) });
  };
  /** The master-token form as My connection opens it (the link it 303s to). */
  const masterFormFromMyConnection = async (c, who, enrollment) => {
    const started = await c.startManage();
    const page = await c.finish({ state: started.state, code: who + '-fixture-code-1' });
    const { go } = await c.manageAction({ handle: page.manage.handle, action: 'master' });
    return enrollment.startMasterLink(new URL(go).searchParams.get('master_link'));
  };

  it('is added from My connection, must be the same person and a classic token, and then K/P and any API call can use it', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const token = await tokenFor(c, client, 'alice');
    const enrollment = await enrollmentWith(fetchMaster('repo, notifications, gist'));
    const form = await masterFormFromMyConnection(c, 'alice', enrollment);
    expect(form.kind).toBe('M');
    // someone else's token is refused, and the state is spent
    await expect(enrollment.finish({ state: form.state, action: 'save', value: people.bob.token })).rejects.toThrow();
    await expect(enrollment.finish({ state: form.state, action: 'save', value: people.alice.token })).rejects.toThrow();
    // a token with no classic permission header (fine-grained) is refused
    const plain = await enrollmentWith(fetchMaster(''));
    const form2 = await masterFormFromMyConnection(c, 'alice', plain);
    await expect(plain.finish({ state: form2.state, action: 'save', value: people.alice.token })).rejects.toThrow();
    // the right person, a classic token: saved, a plain return (no new login), usable at once by the existing connection
    const form3 = await masterFormFromMyConnection(c, 'alice', enrollment);
    const saved = await enrollment.finish({ state: form3.state, action: 'save', value: people.alice.token });
    expect(saved.status).toBe('read-observed-at-enrollment');
    expect(new URL(saved.destination).searchParams.get('code')).toBeNull();
    const credentials = (await gateFor(token)).credentials;
    const status = await credentials.masterStatus();
    expect(status.enrolled).toBe(true);
    expect(status.scopes).toEqual(['repo', 'notifications', 'gist']);
    expect(JSON.stringify(status)).not.toContain(people.alice.token);
    expect(await credentials.authorizeOptionalRequest({ account: 'alice-dev', kind: 'M', method: 'POST', url: 'https://api.github.com/user/gists' })).toBe(true);
    await expect(credentials.authorizeOptionalRequest({ account: 'alice-dev', kind: 'M', method: 'GET', url: 'https://evil.example/user' })).rejects.toThrow();
    await expect(credentials.authorizeOptionalRequest({ account: 'alice-dev', kind: 'M', method: 'GET', url: 'https://user:pw@api.github.com/user' })).rejects.toThrow();
    expect(await credentials.token({ account: 'alice-dev', cred: 'M' })).toBe(people.alice.token);
    await expect(credentials.token({ account: 'alice-dev', cred: 'M', scope: { repositories: ['x'] } })).rejects.toThrow();
    expect(await credentials.token({ account: 'alice-dev', cred: 'K' })).toBe(people.alice.token);
    expect(await credentials.authorizeOptionalRequest({ account: 'alice-dev', kind: 'K', method: 'GET', url: 'https://api.github.com/notifications?per_page=1' })).toBe(true);
    await expect(credentials.authorizeOptionalRequest({ account: 'alice-dev', kind: 'K', method: 'POST', url: 'https://api.github.com/user/gists' })).rejects.toThrow();
    expect(await credentials.authorizeOptionalRequest({ account: 'client-co', kind: 'P', method: 'GET', url: 'https://api.github.com/orgs/client-co/packages' })).toBe(true);
    await expect(credentials.authorizeOptionalRequest({ account: 'client-co', kind: 'P', method: 'GET', url: 'https://api.github.com/orgs/other-org/packages' })).rejects.toThrow();
    // My connection shows it is there (never the token)
    const page = await c.finish({ state: (await c.startManage()).state, code: 'alice-fixture-code-1' });
    expect(page.manage.master).toMatchObject({ added: true });
    expect(page.manage.master.unlocks).toContainEqual({ area: 'Gists', unlocked: true });
    expect(JSON.stringify(page)).not.toContain(people.alice.token);
    // another person's connection has none
    const bobRouted = await gateFor(await tokenFor(c, client, 'bob'));
    expect((await bobRouted.credentials.masterStatus()).enrolled).toBe(false);
    await expect(bobRouted.credentials.token({ account: 'bob-test', cred: 'M' })).rejects.toThrow();
  });

  it('never works for a read-only connection or a narrowed scope, and the legacy owner vault has no master token', async () => {
    const { credentialFor, CREDENTIAL_KINDS } = await import('../../src/github/client.js');
    expect(CREDENTIAL_KINDS).toContain('M');
    const ctx = (profile) => ({ connection: { profile, accounts: ['alice-dev'], default_account: 'alice-dev' },
      credentials: { token: async () => 'fake-token-value', authorizeOptionalRequest: async () => true } });
    await expect(credentialFor(ctx('read_only'), { owner: 'alice-dev', cred: 'M' })).rejects.toThrow(/master token/);
    await expect(credentialFor(ctx('full'), { owner: 'alice-dev', cred: 'M', scope: { repositories: ['x'] } })).rejects.toThrow(/master token/);
    await expect(credentialFor({ ...ctx('full'), connection: { ...ctx('full').connection, pass: true } }, { owner: 'alice-dev', cred: 'M' })).rejects.toThrow();
    expect((await credentialFor(ctx('full'), { owner: 'alice-dev', cred: 'M' })).token).toBe('fake-token-value');
  });

  it('can be added or removed at any time with the assistant\'s private one-use link, without reconnecting', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const enrollment = await enrollmentWith(fetchMaster('repo, admin:org'));
    const routed = await gateFor(await tokenFor(c, client, 'dave'));
    expect((await routed.credentials.masterStatus()).enrolled).toBe(false);
    const made = await routed.credentials.masterLink({ clientId: client.client_id, redirectUri: CB });
    expect(made.url.startsWith(ORIGIN + '/api/tenant/optional?master_link=')).toBe(true);
    const handle = new URL(made.url).searchParams.get('master_link');
    const form = await enrollment.startMasterLink(handle);
    expect(form.kind).toBe('M');
    await expect(enrollment.startMasterLink(handle)).rejects.toThrow();
    await expect(enrollment.startMasterLink('x'.repeat(43))).rejects.toThrow();
    const saved = await enrollment.finish({ state: form.state, action: 'save', value: people.dave.token });
    expect(saved.status).toBe('read-observed-at-enrollment');
    expect(new URL(saved.destination).searchParams.get('code')).toBeNull();
    expect(await routed.credentials.masterStatus()).toMatchObject({ enrolled: true, scopes: ['repo', 'admin:org'] });
    const again = await enrollment.startMasterLink(new URL((await routed.credentials.masterLink({ clientId: client.client_id, redirectUri: CB })).url).searchParams.get('master_link'));
    await expect(enrollment.finish({ state: again.state, action: 'revoke', value: people.bob.token })).rejects.toThrow();
    const again2 = await enrollment.startMasterLink(new URL((await routed.credentials.masterLink({ clientId: client.client_id, redirectUri: CB })).url).searchParams.get('master_link'));
    const gone = await enrollment.finish({ state: again2.state, action: 'revoke', value: people.dave.token });
    expect(gone.status).toBe('revoked-on-this-service');
    expect((await routed.credentials.masterStatus()).enrolled).toBe(false);
  });

  it('the GitHub link has every permission ticked', async () => {
    const { masterTokenLink, MASTER_SCOPES } = await import('../../src/tenancy/master-credential.js');
    const link = new URL(masterTokenLink());
    expect(link.origin + link.pathname).toBe('https://github.com/settings/tokens/new');
    expect(link.searchParams.get('scopes').split(',')).toEqual([...MASTER_SCOPES]);
    const { default: optional } = await import('../../api/tenant/optional.js');
    expect(typeof optional).toBe('function');
  });
});

describe('GOD-1 the master token lasts exactly as long as the person set it on GitHub', () => {
  it('keeps no limit of ours: no expiry header means it never expires; a dated one is kept as given; an already-expired one is refused', async () => {
    const { createPrivateOptionalEnrollment } = await import('../../src/tenancy/optional-setup.js');
    const { openAuthorizedTenantDb } = await import('../../src/tenancy/directory.js');
    const withHeaders = (extra) => async (url, opts) => {
      const out = await fetchImpl(url, opts);
      if (url !== 'https://api.github.com/user') return out;
      return { ...out, headers: { get: (n) => ({ 'x-oauth-scopes': 'repo, gist', ...extra })[String(n).toLowerCase()] ?? null } };
    };
    const enroll = (fetchFn) => createPrivateOptionalEnrollment({ env, fetchImpl: fetchFn, directoryFactory: () => createTenantDirectory(rootSqlFactory()),
      tenantAccess: (dir, claim) => openAuthorizedTenantDb({ directory: dir, tenantId: claim.tenantId, verifiedIdentityId: claim.identityId, connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory }) });
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const routed = await gateFor(await tokenFor(c, client, 'bob'));
    const save = async (fetchFn) => {
      const link = await routed.credentials.masterLink({ clientId: client.client_id, redirectUri: CB });
      const form = await enroll(fetchFn).startMasterLink(new URL(link.url).searchParams.get('master_link'));
      return enroll(fetchFn).finish({ state: form.state, action: 'save', value: people.bob.token });
    };
    await expect(save(withHeaders({ 'github-authentication-token-expiration': '2020-01-01 00:00:00 UTC' }))).rejects.toThrow();
    expect((await routed.credentials.masterStatus()).enrolled).toBe(false);
    await save(withHeaders({ 'github-authentication-token-expiration': '2031-05-06 07:08:09 UTC' }));
    expect((await routed.credentials.masterStatus()).expires_at ?? (await routed.credentials.masterStatus()).expiresAt).toBe('2031-05-06T07:08:09.000Z');
    await save(withHeaders({}));
    const never = await routed.credentials.masterStatus();
    expect(never.enrolled).toBe(true);
    expect(never.expires_at).toBeNull();
    expect(await routed.credentials.token({ account: 'bob-test', cred: 'M' })).toBe(people.bob.token);
  });
});

describe('GOD-4 cancelling leaked tokens (github_credential_revoke)', () => {
  const revokeCalls = [];
  const fetchRevoke = (status = 202) => async (url, opts) => {
    if (url === 'https://api.github.com/credentials/revoke') { revokeCalls.push(JSON.parse(opts.body)); return new Response('{}', { status, headers: { 'content-type': 'application/json' } }); }
    return fetchImpl(url, opts);
  };
  const enrollmentWith = async (fetchFn) => {
    const { createPrivateOptionalEnrollment } = await import('../../src/tenancy/optional-setup.js');
    const { openAuthorizedTenantDb } = await import('../../src/tenancy/directory.js');
    return createPrivateOptionalEnrollment({ env, fetchImpl: fetchFn, directoryFactory: () => createTenantDirectory(rootSqlFactory()),
      tenantAccess: (dir, claim) => openAuthorizedTenantDb({ directory: dir, tenantId: claim.tenantId, verifiedIdentityId: claim.identityId, connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory }) });
  };
  const open = async (routed, client, enrollment) => {
    const made = await routed.credentials.revokeLink({ clientId: client.client_id, redirectUri: CB });
    expect(made.url.startsWith(ORIGIN + '/api/tenant/optional?revoke_link=')).toBe(true);
    return enrollment.startRevokeLink(new URL(made.url).searchParams.get('revoke_link'));
  };
  const LEAK1 = 'ghp_FAKEleakedtokenAAAA1111', LEAK2 = 'github_pat_FAKEleakedtokenBBBB2222';

  it('opens a one-use form, sends the pasted tokens to GitHub once, and only ever reports their last four characters', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const enrollment = await enrollmentWith(fetchRevoke());
    const routed = await gateFor(await tokenFor(c, client, 'dave'));
    const made = await routed.credentials.revokeLink({ clientId: client.client_id, redirectUri: CB });
    const handle = new URL(made.url).searchParams.get('revoke_link');
    const form = await enrollment.startRevokeLink(handle);
    expect(form.kind).toBe('R');
    await expect(enrollment.startRevokeLink(handle)).rejects.toThrow(); // the link works once
    await expect(enrollment.startRevokeLink('x'.repeat(43))).rejects.toThrow();
    const out = await enrollment.revokeLeaked({ state: form.state, value: LEAK1 + '\n' + LEAK2 + '\n' + LEAK1 });
    expect(out).toMatchObject({ accepted: true, status: 202, count: 2, last4: ['1111', '2222'] });
    expect(JSON.stringify(out)).not.toContain('FAKEleaked');
    expect(revokeCalls).toEqual([{ credentials: [LEAK1, LEAK2] }]);
    await expect(enrollment.revokeLeaked({ state: form.state, value: LEAK1 })).rejects.toThrow(); // the form works once
    expect(revokeCalls).toHaveLength(1);
  });

  it('refuses before any GitHub call: other kinds of link, bad input, too many tokens; and reports a GitHub refusal honestly', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const enrollment = await enrollmentWith(fetchRevoke(422));
    const routed = await gateFor(await tokenFor(c, client, 'dave'));
    revokeCalls.length = 0;
    // a master-token link cannot open the revoke form, and the other way round
    const masterHandle = new URL((await routed.credentials.masterLink({ clientId: client.client_id, redirectUri: CB })).url).searchParams.get('master_link');
    await expect(enrollment.startRevokeLink(masterHandle)).rejects.toThrow();
    const revokeHandle = new URL((await routed.credentials.revokeLink({ clientId: client.client_id, redirectUri: CB })).url).searchParams.get('revoke_link');
    await expect(enrollment.startMasterLink(revokeHandle)).rejects.toThrow();
    // the form handle is not a link and the link is not a form
    const form = await open(routed, client, enrollment);
    for (const value of ['', 'short', 'has a\u0001control char', Array.from({ length: 26 }, (_, i) => 'ghp_FAKE' + String(i).padStart(8, '0')).join('\n')]) {
      const f = await open(routed, client, enrollment);
      await expect(enrollment.revokeLeaked({ state: f.state, value })).rejects.toThrow();
    }
    expect(revokeCalls).toEqual([]);
    const rejected = await enrollment.revokeLeaked({ state: form.state, value: LEAK1 });
    expect(rejected).toMatchObject({ accepted: false, status: 422, count: 1, last4: ['1111'] });
  });

  it('the page renders the form and the result without ever echoing a pasted token', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const enrollment = await enrollmentWith(fetchRevoke());
    const routed = await gateFor(await tokenFor(c, client, 'dave'));
    const { makePrivateOptionalPage } = await import('../../api/tenant/optional.js');
    const handler = makePrivateOptionalPage({ env, enrollment });
    const res = () => { const r = { headers: {}, code: 0, body: '', setHeader(k, v) { r.headers[k] = v; }, status(n) { r.code = n; return r; }, send(b) { r.body = String(b); return r; }, end() { return r; } }; return r; };
    const made = await routed.credentials.revokeLink({ clientId: client.client_id, redirectUri: CB });
    const get = res();
    await handler({ method: 'GET', query: { revoke_link: new URL(made.url).searchParams.get('revoke_link') }, headers: {} }, get);
    expect(get.code).toBe(200);
    expect(get.body).toContain('name="value"');
    const state = get.body.match(/name="csrf" value="([A-Za-z0-9_-]{43})"/)[1];
    const post = res();
    await handler({ method: 'POST', body: { csrf: state, action: 'revoke_leaked', value: LEAK1 }, headers: { origin: ORIGIN } }, post);
    expect(post.code).toBe(200);
    expect(post.body).toContain('1111');
    expect(post.body).not.toContain('FAKEleaked');
    expect(get.body).not.toContain('FAKEleaked');
  });
});
