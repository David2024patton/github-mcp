// Copied from Robinson-AI-Systems/stripe-mcp src/core/crypto.js @ 90a49c0 (contract-generic; the hub's robinson-mcp-core will replace this copy).
// Portable, fail-closed authenticated encryption. Never logs or returns credential material in errors.
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export function readEncryptionKey(env = process.env) {
  const encoded = env.TOKEN_ENCRYPTION_KEY;
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/_-]{42,44}={0,2}$/.test(encoded)) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be configured as a base64-encoded 32-byte key');
  }
  const key = Buffer.from(encoded, 'base64url');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes');
  return key;
}
/** Older keys still accepted for READING during a key change (comma-separated base64 32-byte keys, at most two).
 * New values are always sealed with the current key, so old keys can be dropped once nothing sealed with them is left. */
export function readPreviousKeys(env = process.env) {
  const raw = env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const parts = raw.split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length > 2) throw new Error('TOKEN_ENCRYPTION_KEY_PREVIOUS may list at most two keys');
  return parts.map((encoded) => {
    if (!/^[A-Za-z0-9+/_-]{42,44}={0,2}$/.test(encoded)) throw new Error('TOKEN_ENCRYPTION_KEY_PREVIOUS must list base64-encoded 32-byte keys');
    const key = Buffer.from(encoded, 'base64url');
    if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY_PREVIOUS must list keys of exactly 32 bytes');
    return key;
  });
}
function assertContext(aad) {
  if (typeof aad !== 'string' || !aad) throw new TypeError('A nonempty encryption context is required');
}
export function encryptSecret(value, { aad, key = readEncryptionKey() } = {}) {
  assertContext(aad);
  if (typeof value !== 'string' || !value) throw new TypeError('A nonempty secret is required');
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new TypeError('Invalid encryption key');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url')].join('.');
}
function openEnvelope(envelope, aad, key) {
  const [v, nonce, tag, payload, extra] = String(envelope).split('.');
  if (v !== 'v1' || extra !== undefined || !nonce || !tag || !payload) throw new Error();
  const iv = Buffer.from(nonce, 'base64url'), authTag = Buffer.from(tag, 'base64url');
  if (iv.length !== 12 || authTag.length !== 16) throw new Error();
  const cipher = createDecipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  cipher.setAuthTag(authTag);
  return Buffer.concat([cipher.update(Buffer.from(payload, 'base64url')), cipher.final()]).toString('utf8');
}
export function decryptSecret(envelope, { aad, key = readEncryptionKey() } = {}) {
  assertContext(aad);
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new TypeError('Invalid encryption key');
  // The current key first; during a key change the previous key(s) are tried too. Every attempt is authenticated
  // (AES-GCM with the same context), so a wrong key can never return wrong plaintext.
  let candidates = [key];
  try { candidates = [key, ...readPreviousKeys()]; } catch { /* a bad previous-key setting is ignored here and never weakens the current key */ }
  for (const candidate of candidates) {
    try { return openEnvelope(envelope, aad, candidate); } catch { /* try the next key */ }
  }
  throw new Error('Unable to decrypt a saved secret. Verify the server encryption key.');
}
