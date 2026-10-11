// Composition root for serverless entry points: one database handle per instance, schema created once per instance.
import { createDb } from './db.js';

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
