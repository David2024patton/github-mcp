// Foundation database layer (A-2). Lazy Neon client plus the additive foundation schema of docs/designs/BATCH-A.md §2.
// Every statement is a static tagged template (no string building) and uses IF NOT EXISTS: running initSchema() twice
// changes nothing, and nothing here ever drops, alters or deletes. Credentials are ciphertext (*_enc) or hashes
// (*_hash) only; no column holds a plain token, key or secret.
import { neon } from '@neondatabase/serverless';
import { hashToken } from './core/oauth.js';

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

/** Cached bodies larger than this are not kept (A9). */
export const ETAG_BODY_LIMIT_BYTES = 256 * 1024;

export const CONNECTION_MODES = Object.freeze(['preview', 'production']);
export const CONNECTION_PROFILES = Object.freeze(['read_only', 'everyday', 'full']);
export const CONNECTION_LISTINGS = Object.freeze(['catalog', 'compact']);

/**
 * Validates the settings a login chose before they are written to a code or token row (BATCH-A A6): at least one
 * allowed account, a default account that is one of them, and known mode, profile and listing values.
 * Whether `production` is allowed for those accounts is decided by the login endpoint (A-3b), not here.
 */
export function checkConnection({ defaultAccount, accounts, mode, profile, listing }) {
  if (!Array.isArray(accounts) || !accounts.length || accounts.some((a) => typeof a !== 'string' || !a) || new Set(accounts).size !== accounts.length) {
    throw new TypeError('A connection needs a non-empty list of distinct account names.');
  }
  if (typeof defaultAccount !== 'string' || !accounts.includes(defaultAccount)) throw new TypeError('The default account must be one of the allowed accounts.');
  if (!CONNECTION_MODES.includes(mode)) throw new TypeError(`Unknown connection mode: ${mode}`);
  if (!CONNECTION_PROFILES.includes(profile)) throw new TypeError(`Unknown connection profile: ${profile}`);
  if (!CONNECTION_LISTINGS.includes(listing)) throw new TypeError(`Unknown connection listing: ${listing}`);
  return { defaultAccount, accounts: [...accounts], mode, profile, listing };
}

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
    },

    // ---- Connector login store (A-3a). Codes, tokens and client secrets are stored as SHA-256 hashes only. ----

    async createOAuthClient({ clientId, clientSecret, redirectUris, clientName }) {
      if (!clientId || !clientSecret || !Array.isArray(redirectUris) || !redirectUris.length) {
        throw new TypeError('Missing OAuth client registration fields.');
      }
      const data = JSON.stringify({ client_secret_hash: hashToken(clientSecret), redirect_uris: redirectUris, client_name: clientName || null });
      await sql`INSERT INTO oauth_clients (client_id, data) VALUES (${clientId}, ${data}::jsonb)`;
    },

    async getOAuthClient(clientId) {
      const rows = await sql`SELECT client_id, data FROM oauth_clients WHERE client_id = ${clientId}`;
      return rows[0] ? { client_id: rows[0].client_id, ...rows[0].data } : null;
    },

    async createAuthCode({ code, clientId, redirectUri, codeChallenge, codeChallengeMethod = 'S256', defaultAccount, accounts,
      mode = 'preview', profile = 'everyday', listing = 'catalog', ttlSeconds = 600 }) {
      const connection = checkConnection({ defaultAccount, accounts, mode, profile, listing });
      const data = JSON.stringify({ redirect_uri: redirectUri, code_challenge: codeChallenge, code_challenge_method: codeChallengeMethod });
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      await sql`INSERT INTO oauth_codes (code, client_id, data, default_account, accounts, mode, profile, listing, expires_at)
        VALUES (${hashToken(code)}, ${clientId}, ${data}::jsonb, ${connection.defaultAccount}, ${connection.accounts}::text[],
          ${connection.mode}, ${connection.profile}, ${connection.listing}, ${expiresAt})`;
    },

    /** Single use: the row is deleted as it is read. Expired codes are refused. */
    async consumeAuthCode(code) {
      if (typeof code !== 'string' || !code) return null;
      const rows = await sql`DELETE FROM oauth_codes WHERE code = ${hashToken(code)} AND expires_at > now()
        RETURNING client_id, data, default_account, accounts, mode, profile, listing`;
      const row = rows[0];
      return row ? { client_id: row.client_id, ...row.data, ...connectionSettings(row) } : null;
    },

    async createAccessToken({ accessToken, refreshToken, clientId, defaultAccount, accounts,
      mode = 'preview', profile = 'everyday', listing = 'catalog', ttlSeconds = 3600 }) {
      const connection = checkConnection({ defaultAccount, accounts, mode, profile, listing });
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      await sql`INSERT INTO oauth_tokens (token_hash, refresh_hash, client_id, default_account, accounts, mode, profile, listing, expires_at)
        VALUES (${hashToken(accessToken)}, ${refreshToken ? hashToken(refreshToken) : null}, ${clientId}, ${connection.defaultAccount},
          ${connection.accounts}::text[], ${connection.mode}, ${connection.profile}, ${connection.listing}, ${expiresAt})`;
    },

    async getAccessToken(accessToken) {
      if (typeof accessToken !== 'string' || !accessToken) return null;
      const rows = await sql`SELECT client_id, default_account, accounts, mode, profile, listing, kind, expires_at
        FROM oauth_tokens WHERE token_hash = ${hashToken(accessToken)} AND expires_at > now() AND revoked_at IS NULL AND kind = 'connector'`;
      const row = rows[0];
      return row ? { client_id: row.client_id, kind: row.kind, expires_at: row.expires_at, ...connectionSettings(row) } : null;
    },

    async getTokenByRefreshToken(refreshToken) {
      if (typeof refreshToken !== 'string' || !refreshToken) return null;
      const rows = await sql`SELECT client_id, default_account, accounts, mode, profile, listing
        FROM oauth_tokens WHERE refresh_hash = ${hashToken(refreshToken)} AND revoked_at IS NULL AND kind = 'connector'`;
      const row = rows[0];
      return row ? { client_id: row.client_id, ...connectionSettings(row) } : null;
    },

    /**
     * One atomic UPDATE on the same row, for the same client only: a refresh credential works once even when two requests
     * race, and every connection setting stays on the row it was issued with (nothing is copied from a default).
     */
    async rotateRefreshToken({ refreshToken, clientId, accessToken, newRefreshToken, ttlSeconds = 3600 }) {
      if (typeof refreshToken !== 'string' || !refreshToken || !clientId) return null;
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      const rows = await sql`UPDATE oauth_tokens SET token_hash = ${hashToken(accessToken)}, refresh_hash = ${hashToken(newRefreshToken)},
        expires_at = ${expiresAt}, last_used_at = NULL
        WHERE refresh_hash = ${hashToken(refreshToken)} AND client_id = ${clientId} AND revoked_at IS NULL AND kind = 'connector'
        RETURNING client_id, default_account, accounts, mode, profile, listing`;
      const row = rows[0];
      return row ? { client_id: row.client_id, ...connectionSettings(row) } : null;
    },

    async revokeAccessToken(accessToken) {
      if (typeof accessToken !== 'string' || !accessToken) return false;
      const rows = await sql`UPDATE oauth_tokens SET revoked_at = now()
        WHERE token_hash = ${hashToken(accessToken)} AND revoked_at IS NULL RETURNING token_hash`;
      return rows.length > 0;
    },

    async recordLoginAttempt(ip) {
      const rows = await sql`INSERT INTO login_attempts (ip, success) VALUES (${ip}, FALSE) RETURNING id`;
      return rows[0].id;
    },

    async markLoginAttemptSucceeded(id) {
      await sql`UPDATE login_attempts SET success = TRUE WHERE id = ${id}`;
    },

    async countRecentFailedLogins(ip, minutes = 15) {
      const rows = await sql`SELECT count(*)::integer AS count FROM login_attempts
        WHERE ip = ${ip} AND success = FALSE AND attempted_at > now() - ${minutes} * interval '1 minute'`;
      return rows[0].count;
    },

    // ---- GitHub Apps, accounts and credentials (A-5a). Values named *_enc are ciphertext made by src/github/credentials.js. ----

    /** Stores (or replaces) the GitHub App returned by the manifest flow. Secrets arrive already encrypted. */
    async saveApp({ id, slug, ownerLogin, ownerType, clientId, clientSecretEnc, privateKeyEnc, webhookSecretEnc, permissions }) {
      await sql`INSERT INTO gh_apps (id, slug, owner_login, owner_type, client_id, client_secret_enc, private_key_enc, webhook_secret_enc, permissions)
        VALUES (${id}, ${slug}, ${ownerLogin}, ${ownerType}, ${clientId}, ${clientSecretEnc}, ${privateKeyEnc}, ${webhookSecretEnc}, ${JSON.stringify(permissions ?? {})}::jsonb)
        ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, owner_login = EXCLUDED.owner_login, owner_type = EXCLUDED.owner_type,
          client_id = EXCLUDED.client_id, client_secret_enc = EXCLUDED.client_secret_enc, private_key_enc = EXCLUDED.private_key_enc,
          webhook_secret_enc = EXCLUDED.webhook_secret_enc, permissions = EXCLUDED.permissions`;
    },
    /** The full App row (ciphertext included) for the credential layer, or null. */
    async getApp(id) {
      const rows = await sql`SELECT id, slug, owner_login, owner_type, client_id, client_secret_enc, private_key_enc, webhook_secret_enc, permissions
        FROM gh_apps WHERE id = ${id}`;
      return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
    },

    /**
     * Adds an account or updates its identity. Only the fields passed change; `production_enabled`, `spend_limit_cents`,
     * credentials and the default flag of an existing account are never touched here. The first account becomes the default.
     */
    async upsertAccount({ login, accountId, accountType, label, credentialKind = 'app', appId = null, isScratch = false }) {
      await sql`INSERT INTO gh_accounts (login, account_id, account_type, label, credential_kind, app_id, is_scratch, is_default)
        VALUES (${login}, ${accountId}, ${accountType}, ${label}, ${credentialKind}, ${appId}, ${isScratch},
          NOT EXISTS (SELECT 1 FROM gh_accounts WHERE is_default))
        ON CONFLICT (login) DO UPDATE SET account_type = EXCLUDED.account_type, label = EXCLUDED.label,
          credential_kind = EXCLUDED.credential_kind, app_id = COALESCE(EXCLUDED.app_id, gh_accounts.app_id)`;
    },
    /** One account's full row (ciphertext included) for the credential layer, or null. */
    async getAccount(login) {
      const rows = await sql`SELECT * FROM gh_accounts WHERE lower(login) = lower(${login})`;
      return rows[0] ? { ...rows[0], account_id: Number(rows[0].account_id), app_id: rows[0].app_id == null ? null : Number(rows[0].app_id),
        installation_id: rows[0].installation_id == null ? null : Number(rows[0].installation_id) } : null;
    },
    /** Every account without any ciphertext: safe to show on the setup page and in tool results. */
    async listAccounts() {
      const rows = await sql`SELECT login, account_type, label, credential_kind, app_id, installation_id, repository_selection,
          installation_status, installation_permissions, user_login, (user_token_enc IS NOT NULL) AS has_user_token, user_token_expires_at,
          (fine_grained_enc IS NOT NULL) AS has_fine_grained, fine_grained_last4, (classic_enc IS NOT NULL) AS has_classic, classic_scopes,
          classic_last4, plan_name, production_enabled, is_default, is_scratch, checked_at
        FROM gh_accounts ORDER BY is_default DESC, login`;
      return rows.map((r) => ({ ...r, app_id: r.app_id == null ? null : Number(r.app_id), installation_id: r.installation_id == null ? null : Number(r.installation_id) }));
    },
    /** Records the installation of an account's App (from the installation callback or a webhook). */
    async setInstallation(login, { installationId, repositorySelection, permissions, status }) {
      const rows = await sql`UPDATE gh_accounts SET installation_id = ${installationId}, repository_selection = ${repositorySelection},
        installation_permissions = ${JSON.stringify(permissions ?? {})}::jsonb, installation_status = ${status}, checked_at = now()
        WHERE lower(login) = lower(${login}) RETURNING login`;
      return rows.length === 1;
    },
    async setInstallationStatus(login, status) {
      const rows = await sql`UPDATE gh_accounts SET installation_status = ${status}, checked_at = now() WHERE lower(login) = lower(${login}) RETURNING login`;
      return rows.length === 1;
    },
    /** Stores Chris's user authorization of the App (8-hour token, 6-month refresh token), both already encrypted. */
    async setUserAuthorization(login, { userLogin, tokenEnc, tokenExpiresAt, refreshEnc, refreshExpiresAt }) {
      const rows = await sql`UPDATE gh_accounts SET user_login = ${userLogin}, user_token_enc = ${tokenEnc}, user_token_expires_at = ${tokenExpiresAt},
        user_refresh_enc = ${refreshEnc}, user_refresh_expires_at = ${refreshExpiresAt} WHERE lower(login) = lower(${login}) RETURNING login`;
      return rows.length === 1;
    },
    async clearUserAuthorization(login) {
      await sql`UPDATE gh_accounts SET user_login = NULL, user_token_enc = NULL, user_token_expires_at = NULL, user_refresh_enc = NULL,
        user_refresh_expires_at = NULL WHERE lower(login) = lower(${login})`;
    },
    async setFineGrainedToken(login, { enc, last4, expiresAt = null }) {
      const rows = await sql`UPDATE gh_accounts SET fine_grained_enc = ${enc}, fine_grained_last4 = ${last4}, fine_grained_expires_at = ${expiresAt}
        WHERE lower(login) = lower(${login}) RETURNING login`;
      return rows.length === 1;
    },
    async setClassicToken(login, { enc, scopes, last4 }) {
      const rows = await sql`UPDATE gh_accounts SET classic_enc = ${enc}, classic_scopes = ${scopes}, classic_last4 = ${last4}
        WHERE lower(login) = lower(${login}) RETURNING login`;
      return rows.length === 1;
    },
    async setAccountPlan(login, planName) {
      await sql`UPDATE gh_accounts SET plan_name = ${planName}, checked_at = now() WHERE lower(login) = lower(${login})`;
    },

    /** A cached installation token for this scope if it has more than five minutes left, else null. */
    async getInstallationToken(installationId, scopeKey) {
      const rows = await sql`SELECT token_enc, expires_at FROM gh_installation_tokens
        WHERE installation_id = ${installationId} AND scope_key = ${scopeKey} AND expires_at > now() + interval '5 minutes'`;
      return rows[0] ? { token_enc: rows[0].token_enc, expires_at: new Date(rows[0].expires_at) } : null;
    },
    async putInstallationToken(installationId, scopeKey, tokenEnc, expiresAt) {
      await sql`INSERT INTO gh_installation_tokens (installation_id, scope_key, token_enc, expires_at)
        VALUES (${installationId}, ${scopeKey}, ${tokenEnc}, ${expiresAt})
        ON CONFLICT (installation_id, scope_key) DO UPDATE SET token_enc = EXCLUDED.token_enc, expires_at = EXCLUDED.expires_at`;
      await sql`DELETE FROM gh_installation_tokens WHERE ctid IN (SELECT ctid FROM gh_installation_tokens WHERE expires_at < now() LIMIT 100)`;
    },
    async deleteInstallationTokens(installationId) {
      await sql`DELETE FROM gh_installation_tokens WHERE installation_id = ${installationId}`;
    },

    /** A pending setup step (manifest or user authorization) keyed by an unguessable state; used once, expires. */
    async createSetupState({ state, purpose, accountHint = null, codeVerifierEnc = null, ttlSeconds = 3600 }) {
      if (!['manifest', 'user_auth'].includes(purpose)) throw new TypeError('Unknown setup purpose.');
      if (typeof state !== 'string' || state.length < 32) throw new TypeError('A setup state must be an unguessable string.');
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
      await sql`INSERT INTO setup_states (state, purpose, account_hint, code_verifier_enc, expires_at)
        VALUES (${state}, ${purpose}, ${accountHint}, ${codeVerifierEnc}, ${expiresAt})`;
    },
    /** Atomic: returns the state's data once and deletes it, or null if unknown, used, expired or for another purpose. */
    async consumeSetupState(state, purpose) {
      if (typeof state !== 'string' || !state) return null;
      const rows = await sql`DELETE FROM setup_states WHERE state = ${state} AND purpose = ${purpose} AND expires_at > now()
        RETURNING account_hint, code_verifier_enc`;
      return rows[0] ? { account_hint: rows[0].account_hint, code_verifier_enc: rows[0].code_verifier_enc } : null;
    },

    async addOneTimeSecret({ id, account = null, kind, ciphertext, expiresAt }) {
      await sql`INSERT INTO one_time_secrets (id, account, kind, ciphertext, expires_at) VALUES (${id}, ${account}, ${kind}, ${ciphertext}, ${expiresAt})`;
      await sql`DELETE FROM one_time_secrets WHERE ctid IN (SELECT ctid FROM one_time_secrets WHERE expires_at < now() LIMIT 100)`;
    },
    /** Atomic delete-and-return: two callers can never both read a single-view secret. */
    async consumeOneTimeSecret(id) {
      const rows = await sql`DELETE FROM one_time_secrets WHERE id = ${id} AND expires_at > now() AND viewed_at IS NULL
        RETURNING account, kind, ciphertext`;
      return rows[0] || null;
    },

    /**
     * Claims the next write slot for an installation in one atomic statement, so two server instances can never both
     * write in the same second (A9). The slot is the later of "now" and the previous claim's end; each claim reserves
     * `spacingMs` after it. Returns `{ waitMs }` (how long the caller must wait before writing) or `null` when that
     * wait would exceed `maxWaitMs` (nothing is reserved then).
     */
    async claimWriteSlot(installationKey, { spacingMs = 1000, maxWaitMs = 5000 } = {}) {
      if (typeof installationKey !== 'string' || !installationKey) throw new TypeError('claimWriteSlot needs an installation key.');
      const spacing = spacingMs / 1000;
      const maxWait = maxWaitMs / 1000;
      const rows = await sql`INSERT INTO gh_write_slots (installation_key, next_write_at)
        VALUES (${installationKey}, now() + make_interval(secs => ${spacing}::float8))
        ON CONFLICT (installation_key) DO UPDATE
          SET next_write_at = GREATEST(gh_write_slots.next_write_at, now()) + make_interval(secs => ${spacing}::float8)
          WHERE gh_write_slots.next_write_at <= now() + make_interval(secs => ${maxWait}::float8)
        RETURNING (EXTRACT(EPOCH FROM (next_write_at - make_interval(secs => ${spacing}::float8) - now())) * 1000)::float8 AS wait_ms`;
      return rows[0] ? { waitMs: Math.max(0, Math.round(rows[0].wait_ms)) } : null;
    },

    /** Records GitHub's rate headers for an account and resource so every instance sees a block (A9). */
    async recordRateState({ account, resource, remaining = null, resetAt = null, blockedUntil = null }) {
      await sql`INSERT INTO gh_rate_state (account, resource, remaining, reset_at, blocked_until, updated_at)
        VALUES (${account}, ${resource}, ${remaining}, ${resetAt}, ${blockedUntil}, now())
        ON CONFLICT (account, resource) DO UPDATE SET remaining = EXCLUDED.remaining, reset_at = EXCLUDED.reset_at,
          blocked_until = EXCLUDED.blocked_until, updated_at = now()`;
    },

    /** The recorded rate state, or null. `blocked_until` is only reported while it is still in the future. */
    async getRateState(account, resource) {
      const rows = await sql`SELECT remaining, reset_at, CASE WHEN blocked_until > now() THEN blocked_until END AS blocked_until
        FROM gh_rate_state WHERE account = ${account} AND resource = ${resource}`;
      return rows[0] ? { remaining: rows[0].remaining, reset_at: rows[0].reset_at, blocked_until: rows[0].blocked_until } : null;
    },

    /** The cached body and ETag for a polled read, or null (rows older than 24 hours are ignored). */
    async getEtag(account, urlKey) {
      const rows = await sql`SELECT etag, body FROM gh_etag_cache
        WHERE account = ${account} AND url_key = ${urlKey} AND stored_at > now() - interval '24 hours'`;
      return rows[0] ? { etag: rows[0].etag, body: rows[0].body } : null;
    },

    /** Stores an ETag and body (bodies over 256 KB are not kept) and deletes up to 100 expired rows. */
    async putEtag(account, urlKey, etag, body) {
      const json = JSON.stringify(body ?? null);
      if (Buffer.byteLength(json) > ETAG_BODY_LIMIT_BYTES) {
        await sql`DELETE FROM gh_etag_cache WHERE account = ${account} AND url_key = ${urlKey}`;
        return false;
      }
      await sql`INSERT INTO gh_etag_cache (account, url_key, etag, body, stored_at)
        VALUES (${account}, ${urlKey}, ${etag}, ${json}::jsonb, now())
        ON CONFLICT (account, url_key) DO UPDATE SET etag = EXCLUDED.etag, body = EXCLUDED.body, stored_at = now()`;
      await sql`DELETE FROM gh_etag_cache WHERE ctid IN (
        SELECT ctid FROM gh_etag_cache WHERE stored_at < now() - interval '24 hours' LIMIT 100)`;
      return true;
    },

    /** The accounts the login page offers. `production_enabled` decides whether production mode may be offered. */
    async listAccountsForLogin() {
      return await sql`SELECT login, label, production_enabled, is_default FROM gh_accounts ORDER BY is_default DESC, login`;
    }
  };
}
