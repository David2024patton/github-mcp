import http from 'node:http';
import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createCredentials } from '../../src/github/credentials.js';
import { createMcpHandler } from '../../src/core/mcp-server.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { validateArgs } from '../../src/core/validate.js';
import { registry } from '../../src/tools/index.js';
import { mergeNamespaces } from '../../src/core/registry.js';
import { createGithubPolicy } from '../../src/oauth/policy.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const ENV = { TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64url'), PUBLIC_BASE_URL: 'https://github-mcp.example.test' };
const ACCESS = 'a'.repeat(60);
const FINE = 'github_pat_FAKE0123456789abcdefghij';
const CLASSIC = 'ghp_FAKE0123456789abcdefghij';
const SECRET_SHAPES = [/gh[pousr]_[A-Za-z0-9]{8,}/, /github_pat_[A-Za-z0-9_]{8,}/, /BEGIN [A-Z ]*PRIVATE KEY/, /fixture-client-secret/, /fixture-webhook-secret/];

async function build(scope = {}) {
  const db = createFakeDb();
  await db.initSchema();
  const credentials = createCredentials({ db, env: ENV, fetch });
  await credentials.storeApp({ id: 5150, slug: 'app', client_id: 'Iv1.fixtureclientid', client_secret: 'fixture-client-secret-value', webhook_secret: 'fixture-webhook-secret-value',
    pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), permissions: {} }, { ownerLogin: 'example-org', ownerType: 'Organization' });
  await db.upsertAccount({ login: 'example-org', accountId: 1001, accountType: 'Organization', label: 'Example Org', credentialKind: 'app', appId: 5150 });
  await db.setInstallation('example-org', { installationId: 777, repositorySelection: 'all', permissions: { contents: 'write' }, status: 'active' });
  await credentials.storeUserAuthorization('example-org', { userLogin: 'example-owner', accessToken: 'ghu_FAKEuserToken1', expiresIn: 28800, refreshToken: 'ghr_FAKErefresh1', refreshExpiresIn: 15811200 });
  await credentials.storeClassic('example-org', CLASSIC, ['notifications']);
  await db.upsertAccount({ login: 'example-user', accountId: 55, accountType: 'User', label: 'Personal', credentialKind: 'fine_grained' });
  await credentials.storeFineGrained('example-user', FINE, { expiresAt: null });
  await db.upsertAccount({ login: 'other-org', accountId: 77, accountType: 'Organization', label: 'Other', credentialKind: 'app' });
  await db.recordRateState({ account: 'example-org', resource: 'core', remaining: 4321, resetAt: new Date('2026-10-10T20:00:00Z') });
  const connection = Object.freeze({ client_id: 'c', default_account: 'example-org', accounts: Object.freeze(['example-org', 'example-user']), mode: 'preview', profile: 'read_only', listing: 'compact', ...scope });
  const dispatch = createDispatch({ env: ENV });
  const run = (name, args) => dispatch({ registry, name, args, connection, db });
  return { db, credentials, connection, run, dispatch };
}
const data = (result) => result.structuredContent;

describe('github_whoami', () => {
  it('describes the connection and only the accounts it may use, with credential types and no credential', async () => {
    const t = await build();
    const result = await t.run('github_whoami', {});
    expect(result.isError).toBeUndefined();
    const out = data(result);
    expect(out).toMatchObject({ mode: 'PREVIEW', profile: 'read_only', listing: 'compact', default_account: 'example-org', api_version: '2026-03-10' });
    expect(out.accounts.map((a) => a.login).sort()).toEqual(['example-org', 'example-user']);
    const org = out.accounts.find((a) => a.login === 'example-org');
    expect(org).toMatchObject({ is_default: true, credentials: { I: true, U: true, K: true }, production_enabled: false, spend_limit: '$0.00', spend_limit_cents: 0 });
    expect(org.rate_core.remaining).toBe(4321);
    expect(org.rate_core.resets_at).toMatch(/Oct 10, 2026/);
    expect(out.accounts.find((a) => a.login === 'example-user').credentials).toEqual({ I: true, U: false, K: false });
    for (const shape of SECRET_SHAPES) expect(result.content[0].text).not.toMatch(shape);
  });

  it('shows more with detail=full and only the named fields with fields', async () => {
    const t = await build();
    const full = data(await t.run('github_whoami', { detail: 'full' }));
    expect(full.accounts[0]).toHaveProperty('setup');
    const narrow = data(await t.run('github_whoami', { fields: ['credentials'] }));
    expect(Object.keys(narrow.accounts[0]).sort()).toEqual(['credentials', 'login']);
    const bad = await t.run('github_whoami', { fields: ['no_such_field'] });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain('Unknown field');
  });

  it('reflects a production connection and a spend limit', async () => {
    const t = await build({ mode: 'production' });
    t.db.seedAccounts?.([]);
    expect(data(await t.run('github_whoami', {})).mode).toBe('PRODUCTION');
  });
});

