import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, readEncryptionKey } from '../../src/core/crypto.js';
import { createOneTimeStore } from '../../src/core/one-time-secrets.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';

const keyOf = () => randomBytes(32);
const envFor = (key) => ({ TOKEN_ENCRYPTION_KEY: key.toString('base64url') });

describe('encryption (AES-256-GCM)', () => {
  it('round-trips, uses a fresh nonce each time and never contains the plaintext', () => {
    const key = keyOf();
    const a = encryptSecret('fixture-secret-value', { aad: 'ctx/a', key });
    const b = encryptSecret('fixture-secret-value', { aad: 'ctx/a', key });
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(a).not.toContain('fixture-secret-value');
    expect(decryptSecret(a, { aad: 'ctx/a', key })).toBe('fixture-secret-value');
  });

  it('refuses the wrong key, the wrong context, tampering and junk with one plain message that holds no secret', () => {
    const key = keyOf();
    const sealed = encryptSecret('fixture-secret-value', { aad: 'ctx/a', key });
    const [v, iv, tag, payload] = sealed.split('.');
    const tampered = [v, iv, tag, Buffer.from('x' + Buffer.from(payload, 'base64url').toString('latin1')).toString('base64url')].join('.');
    for (const attempt of [
      () => decryptSecret(sealed, { aad: 'ctx/a', key: keyOf() }), () => decryptSecret(sealed, { aad: 'ctx/b', key }),
      () => decryptSecret(tampered, { aad: 'ctx/a', key }), () => decryptSecret('junk', { aad: 'ctx/a', key }), () => decryptSecret(undefined, { aad: 'ctx/a', key })
    ]) {
      expect(attempt).toThrow('Unable to decrypt a saved secret. Verify the server encryption key.');
    }
    expect(() => encryptSecret('', { aad: 'ctx', key })).toThrow(TypeError);
    expect(() => encryptSecret('x', { aad: '', key })).toThrow(TypeError);
  });

  it('reads TOKEN_ENCRYPTION_KEY only when it is a base64 32-byte key and says what to set otherwise', () => {
    const key = keyOf();
    expect(readEncryptionKey(envFor(key)).equals(key)).toBe(true);
    for (const bad of [undefined, '', 'short', randomBytes(16).toString('base64url'), randomBytes(33).toString('base64url')]) {
      expect(() => readEncryptionKey({ TOKEN_ENCRYPTION_KEY: bad })).toThrow(/TOKEN_ENCRYPTION_KEY must be configured|exactly 32 bytes/);
    }
  });
});

describe('one-time secrets', () => {
  const make = async () => {
    const db = createFakeDb();
    await db.initSchema();
    return { db, store: createOneTimeStore({ db, service: 'github', setupPath: '/api/github/setup', encryptionKey: keyOf() }) };
  };

  it('issues a link, shows the secret once and then never again', async () => {
    const { store } = await make();
    const issued = await store.issue({ account: 'example-org', kind: 'webhook_secret', secret: 'fixture-webhook-secret' });
    expect(issued.setupPath).toBe(`/api/github/setup?show=${issued.id}`);
    expect(issued.id).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await store.consume(issued.id)).toEqual({ kind: 'webhook_secret', account: 'example-org', secret: 'fixture-webhook-secret' });
    expect(await store.consume(issued.id)).toBeNull();
  });

  it('stores only ciphertext, ties it to its id, account and kind, and expires after ten minutes', async () => {
    const { db, store } = await make();
    const stored = [];
    const original = db.addOneTimeSecret.bind(db);
    db.addOneTimeSecret = async (row) => { stored.push(row); return original(row); };
    const { id } = await store.issue({ account: 'example-org', kind: 'pass', secret: 'fixture-pass-value' });
    expect(JSON.stringify(stored)).not.toContain('fixture-pass-value');
    expect(stored[0].expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60e3);
    expect(stored[0].expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60e3);
    // A row moved to another account or kind cannot be opened.
    const row = await db.consumeOneTimeSecret(id);
    await db.addOneTimeSecret({ id, account: 'other-org', kind: row.kind, ciphertext: row.ciphertext, expiresAt: new Date(Date.now() + 60000) });
    await expect(store.consume(id)).rejects.toThrow('Unable to decrypt');
    const expired = await store.issue({ kind: 'k', secret: 'fixture-x' });
    const row2 = await db.consumeOneTimeSecret(expired.id);
    await db.addOneTimeSecret({ id: expired.id, account: row2.account, kind: row2.kind, ciphertext: row2.ciphertext, expiresAt: new Date(Date.now() - 1) });
    expect(await store.consume(expired.id)).toBeNull();
  });

  it('refuses malformed ids and missing parts', async () => {
    const { store, db } = await make();
    for (const id of [undefined, '', 'short', 'a'.repeat(33), '../etc/passwd'.padEnd(32, 'x')]) expect(await store.consume(id)).toBeNull();
    await expect(store.issue({ kind: '', secret: 'x' })).rejects.toThrow(TypeError);
    await expect(store.issue({ kind: 'k', secret: '' })).rejects.toThrow(TypeError);
    expect(() => createOneTimeStore({ db, service: '', setupPath: '/x', encryptionKey: keyOf() })).toThrow(TypeError);
    expect(() => createOneTimeStore({ db, service: 'github', setupPath: 'x', encryptionKey: keyOf() })).toThrow(TypeError);
  });
});
