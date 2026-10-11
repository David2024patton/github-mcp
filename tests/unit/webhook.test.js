import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createCredentials } from '../../src/github/credentials.js';
import { createWebhookHandler, signatureMatches, readRawBody } from '../../src/github/webhook.js';
import { handleWebhook } from '../../src/github/routes.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { json, response } from '../../test/helpers/http-harness.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const ENV = { TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64url') };
const SECRET = 'fixture-webhook-secret-value';
const CONVERSION = { id: 5150, slug: 'robinson-mcp-example-org', client_id: 'Iv1.fixtureclientid', client_secret: 'fixture-client-secret-value',
  pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), webhook_secret: SECRET, permissions: {} };

async function build() {
  const db = createFakeDb();
  await db.initSchema();
  const credentials = createCredentials({ db, env: ENV, fetch });
  await credentials.storeApp(CONVERSION, { ownerLogin: 'example-org', ownerType: 'Organization' });
  await db.upsertAccount({ login: 'example-org', accountId: 1001, accountType: 'Organization', label: 'Example Org', credentialKind: 'app', appId: 5150 });
  return { db, credentials, handler: createWebhookHandler({ db, credentials }) };
}
const sign = (raw, secret = SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
function delivery(event, payload, { secret = SECRET, target = '5150', method = 'POST', headers = {}, raw } = {}) {
  const body = raw ?? Buffer.from(JSON.stringify(payload));
  return Object.assign(Readable.from([body]), { method, headers: { 'x-github-event': event, 'x-github-hook-installation-target-id': target, 'x-hub-signature-256': sign(body, secret), ...headers } });
}
const run = async (handler, req) => { const res = response(); await handler(req, res); return res; };
const INSTALL = { id: 777, account: { login: 'example-org' }, repository_selection: 'all', permissions: { contents: 'write' }, suspended_at: null };

describe('webhook signatures', () => {
  it('accepts only an exact sha256 signature over the raw bytes', () => {
    const raw = Buffer.from('{"a":1}');
    expect(signatureMatches(SECRET, raw, sign(raw))).toBe(true);
    expect(signatureMatches(SECRET, Buffer.from('{"a": 1}'), sign(raw))).toBe(false);
    expect(signatureMatches('other', raw, sign(raw))).toBe(false);
    for (const bad of [undefined, '', 'sha1=abc', 'sha256=zz', `sha256=${'0'.repeat(63)}`, sign(raw).toUpperCase()]) expect(signatureMatches(SECRET, raw, bad)).toBe(false);
    expect(signatureMatches('', raw, sign(raw, ''))).toBe(false);
  });

  it('refuses an oversized body while reading it', async () => {
    await expect(readRawBody(Readable.from([Buffer.alloc(20), Buffer.alloc(20)]), 30)).rejects.toMatchObject({ status: 413 });
  });
});

describe('webhook deliveries', () => {
  it('answers 401 and stores nothing for a bad, missing or foreign signature, an unknown App, or a missing App id', async () => {
    const t = await build();
    for (const req of [
      delivery('installation', { action: 'created', installation: INSTALL }, { secret: 'wrong-secret' }),
      delivery('installation', { action: 'created', installation: INSTALL }, { headers: { 'x-hub-signature-256': undefined } }),
      delivery('installation', { action: 'created', installation: INSTALL }, { target: '9999' }),
      delivery('installation', { action: 'created', installation: INSTALL }, { target: 'abc' }),
      delivery('installation', { action: 'created', installation: INSTALL }, { target: '' })
    ]) {
      const res = await run(t.handler, req);
      expect(res.statusCode).toBe(401);
    }
    expect((await t.db.getAccount('example-org')).installation_id).toBeNull();
  });

  it('refuses other methods', async () => {
    const t = await build();
    const res = await run(t.handler, delivery('ping', {}, { method: 'GET' }));
    expect(res.statusCode).toBe(405);
  });

  it('answers a ping, and acknowledges but ignores any other event', async () => {
    const t = await build();
    expect((await run(t.handler, delivery('ping', { zen: 'x' }))).statusCode).toBe(200);
    const ignored = await run(t.handler, delivery('push', { ref: 'refs/heads/main' }));
    expect(ignored.statusCode).toBe(202);
    expect(json(ignored)).toEqual({ ok: true, ignored: true });
    expect((await t.db.getAccount('example-org')).installation_id).toBeNull();
  });

  it('records an installation, then follows suspend, unsuspend, new permissions and deletion', async () => {
    const t = await build();
    await t.db.putInstallationToken(777, 'all', 'sealed', new Date(Date.now() + 3600e3));
    expect((await run(t.handler, delivery('installation', { action: 'created', installation: INSTALL }))).statusCode).toBe(200);
    expect(await t.db.getAccount('example-org')).toMatchObject({ installation_id: 777, installation_status: 'active', repository_selection: 'all' });
    expect(await t.db.getInstallationToken(777, 'all')).toBeNull();

    await run(t.handler, delivery('installation', { action: 'suspend', installation: { ...INSTALL, suspended_at: '2026-10-10T00:00:00Z' } }));
    expect((await t.db.getAccount('example-org')).installation_status).toBe('suspended');
    await run(t.handler, delivery('installation', { action: 'unsuspend', installation: INSTALL }));
    expect((await t.db.getAccount('example-org')).installation_status).toBe('active');
    await run(t.handler, delivery('installation', { action: 'new_permissions_accepted', installation: { ...INSTALL, permissions: { contents: 'write', issues: 'write' } } }));
    expect((await t.db.getAccount('example-org')).installation_permissions).toEqual({ contents: 'write', issues: 'write' });
    await run(t.handler, delivery('installation_repositories', { action: 'removed', installation: { ...INSTALL, repository_selection: 'selected' } }));
    expect((await t.db.getAccount('example-org')).repository_selection).toBe('selected');
    await run(t.handler, delivery('installation', { action: 'deleted', installation: INSTALL }));
    expect((await t.db.getAccount('example-org')).installation_status).toBe('none');
  });

  it('never records an installation on an account that does not own the App, or an action it does not know', async () => {
    const t = await build();
    const stranger = await run(t.handler, delivery('installation', { action: 'created', installation: { ...INSTALL, account: { login: 'someone-else' } } }));
    expect(stranger.statusCode).toBe(200);
    expect(json(stranger).ignored).toBe(true);
    const odd = await run(t.handler, delivery('installation', { action: 'something_new', installation: INSTALL }));
    expect(json(odd).ignored).toBe(true);
    expect(await t.db.getAccount('example-org')).toMatchObject({ installation_id: null, installation_status: 'none' });
  });

  it('keeps a newer installation when an old installation is reported deleted', async () => {
    const t = await build();
    await t.db.setInstallation('example-org', { installationId: 888, repositorySelection: 'all', permissions: {}, status: 'active' });
    await run(t.handler, delivery('installation', { action: 'deleted', installation: INSTALL }));
    expect(await t.db.getAccount('example-org')).toMatchObject({ installation_id: 888, installation_status: 'active' });
  });

  it('drops the owner sign-in when GitHub says it was revoked, and only then', async () => {
    const t = await build();
    await t.credentials.storeUserAuthorization('example-org', { userLogin: 'example-owner', accessToken: 'ghu_FAKEuserToken1', expiresIn: 28800, refreshToken: 'ghr_FAKErefresh1', refreshExpiresIn: 15811200 });
    await run(t.handler, delivery('github_app_authorization', { action: 'other', sender: { login: 'x' } }));
    expect((await t.db.getAccount('example-org')).user_login).toBe('example-owner');
    expect((await run(t.handler, delivery('github_app_authorization', { action: 'revoked', sender: { login: 'example-owner' } }))).statusCode).toBe(200);
    expect((await t.db.getAccount('example-org')).user_login ?? null).toBeNull();
  });

  it('answers 400 for a signed body that is not a JSON object', async () => {
    const t = await build();
    for (const raw of [Buffer.from('not json'), Buffer.from('[1,2]'), Buffer.from('null')]) {
      expect((await run(t.handler, delivery('installation', null, { raw }))).statusCode).toBe(400);
    }
  });

  it('answers 503 with no detail when storage fails after the signature was accepted, and when nothing is configured', async () => {
    const t = await build();
    t.db.setInstallation = async () => { throw new Error('postgres://user:password@host/db'); };
    const failed = await run(t.handler, delivery('installation', { action: 'created', installation: INSTALL }));
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain('postgres');
    const res = response();
    await handleWebhook(delivery('ping', {}), res, { runtime: { get db() { throw new Error('secret detail'); } } });
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('secret detail');
  });
});
