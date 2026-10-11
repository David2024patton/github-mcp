// Adapted from Robinson-AI-Systems/stripe-mcp test/helpers/fake-db.js @ 6cb3f64; A-2 adds the GitHub MCP foundation schema.
// Service-independent in-memory fake of createDb(): key/value rows plus the recorded foundation tables.
import { SCHEMA_TABLES } from '../../src/db.js';

export function createFakeDb() {
  const rows = new Map();
  const tables = new Set();
  return {
    async initSchema() { for (const name of SCHEMA_TABLES) tables.add(name); },
    async listTables() { return [...tables].sort(); },
    async put(key, value) { rows.set(key, structuredClone(value)); },
    async get(key) { return rows.has(key) ? structuredClone(rows.get(key)) : null; }
  };
}
