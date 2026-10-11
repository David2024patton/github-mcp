import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createWebhookHandler, verifySignature, MAX_BODY_BYTES } from '../../src/github/webhook.js';
import { createCredentials } from '../../src/github/credentials.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { call, json, response } from '../../test/helpers/http-harness.js';

// Every value is generated at run time or an obvious fixture; nothing secret-shaped is committed.
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const ENV = { TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64url') };
const SECRET = 'fixture-webhook-secret-value';
const APP = 424242;
const CONVERSION = { id: APP, slug: 'example-org-mcp', client_id: 'Iv1.fixtureclientid', client_secret: 'fixture-client-secret-value', pem: PEM, webhook_secret: SECRET, permissions: {} };

const sign = (body, secret = SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

async function setup({ linked = true } = {}) {
  const db = createFakeDb();
  await db.initSchema();
  const credentials = createCredentials({ db, env: ENV, fetch });
  await credentials.storeApp(CONVERSION, { ownerLogin: 'example-org', ownerType: 'Organization' });
  await db.upsertAccount({ login: 'example-org', accountId: 1001, accountType: 'Organization', label: 'Example Org', appId: APP });
  if (linked) await db.setInstallation('example-org', { installationId: 777, repositorySelection: 'selected', permissions: { contents: 'write' }, status: 'active' });
  await db.setUserAuthorization('example-org', { userLogin: 'Chris-Example', tokenEnc: 'x', tokenExpiresAt: new Date(), refreshEnc: 'y', refreshExpiresAt: new Date() });
  await db.putInstallationToken(777, 'all', 'ciphertext', new Date(Date.now() + 3_600_000));
  const handler = createWebhookHandler({ db, credentials });
  return { db, handler };
}

function post(event, payload, { app = APP, signature, secret, headers = {}, raw } = {}) {
  const body = raw ?? JSON.stringify(payload);
  return {
    method: 'POST', rawBody: body,
    headers: {
      'x-github-event': event, 'x-github-delivery': '5a1b2c3d-0000-4000-8000-000000000001',
      'x-github-hook-installation-target-id': String(app), 'x-hub-signature-256': signature ?? sign(body, secret), ...headers
    }
  };
}
const account = async (db) => (await db.listAccounts()).find((a) => a.login === 'example-org');

describe('verifySignature', () => {
  it('accepts only the exact HMAC and rejects malformed or missing input', () => {
    const body = Buffer.from('{"a":1}');
    expect(verifySignature(SECRET, body, sign(body))).toBe(true);
    expect(verifySignature(SECRET, body, sign(body, 'other-secret'))).toBe(false);
    expect(verifySignature(SECRET, Buffer.from('{"a":2}'), sign(body))).toBe(false);
    for (const bad of [undefined, '', 'sha256=', 'sha1=abc', `sha256=${'z'.repeat(64)}`, `sha256=${'0'.repeat(63)}`]) expect(verifySignature(SECRET, body, bad)).toBe(false);
    expect(verifySignature('', body, sign(body, ''))).toBe(false);
  });
});

describe('the webhook handler: refusals store nothing', () => {
  it('answers 401 for a bad, missing or malformed signature and for an App this server does not hold', async () => {
    const { db, handler } = await setup();
    const payload = { action: 'deleted', installation: { id: 777 } };
    const cases = [
      post('installation', payload, { signature: sign('tampered') }),
      post('installation', payload, { secret: 'wrong-secret' }),
      post('installation', payload, { headers: { 'x-hub-signature-256': undefined } }),
      post('installation', payload, { signature: 'sha256=nothex' }),
      post('installation', payload, { app: 999999 }),
      post('installation', payload, { headers: { 'x-github-hook-installation-target-id': 'abc' } }),
      post('installation', payload, { headers: { 'x-github-hook-installation-target-id': undefined } })
    ];
    for (const [i, req] of cases.entries()) {
      const res = await call(handler, req);
      expect(res.statusCode, `case ${i}`).toBe(401);
      expect(json(res)).toEqual({ error: 'invalid_signature' });
    }
    const row = await account(db);
    expect(row.installation_status).toBe('active');
    expect(row.installation_id).toBe(777);
  });

  it('answers 405 for GET, 413 for an oversized body (stream or buffer) and 400 for a signed body that is not JSON', async () => {
    const { handler } = await setup();
    expect((await call(handler, { method: 'GET', headers: {} })).statusCode).toBe(405);
    const big = 'x'.repeat(MAX_BODY_BYTES + 1);
    expect((await call(handler, post('installation', null, { raw: big }))).statusCode).toBe(413);
    const streamed = Object.assign(Readable.from([Buffer.from(big)]), { method: 'POST', headers: { 'x-github-hook-installation-target-id': String(APP) } });
    const res = response();
    await handler(streamed, res);
    expect(res.statusCode).toBe(413);
    expect((await call(handler, post('installation', null, { raw: 'not json' }))).statusCode).toBe(400);
  });

  it('reads a streamed body byte for byte, so the signature is over what GitHub sent', async () => {
    const { db, handler } = await setup();
    const body = JSON.stringify({ action: 'suspend', installation: { id: 777 } });
    const req = Object.assign(Readable.from([Buffer.from(body.slice(0, 10)), Buffer.from(body.slice(10))]), {
      method: 'POST', headers: { 'x-github-event': 'installation', 'x-github-hook-installation-target-id': String(APP), 'x-hub-signature-256': sign(body) }
    });
    const res = response();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect((await account(db)).installation_status).toBe('suspended');
  });

  it('answers 503 with no detail when the database fails', async () => {
    const { handler, db } = await setup();
    db.listAccounts = async () => { throw new Error('postgres://user:password@host/db exploded'); };
    const res = await call(handler, post('installation', { action: 'deleted', installation: { id: 777 } }));
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('postgres');
  });
});

describe('the webhook handler: each event updates the stored installation', () => {
  it('installation created links a known account of this App, and ignores unknown accounts', async () => {
    const { db, handler } = await setup({ linked: false });
    const unknown = await call(handler, post('installation', { action: 'created', installation: { id: 5, account: { login: 'stranger' }, repository_selection: 'all', permissions: {} } }));
    expect(json(unknown).result).toBe('ignored');
    expect((await account(db)).installation_status).toBe('none');
    const res = await call(handler, post('installation', { action: 'created', installation: { id: 888, account: { login: 'Example-Org' }, repository_selection: 'all', permissions: { contents: 'write', issues: 'read' } } }));
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ ok: true, result: 'updated' });
    const row = await account(db);
    expect(row).toMatchObject({ installation_id: 888, installation_status: 'active', repository_selection: 'all' });
    expect(row.installation_permissions).toEqual({ contents: 'write', issues: 'read' });
  });

  it('does not link an account that belongs to a different App', async () => {
    const { db, handler } = await setup({ linked: false });
    await db.upsertAccount({ login: 'other-org', accountId: 2002, accountType: 'Organization', label: 'Other', appId: 111 });
    const res = await call(handler, post('installation', { action: 'created', installation: { id: 9, account: { login: 'other-org' }, repository_selection: 'all', permissions: {} } }));
    expect(json(res).result).toBe('ignored');
    expect((await db.listAccounts()).find((a) => a.login === 'other-org').installation_status).toBe('none');
  });

  it('suspend, unsuspend and deleted change the status; suspend and deleted also drop cached installation tokens', async () => {
    const { db, handler } = await setup();
    await call(handler, post('installation', { action: 'suspend', installation: { id: 777 } }));
    expect((await account(db)).installation_status).toBe('suspended');
    expect(await db.getInstallationToken(777, 'all')).toBeNull();
    await call(handler, post('installation', { action: 'unsuspend', installation: { id: 777 } }));
    expect((await account(db)).installation_status).toBe('active');
    await db.putInstallationToken(777, 'all', 'ciphertext', new Date(Date.now() + 3_600_000));
    await call(handler, post('installation', { action: 'deleted', installation: { id: 777 } }));
    expect((await account(db)).installation_status).toBe('none');
    expect(await db.getInstallationToken(777, 'all')).toBeNull();
  });

  it('new_permissions_accepted stores the new permissions and drops cached tokens; a suspended installation stays suspended', async () => {
    const { db, handler } = await setup();
    await call(handler, post('installation', { action: 'new_permissions_accepted', installation: { id: 777, repository_selection: 'selected', permissions: { contents: 'write', pull_requests: 'write' } } }));
    const row = await account(db);
    expect(row.installation_permissions).toEqual({ contents: 'write', pull_requests: 'write' });
    expect(row.installation_status).toBe('active');
    expect(await db.getInstallationToken(777, 'all')).toBeNull();
    await db.setInstallationStatus('example-org', 'suspended');
    await call(handler, post('installation', { action: 'new_permissions_accepted', installation: { id: 777, permissions: { contents: 'read' } } }));
    expect((await account(db)).installation_status).toBe('suspended');
  });

  it('installation_repositories updates the repository selection and keeps permissions and status', async () => {
    const { db, handler } = await setup();
    const res = await call(handler, post('installation_repositories', { action: 'added', repository_selection: 'all', installation: { id: 777 } }));
    expect(json(res).result).toBe('updated');
    expect(await account(db)).toMatchObject({ repository_selection: 'all', installation_status: 'active', installation_permissions: { contents: 'write' } });
    const bad = await call(handler, post('installation_repositories', { action: 'added', repository_selection: 'everything', installation: { id: 777 } }));
    expect(json(bad).result).toBe('ignored');
  });

  it('github_app_authorization revoked clears that user\'s stored authorization only', async () => {
    const { db, handler } = await setup();
    const other = await call(handler, post('github_app_authorization', { action: 'revoked', sender: { login: 'someone-else' } }));
    expect(json(other).result).toBe('ignored');
    expect((await account(db)).has_user_token).toBe(true);
    const res = await call(handler, post('github_app_authorization', { action: 'revoked', sender: { login: 'chris-example' } }));
    expect(json(res).result).toBe('updated');
    const row = await account(db);
    expect(row.has_user_token).toBe(false);
    expect(row.user_login).toBeNull();
  });

  it('ignores every other event and unknown installations, and never echoes the payload or secret', async () => {
    const { db, handler } = await setup();
    const before = JSON.stringify(await account(db));
    for (const [event, payload] of [['push', { ref: 'refs/heads/main' }], ['ping', { zen: 'x' }], ['installation', { action: 'deleted', installation: { id: 31337 } }], ['installation', { action: 'weird', installation: { id: 777 } }], ['installation', {}], ['installation', null]]) {
      const res = await call(handler, post(event, payload));
      expect(res.statusCode, event).toBe(200);
      expect(json(res).result).toBe('ignored');
      expect(res.body).not.toContain(SECRET);
    }
    expect(JSON.stringify(await account(db))).toBe(before);
  });
});
