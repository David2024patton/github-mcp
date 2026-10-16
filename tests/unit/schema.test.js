import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONNECTION_FIELDS, SCHEMA_TABLES, connectionSettings, createDb } from '../../src/db.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';

afterEach(() => { vi.unstubAllEnvs(); });

describe('foundation schema constants', () => {
  it('lists the declared foundation and additive tables, frozen, without duplicates', () => {
    expect(SCHEMA_TABLES.length).toBeGreaterThanOrEqual(19);
    expect(new Set(SCHEMA_TABLES).size).toBe(SCHEMA_TABLES.length);
    expect(Object.isFrozen(SCHEMA_TABLES)).toBe(true);
    expect(SCHEMA_TABLES[0]).toBe('gh_apps');
    expect(SCHEMA_TABLES).toContain('dev_run_objects');
    expect(SCHEMA_TABLES).toContain('dev_run_intents');
    expect(SCHEMA_TABLES).toContain('secret_entry_requests');
    expect(SCHEMA_TABLES).toContain('dev_runs');
  });

  it('names the per-connection fields every token refresh copies', () => {
    expect(CONNECTION_FIELDS).toEqual(['default_account', 'accounts', 'mode', 'profile', 'listing']);
    expect(Object.isFrozen(CONNECTION_FIELDS)).toBe(true);
  });

  it('connectionSettings picks exactly those fields, copies arrays and nulls missing values', () => {
    const accounts = ['Robinson-AI-Systems', 'christcr2012'];
    const row = { token_hash: 'abc', default_account: 'Robinson-AI-Systems', accounts, mode: 'production', profile: 'full', listing: 'compact', expires_at: 'x' };
    const settings = connectionSettings(row);
    expect(Object.keys(settings)).toEqual(CONNECTION_FIELDS);
    expect(settings).toEqual({ default_account: 'Robinson-AI-Systems', accounts, mode: 'production', profile: 'full', listing: 'compact' });
    expect(settings.accounts).not.toBe(accounts);
    expect(connectionSettings({})).toEqual({ default_account: null, accounts: null, mode: null, profile: null, listing: null });
    expect(connectionSettings(undefined).mode).toBeNull();
  });
});

describe('createDb', () => {
  it('importing src/db.js without DATABASE_URL does not throw (the module is already imported above)', () => {
    expect(typeof createDb).toBe('function');
  });

  it('rejects a query function that is not a function', () => {
    expect(() => createDb('x')).toThrow(TypeError);
    expect(() => createDb(null)).toThrow(TypeError);
    expect(() => createDb({})).toThrow(TypeError);
  });

  it('without DATABASE_URL gives the plain configuration message, only when called', () => {
    vi.stubEnv('DATABASE_URL', '');
    expect(() => createDb()).toThrow('DATABASE_URL is not configured. Set it in the server environment.');
  });

  it('creates every declared table and only static additive statements without hardcoded migration counts', async () => {
    const statements = [];
    const sql = async (strings, ...values) => {
      expect(values).toEqual([]);
      statements.push(strings.join(''));
      return [];
    };
    await createDb(sql).initSchema();
    const indexes = statements.filter((s) => /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS /.test(s));
    // Additive column additions (ADD COLUMN IF NOT EXISTS, never a drop or a rewrite) are the only ALTER allowed.
    const columns = statements.filter((s) => /^ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS /.test(s));
    expect(statements).toHaveLength(SCHEMA_TABLES.length + indexes.length + columns.length);
    const created = statements.filter((s) => /^CREATE TABLE IF NOT EXISTS /.test(s)).map((s) => s.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)[1]);
    expect(created).toEqual([...SCHEMA_TABLES]);
    expect(statements.filter((s) => /^CREATE INDEX IF NOT EXISTS change_log_request_key /.test(s))).toHaveLength(1);
    expect(statements.filter((s) => /^CREATE UNIQUE INDEX IF NOT EXISTS change_log_request_once .*WHERE dry_run = FALSE AND request_key IS NOT NULL/.test(s))).toHaveLength(1);
    expect(statements.filter((s) => /^CREATE INDEX IF NOT EXISTS dev_runs_scope /.test(s))).toHaveLength(1);
    expect(statements.filter((s) => /^CREATE INDEX IF NOT EXISTS dev_run_objects_pending /.test(s))).toHaveLength(1);
    expect(statements.filter((s) => /^CREATE INDEX IF NOT EXISTS dev_forwarders_scope /.test(s))).toHaveLength(1);
    expect(statements.filter((s) => /^CREATE INDEX IF NOT EXISTS result_store_expires /.test(s))).toHaveLength(1);
    for (const statement of statements) expect(statement.replace(/^ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS /, '')).not.toMatch(/\b(DROP|DELETE|TRUNCATE|INSERT|UPDATE)\b|ALTER\s/i);
  });

  it('listTables returns the table names the database reports', async () => {
    const sql = async () => [{ table_name: 'a' }, { table_name: 'b' }];
    expect(await createDb(sql).listTables()).toEqual(['a', 'b']);
  });
});

describe('fake database', () => {
  it('initSchema twice yields the same listTables', async () => {
    const db = createFakeDb();
    expect(await db.listTables()).toEqual([]);
    await db.initSchema();
    const first = await db.listTables();
    await db.initSchema();
    expect(await db.listTables()).toEqual(first);
    expect(first).toEqual([...SCHEMA_TABLES].sort());
  });

  it('keeps put and get', async () => {
    const db = createFakeDb();
    await db.put('k', { a: [1] });
    expect(await db.get('k')).toEqual({ a: [1] });
    expect(await db.get('missing')).toBeNull();
  });
});