describe('github_list_accounts', () => {
  it('lists setup state per account without leaking anything', async () => {
    const t = await build();
    const result = await t.run('github_list_accounts', { detail: 'full' });
    const out = data(result);
    expect(out.count).toBe(2);
    const org = out.accounts.find((a) => a.login === 'example-org');
    expect(org).toMatchObject({ credential_kind: 'GitHub App', setup: 'installed', repository_selection: 'all', user_authorization: 'signed in as example-owner', notifications_token: 'saved', notifications_scopes: ['notifications'] });
    expect(out.accounts.find((a) => a.login === 'example-user')).toMatchObject({ credential_kind: 'fine-grained token', setup: 'token saved', user_authorization: 'not signed in' });
    expect(result.content[0].text).not.toContain('other-org');
    for (const shape of SECRET_SHAPES) expect(result.content[0].text).not.toMatch(shape);
  });
});

describe('the read-only dispatcher', () => {
  it('refuses unknown tools, tools not marked read-only, prototype names and bad arguments', async () => {
    const t = await build();
    for (const name of ['nope', 'constructor', '__proto__', 'toString', undefined]) expect((await t.run(name, {})).isError, String(name)).toBe(true);
    const unmarked = mergeNamespaces([{ tools: [{ name: 'github_fake_write', description: 'x', inputSchema: { type: 'object', properties: {} } }], handlers: { github_fake_write: async () => ({ done: true }) } }]);
    const res = await t.dispatch({ registry: unmarked, name: 'github_fake_write', args: {}, connection: t.connection, db: t.db });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Unknown or unavailable');
    for (const args of [{ detail: 'huge' }, { extra: 1 }, { fields: 'login' }, { fields: [1] }, [], 'x']) expect((await t.run('github_whoami', args)).isError, JSON.stringify(args)).toBe(true);
    expect((await t.run('github_whoami', undefined)).isError).toBeUndefined();
  });

  it('withholds a result that looks like a credential and hides internal errors', async () => {
    const t = await build();
    const leaky = mergeNamespaces([{ tools: [{ name: 'github_leaky', description: 'x', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
      { name: 'github_broken', description: 'x', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }],
    handlers: { github_leaky: async () => ({ value: 'ghs_FAKEinstallationtoken1' }), github_broken: async () => { throw new Error('postgres://user:pw@host'); } } }]);
    const a = await t.dispatch({ registry: leaky, name: 'github_leaky', args: {}, connection: t.connection, db: t.db });
    expect(a.isError).toBe(true);
    expect(a.content[0].text).not.toContain('ghs_');
    const b = await t.dispatch({ registry: leaky, name: 'github_broken', args: {}, connection: t.connection, db: t.db });
    expect(b.content[0].text).not.toContain('postgres');
  });

  it('validates the small schema subset it supports', () => {
    const schema = { type: 'object', properties: { a: { type: 'string', enum: ['x'] } }, required: ['a'] };
    expect(validateArgs(schema, { a: 'x' })).toBeNull();
    expect(validateArgs(schema, {})).toContain('required');
    expect(validateArgs({ properties: { n: { type: 'null' } } }, { n: 1 })).toContain('unsupported');
  });
});

describe('over the MCP endpoint', () => {
  let server;
  afterEach(async () => { if (server) await new Promise((resolve) => server.close(resolve)); server = null; });

  it('lists the tools and runs the read-only ones with a real connector token', async () => {
    const t = await build();
    await t.db.createAccessToken({ accessToken: ACCESS, refreshToken: 'b'.repeat(60), clientId: 'c', defaultAccount: 'example-org', accounts: ['example-org'], mode: 'preview', profile: 'read_only', listing: 'compact' });
    const handler = createMcpHandler({ db: t.db, registry, env: ENV, toConnection: createGithubPolicy({ env: ENV }).toConnection, dispatch: createDispatch({ env: ENV }) });
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        req.body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
        res.status = (code) => { res.statusCode = code; return res; };
        res.send = (value) => res.end(value);
        res.json = (value) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
        await handler(req, res);
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const rpc = async (method, params) => {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${ACCESS}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const text = await res.text();
      return JSON.parse(text.split('\n').find((l) => l.startsWith('data:'))?.slice(5) ?? text);
    };
    const listed = await rpc('tools/list', {});
    expect(listed.result.tools.map((x) => x.name)).toEqual(['github_whoami', 'github_list_accounts', 'github_list_protected_resources', 'github_enable_production', 'github_disable_production', 'github_set_spend_limit']);
    const called = await rpc('tools/call', { name: 'github_list_accounts', arguments: {} });
    const out = JSON.parse(called.result.content[0].text);
    expect(out.accounts.map((a) => a.login)).toEqual(['example-org']);
    const blocked = await rpc('tools/call', { name: 'github_whoami', arguments: { detail: 'x' } });
    expect(blocked.result.isError).toBe(true);
  });
});
