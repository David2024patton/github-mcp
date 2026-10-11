// Composition root for serverless entry points: one database handle per instance, schema created once per instance.
import { createDb } from './db.js';
import { createCredentials } from './github/credentials.js';
import { createOneTimeStore } from './core/one-time-secrets.js';
import { readEncryptionKey } from './core/crypto.js';

let ready = null;

/** The shared database, with `initSchema()` done once per instance (idempotent, additive). A failure is not cached. */
export function getDb() {
  if (!ready) {
    ready = (async () => {
      const db = createDb();
      await db.initSchema();
      return db;
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

/** The credential store and one-time-secret store for this instance. The one-time store is absent when no encryption key is set. */
export async function getSecretsRuntime({ env = process.env, fetch = globalThis.fetch } = {}) {
  const db = await getDb();
  const credentials = createCredentials({ db, env, fetch });
  let oneTimeStore;
  if (credentials.keyConfigured()) {
    oneTimeStore = createOneTimeStore({ db, service: 'github', setupPath: '/api/github/setup', encryptionKey: readEncryptionKey(env) });
  }
  return { db, credentials, oneTimeStore };
}
