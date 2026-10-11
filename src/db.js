// Foundation database layer (A-2). Lazy Neon client plus the additive foundation schema of docs/designs/BATCH-A.md §2.
// Every statement is a static tagged template (no string building) and uses IF NOT EXISTS: running initSchema() twice
// changes nothing, and nothing here ever drops, alters or deletes. Credentials are ciphertext (*_enc) or hashes
// (*_hash) only; no column holds a plain token, key or secret.
import { neon } from '@neondatabase/serverless';

/** The 13 foundation tables, in BATCH-A §2 order. Later batches add their own tables and their own lists. */
export const SCHEMA_TABLES = Object.freeze([
  'gh_apps',
  'gh_accounts',
  'gh_installation_tokens',
  'setup_states',
  'oauth_clients',
  'oauth_codes',
  'oauth_tokens',
  'login_attempts',
  'change_log',
  'one_time_secrets',
  'gh_rate_state',
  'gh_write_slots',
  'gh_etag_cache'
]);

/**
 * The per-connection settings a login stores and every token refresh must copy forward (Robinson Tool Contract §2).
 * A-3 copies every one of these when it refreshes a token.
 */
export const CONNECTION_FIELDS = Object.freeze(['default_account', 'accounts', 'mode', 'profile', 'listing']);

/** Pick exactly the CONNECTION_FIELDS from a stored oauth_codes / oauth_tokens row (missing values become null). */
export function connectionSettings(row) {
  const settings = {};
  for (const field of CONNECTION_FIELDS) {
    const value = row?.[field];
    settings[field] = Array.isArray(value) ? [...value] : (value ?? null);
  }
  return settings;
}

/** The production Neon HTTP client. Created on first use, never at import time. */
export function productionSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured. Set it in the server environment.');
  return neon(url);
}

/**
 * @param {Function} [sql] a Neon-shaped tagged-template query function (the production client by default)
 * @returns {{ initSchema(): Promise<void>, listTables(): Promise<string[]> }}
 */
export function createDb(sql = productionSql()) {
  if (typeof sql !== 'function') throw new TypeError('createDb needs a Neon-shaped tagged-template query function.');

  return {
    /** Creates the foundation tables and index if they are missing. One statement per call (Neon's HTTP driver). */
    async initSchema() {
      await sql`CREATE TABLE IF NOT EXISTS gh_apps (
        id BIGINT PRIMARY KEY,
        slug TEXT NOT NULL,
        owner_login TEXT NOT NULL,
        owner_type TEXT NOT NULL,
        client_id TEXT NOT NULL,
        client_secret_enc TEXT NOT NULL,
        private_key_enc TEXT NOT NULL,
        webhook_secret_enc TEXT NOT NULL,
        permissions JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS gh_accounts (
        login TEXT PRIMARY KEY,
        account_id BIGINT NOT NULL UNIQUE,
        account_type TEXT NOT NULL,
        label TEXT NOT NULL,
        credential_kind TEXT NOT NULL DEFAULT 'app',
        app_id BIGINT,
        installation_id BIGINT,
        repository_selection TEXT,
        installation_permissions JSONB,
        installation_status TEXT NOT NULL DEFAULT 'none',
        user_login TEXT,
        user_token_enc TEXT,
        user_token_expires_at TIMESTAMPTZ,
        user_refresh_enc TEXT,
        user_refresh_expires_at TIMESTAMPTZ,
        fine_grained_enc TEXT,
        fine_grained_last4 TEXT,
        fine_grained_expires_at TIMESTAMPTZ,
        classic_enc TEXT,
        classic_scopes TEXT[],
        classic_last4 TEXT,
        plan_name TEXT,
        production_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        spend_limit_cents INTEGER NOT NULL DEFAULT 0,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        is_scratch BOOLEAN NOT NULL DEFAULT FALSE,
        added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        checked_at TIMESTAMPTZ
      )`;
      await sql`CREATE TABLE IF NOT EXISTS gh_installation_tokens (
        installation_id BIGINT NOT NULL,
        scope_key TEXT NOT NULL,
        token_enc TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (installation_id, scope_key)
      )`;
      await sql`CREATE TABLE IF NOT EXISTS setup_states (
        state TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        account_hint TEXT,
        code_verifier_enc TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS oauth_codes (
        code TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        data JSONB NOT NULL,
        default_account TEXT,
        accounts TEXT[],
        mode TEXT NOT NULL DEFAULT 'preview',
        profile TEXT NOT NULL DEFAULT 'everyday',
        listing TEXT NOT NULL DEFAULT 'catalog',
        expires_at TIMESTAMPTZ NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS oauth_tokens (
        token_hash TEXT PRIMARY KEY,
        client_id TEXT,
        refresh_hash TEXT,
        default_account TEXT,
        accounts TEXT[],
        mode TEXT NOT NULL DEFAULT 'preview',
        profile TEXT NOT NULL DEFAULT 'everyday',
        listing TEXT NOT NULL DEFAULT 'catalog',
        kind TEXT NOT NULL DEFAULT 'connector',
        expires_at TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS login_attempts (
        id BIGSERIAL PRIMARY KEY,
        ip TEXT NOT NULL,
        attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        success BOOLEAN NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS change_log (
        id BIGSERIAL PRIMARY KEY,
        at TIMESTAMPTZ NOT NULL DEFAULT now(),
        account TEXT,
        repo TEXT,
        mode TEXT,
        connection TEXT,
        tool TEXT NOT NULL,
        target TEXT,
        summary TEXT NOT NULL,
        before JSONB,
        after JSONB,
        dry_run BOOLEAN NOT NULL DEFAULT FALSE,
        confirmed BOOLEAN,
        production BOOLEAN NOT NULL DEFAULT FALSE,
        access_widening BOOLEAN NOT NULL DEFAULT FALSE,
        notifies TEXT[],
        spend_cents BIGINT,
        request_key TEXT,
        github_request_id TEXT,
        inverse JSONB,
        undone_by BIGINT
      )`;
      await sql`CREATE INDEX IF NOT EXISTS change_log_request_key ON change_log (request_key, at)`;
      await sql`CREATE TABLE IF NOT EXISTS one_time_secrets (
        id TEXT PRIMARY KEY,
        account TEXT,
        kind TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        viewed_at TIMESTAMPTZ
      )`;
      await sql`CREATE TABLE IF NOT EXISTS gh_rate_state (
        account TEXT NOT NULL,
        resource TEXT NOT NULL,
        remaining INTEGER,
        reset_at TIMESTAMPTZ,
        blocked_until TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (account, resource)
      )`;
      await sql`CREATE TABLE IF NOT EXISTS gh_write_slots (
        installation_key TEXT PRIMARY KEY,
        next_write_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS gh_etag_cache (
        account TEXT NOT NULL,
        url_key TEXT NOT NULL,
        etag TEXT NOT NULL,
        body JSONB NOT NULL,
        stored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (account, url_key)
      )`;
    },

    /** Names of the tables in the connection's current schema, sorted. */
    async listTables() {
      const rows = await sql`SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`;
      return rows.map((row) => row.table_name);
    }
  };
}
