// Adapted from Robinson-AI-Systems/stripe-mcp src/core/one-time-secrets.js @ 90a49c0: the service name and the setup path
// are parameters (contract-generic, imports nothing service-specific). A one-time secret is encrypted at rest, tied to its
// id, account and kind (so a stolen row cannot be re-labelled), shown once on the owner's setup page and deleted by the
// same statement that reads it. Never reveal one through an MCP tool.
import { randomBytes } from 'node:crypto';
import { encryptSecret, decryptSecret, readEncryptionKey } from './crypto.js';

export const ONE_TIME_SECRET_TTL_MS = 10 * 60 * 1000;
export const ONE_TIME_ID = /^[A-Za-z0-9_-]{32}$/;

/**
 * @param {{ db: object, service: string, setupPath: string, encryptionKey?: Buffer, now?: () => number }} options
 *   `db` provides `addOneTimeSecret({ id, account, kind, ciphertext, expiresAt })` and `consumeOneTimeSecret(id)`.
 */
export function createOneTimeStore({ db, service, setupPath, encryptionKey = readEncryptionKey(), now = Date.now }) {
  if (typeof service !== 'string' || !service || typeof setupPath !== 'string' || !setupPath.startsWith('/')) {
    throw new TypeError('createOneTimeStore needs a service name and a setup path');
  }
  const context = ({ id, account, kind }) => [`${service}-once`, id, account || '', kind].join('/');
  return {
    /** @returns {Promise<{ id: string, setupPath: string }>} where the owner can view the secret once, for ten minutes */
    async issue({ account = null, kind, secret }) {
      if (typeof kind !== 'string' || !kind || typeof secret !== 'string' || !secret) {
        throw new TypeError('Secret type and value are required');
      }
      const id = randomBytes(24).toString('base64url');
      const ciphertext = encryptSecret(secret, { aad: context({ id, account, kind }), key: encryptionKey });
      await db.addOneTimeSecret({ id, account, kind, ciphertext, expiresAt: new Date(now() + ONE_TIME_SECRET_TTL_MS) });
      return { id, setupPath: `${setupPath}?show=${encodeURIComponent(id)}` };
    },
    /** @returns {Promise<{ kind: string, account: string|null, secret: string }|null>} null when unknown, used or expired */
    async consume(id) {
      if (typeof id !== 'string' || !ONE_TIME_ID.test(id)) return null;
      const row = await db.consumeOneTimeSecret(id);
      if (!row) return null;
      const secret = decryptSecret(row.ciphertext, { aad: context({ id, account: row.account, kind: row.kind }), key: encryptionKey });
      return { kind: row.kind, account: row.account ?? null, secret };
    }
  };
}
