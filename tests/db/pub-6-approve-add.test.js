import crypto, { createHash } from 'node:crypto';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { createTenantDirectory, tenantSchemaName } from '../../src/tenancy/directory.js';
import { createPublicConnect } from '../../src/tenancy/public-connect.js';
import { publicApprove, publicCallback } from '../../src/tenancy/public-http.js';
import { encryptSecret } from '../../src/core/crypto.js';
import { call, request } from '../../test/helpers/http-harness.js';

// The Approve page can install the App on the person's other places (an account or organization they own that lacks it).
// Own harness (a fake GitHub with one person, a throwaway schema); same shape as pub-6-public-connect.test.js.
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

describe('Approve page: install the App on another place', () => {
  const start = async (c, client) => {
    const started = await c.begin(authorizeParams(client));
    return { started, finished: await c.finish({ state: started.state, code: 'dave-fixture-code-1' }) };
  };

  it('has an Add button per place without the App; Add goes to GitHub\'s install screen and comes back to Approve with it listed', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    const first = (await start(c, client)).finished;
    expect(first.approve.others).toEqual(['dave-solo']);
    // a place that was not offered is refused (the handle is single-use either way)
    await expect(c.approve({ handle: first.approve.handle, choice: 'add', value: 'not-offered' })).rejects.toThrow();
    const again = (await start(c, client)).finished;
    const added = await c.approve({ handle: again.approve.handle, choice: 'add', value: 'dave-solo' });
    const url = new URL(added.go);
    expect(url.href).toMatch(/^https:\/\/github\.com\/apps\/public-connect-app\/installations\/new\?state=pc\./);
    expect(url.searchParams.get('suggested_target_id')).toBe('31006');
    // back from installing: the silent sign-in lands on Approve listing both places, nothing left to add
    people.dave.installs.push({ id: 41052, app_id: APP, account: { id: 31006, login: 'dave-solo', type: 'User' }, repository_selection: 'all', suspended_at: null });
    try {
      const resumed = await c.resumeInstall({ state: url.searchParams.get('state') });
      const back = await c.finish({ state: resumed.state, code: 'dave-fixture-code-1' });
      expect(back.approve.accounts.map((a) => a.login).sort()).toEqual(['client-co', 'dave-solo']);
      expect(back.approve.others).toEqual([]);
    } finally { people.dave.installs.pop(); }
  });

  it('the page shows the Add button and posting it redirects to GitHub (no cookie, same-site only)', async () => {
    const c = make();
    const client = await c.registerClient({ redirect_uris: [CB] });
    // render the Approve page through the real callback
    const second = await c.begin(authorizeParams(client));
    const page = await call((req, res) => publicCallback(req, res, { env, connect: make() }), request('GET', { state: second.state, code: 'dave-fixture-code-1' }));
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('id="add-dave-solo"');
    expect(page.body).toContain('Add dave-solo');
    expect(page.headers['Set-Cookie']).toBeUndefined();
    const handle = /name="handle" value="([^"]+)"/.exec(page.body)[1];
    const foreign = await call((req, res) => publicApprove(req, res, { env, connect: make() }),
      request('POST', { step: 'approve', handle, choice: 'add', value: 'dave-solo' }, { origin: 'https://evil.example' }));
    expect(foreign.statusCode).toBe(403);
    const posted = await call((req, res) => publicApprove(req, res, { env, connect: make() }), request('POST', { step: 'approve', handle, choice: 'add', value: 'dave-solo' }));
    expect(posted.statusCode).toBe(303);
    expect(posted.headers.Location).toMatch(/^https:\/\/github\.com\/apps\/public-connect-app\/installations\/new\?state=pc\./);
    expect(posted.headers['Set-Cookie']).toBeUndefined();
  });
});
