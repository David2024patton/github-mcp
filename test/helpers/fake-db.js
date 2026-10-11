// Adapted from Robinson-AI-Systems/stripe-mcp test/helpers/fake-db.js @ 90a49c0; A-2 added the GitHub MCP foundation
// schema, A-3a adds the connector login store. Service-independent in-memory fake of createDb(): it mirrors the behavior
// of src/db.js (hashed storage, single-use codes, atomic refresh) and is held to the same contract suite
// (test/contract/oauth-contract.js) as real PostgreSQL.
import { SCHEMA_TABLES, ETAG_BODY_LIMIT_BYTES, checkConnection, connectionSettings } from '../../src/db.js';
import { hashToken } from '../../src/core/oauth.js';

export function createFakeDb({ clock = Date.now } = {}) {
  const rows = new Map();
  const tables = new Set();
  const clients = new Map();
  const codes = new Map();
  const tokens = new Map();
  const attempts = [];
  const accounts = [];
  const slots = new Map();
  const apps = new Map();
  const accountRows = new Map();
  const installTokens = new Map();
  const setupStates = new Map();
  const oneTime = new Map();
  const rates = new Map();
  const etags = new Map();
  const DAY_MS = 24 * 60 * 60 * 1000;
  let attemptId = 0;
  const settingsOf = (row) => connectionSettings({ ...row, accounts: row.accounts });
  const live = (row) => row && row.revoked_at == null && row.kind === 'connector';

  return {
    async initSchema() { for (const name of SCHEMA_TABLES) tables.add(name); },
    async listTables() { return [...tables].sort(); },
    async put(key, value) { rows.set(key, structuredClone(value)); },
    async get(key) { return rows.has(key) ? structuredClone(rows.get(key)) : null; },

    async createOAuthClient({ clientId, clientSecret, redirectUris, clientName }) {
      if (!clientId || !clientSecret || !Array.isArray(redirectUris) || !redirectUris.length) throw new TypeError('Missing OAuth client registration fields.');
      if (clients.has(clientId)) throw new Error('duplicate key value violates unique constraint "oauth_clients_pkey"');
      clients.set(clientId, { client_secret_hash: hashToken(clientSecret), redirect_uris: [...redirectUris], client_name: clientName || null });
    },
    async getOAuthClient(clientId) { return clients.has(clientId) ? { client_id: clientId, ...structuredClone(clients.get(clientId)) } : null; },

    async createAuthCode({ code, clientId, redirectUri, codeChallenge, codeChallengeMethod = 'S256', defaultAccount, accounts: allowed,
      mode = 'preview', profile = 'everyday', listing = 'catalog', ttlSeconds = 600 }) {
      const c = checkConnection({ defaultAccount, accounts: allowed, mode, profile, listing });
      codes.set(hashToken(code), {
        client_id: clientId, data: { redirect_uri: redirectUri, code_challenge: codeChallenge, code_challenge_method: codeChallengeMethod },
        default_account: c.defaultAccount, accounts: c.accounts, mode: c.mode, profile: c.profile, listing: c.listing, expires_at: clock() + ttlSeconds * 1000
      });
    },
    async consumeAuthCode(code) {
      if (typeof code !== 'string' || !code) return null;
      const key = hashToken(code);
      const row = codes.get(key);
      if (!row || row.expires_at <= clock()) return null;
      codes.delete(key);
      return { client_id: row.client_id, ...structuredClone(row.data), ...settingsOf(row) };
    },

    async createAccessToken({ accessToken, refreshToken, clientId, defaultAccount, accounts: allowed, mode = 'preview', profile = 'everyday', listing = 'catalog', ttlSeconds = 3600 }) {
      const c = checkConnection({ defaultAccount, accounts: allowed, mode, profile, listing });
      tokens.set(hashToken(accessToken), {
        token_hash: hashToken(accessToken), refresh_hash: refreshToken ? hashToken(refreshToken) : null, client_id: clientId,
        default_account: c.defaultAccount, accounts: c.accounts, mode: c.mode, profile: c.profile, listing: c.listing, kind: 'connector',
        expires_at: clock() + ttlSeconds * 1000, revoked_at: null
      });
    },
    async getAccessToken(accessToken) {
      if (typeof accessToken !== 'string' || !accessToken) return null;
      const row = tokens.get(hashToken(accessToken));
      if (!live(row) || row.expires_at <= clock()) return null;
      return { client_id: row.client_id, kind: row.kind, expires_at: new Date(row.expires_at), ...settingsOf(row) };
    },
    async getTokenByRefreshToken(refreshToken) {
      if (typeof refreshToken !== 'string' || !refreshToken) return null;
      const hash = hashToken(refreshToken);
      const row = [...tokens.values()].find((t) => t.refresh_hash === hash);
      return live(row) ? { client_id: row.client_id, ...settingsOf(row) } : null;
    },
    async rotateRefreshToken({ refreshToken, clientId, accessToken, newRefreshToken, ttlSeconds = 3600 }) {
      if (typeof refreshToken !== 'string' || !refreshToken || !clientId) return null;
      const hash = hashToken(refreshToken);
      const entry = [...tokens.entries()].find(([, t]) => t.refresh_hash === hash);
      if (!entry || !live(entry[1]) || entry[1].client_id !== clientId) return null;
      const [oldKey, row] = entry; // no await between the check and the write: atomic like the real UPDATE
      tokens.delete(oldKey);
      row.token_hash = hashToken(accessToken);
      row.refresh_hash = hashToken(newRefreshToken);
      row.expires_at = clock() + ttlSeconds * 1000;
      tokens.set(row.token_hash, row);
      return { client_id: row.client_id, ...settingsOf(row) };
    },
    async revokeAccessToken(accessToken) {
      if (typeof accessToken !== 'string' || !accessToken) return false;
      const row = tokens.get(hashToken(accessToken));
      if (!row || row.revoked_at != null) return false;
      row.revoked_at = clock();
      return true;
    },

    async recordLoginAttempt(ip) { attempts.push({ id: ++attemptId, ip, at: clock(), success: false }); return attemptId; },
    async markLoginAttemptSucceeded(id) { const a = attempts.find((x) => x.id === id); if (a) a.success = true; },
    async countRecentFailedLogins(ip, minutes = 15) { return attempts.filter((a) => a.ip === ip && !a.success && a.at > clock() - minutes * 60000).length; },

    // ---- GitHub Apps, accounts and credentials (A-5a): mirrors src/db.js and passes test/contract/credentials-contract.js ----
    async saveApp(app) {
      apps.set(Number(app.id), { id: Number(app.id), slug: app.slug, owner_login: app.ownerLogin, owner_type: app.ownerType, client_id: app.clientId,
        client_secret_enc: app.clientSecretEnc, private_key_enc: app.privateKeyEnc, webhook_secret_enc: app.webhookSecretEnc, permissions: structuredClone(app.permissions ?? {}) });
    },
    async getApp(id) { return apps.has(Number(id)) ? structuredClone(apps.get(Number(id))) : null; },
    async upsertAccount({ login, accountId, accountType, label, credentialKind = 'app', appId = null, isScratch = false }) {
      const key = login.toLowerCase();
      const existing = accountRows.get(key);
      if (existing) {
        Object.assign(existing, { account_type: accountType, label, credential_kind: credentialKind, app_id: appId ?? existing.app_id });
        return;
      }
      if ([...accountRows.values()].some((r) => r.account_id === accountId)) throw new Error('duplicate key value violates unique constraint "gh_accounts_account_id_key"');
      accountRows.set(key, {
        login, account_id: accountId, account_type: accountType, label, credential_kind: credentialKind, app_id: appId, installation_id: null,
        repository_selection: null, installation_permissions: null, installation_status: 'none', user_login: null, user_token_enc: null,
        user_token_expires_at: null, user_refresh_enc: null, user_refresh_expires_at: null, fine_grained_enc: null, fine_grained_last4: null,
        fine_grained_expires_at: null, classic_enc: null, classic_scopes: null, classic_last4: null, plan_name: null, production_enabled: false,
        spend_limit_cents: 0, is_default: ![...accountRows.values()].some((r) => r.is_default), is_scratch: isScratch, added_at: new Date(clock()), checked_at: null
      });
    },
    async getAccount(login) { const r = accountRows.get(String(login).toLowerCase()); return r ? structuredClone(r) : null; },
    async listAccounts() {
      return [...accountRows.values()].map((r) => ({
        login: r.login, account_type: r.account_type, label: r.label, credential_kind: r.credential_kind, app_id: r.app_id, installation_id: r.installation_id,
        repository_selection: r.repository_selection, installation_status: r.installation_status, installation_permissions: structuredClone(r.installation_permissions),
        user_login: r.user_login, has_user_token: r.user_token_enc != null, user_token_expires_at: r.user_token_expires_at, has_fine_grained: r.fine_grained_enc != null,
        fine_grained_last4: r.fine_grained_last4, has_classic: r.classic_enc != null, classic_scopes: r.classic_scopes && [...r.classic_scopes], classic_last4: r.classic_last4,
        plan_name: r.plan_name, production_enabled: r.production_enabled, is_default: r.is_default, is_scratch: r.is_scratch, checked_at: r.checked_at
      })).sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.login.localeCompare(b.login));
    },
    async setInstallation(login, { installationId, repositorySelection, permissions, status }) {
      const r = accountRows.get(String(login).toLowerCase());
      if (!r) return false;
      Object.assign(r, { installation_id: installationId, repository_selection: repositorySelection, installation_permissions: structuredClone(permissions ?? {}), installation_status: status, checked_at: new Date(clock()) });
      return true;
    },
    async setInstallationStatus(login, status) {
      const r = accountRows.get(String(login).toLowerCase());
      if (!r) return false;
      Object.assign(r, { installation_status: status, checked_at: new Date(clock()) });
      return true;
    },
    async setUserAuthorization(login, { userLogin, tokenEnc, tokenExpiresAt, refreshEnc, refreshExpiresAt }) {
      const r = accountRows.get(String(login).toLowerCase());
      if (!r) return false;
      Object.assign(r, { user_login: userLogin, user_token_enc: tokenEnc, user_token_expires_at: tokenExpiresAt, user_refresh_enc: refreshEnc, user_refresh_expires_at: refreshExpiresAt });
      return true;
    },
    async clearUserAuthorization(login) {
      const r = accountRows.get(String(login).toLowerCase());
      if (r) Object.assign(r, { user_login: null, user_token_enc: null, user_token_expires_at: null, user_refresh_enc: null, user_refresh_expires_at: null });
    },
    async setFineGrainedToken(login, { enc, last4, expiresAt = null }) {
      const r = accountRows.get(String(login).toLowerCase());
      if (!r) return false;
      Object.assign(r, { fine_grained_enc: enc, fine_grained_last4: last4, fine_grained_expires_at: expiresAt });
      return true;
    },
    async setClassicToken(login, { enc, scopes, last4 }) {
      const r = accountRows.get(String(login).toLowerCase());
      if (!r) return false;
      Object.assign(r, { classic_enc: enc, classic_scopes: [...scopes], classic_last4: last4 });
      return true;
    },
    async setAccountPlan(login, planName) {
      const r = accountRows.get(String(login).toLowerCase());
      if (r) Object.assign(r, { plan_name: planName, checked_at: new Date(clock()) });
    },
    async getInstallationToken(installationId, scopeKey) {
      const r = installTokens.get(`${installationId}\u0000${scopeKey}`);
      return r && r.expires_at.getTime() > clock() + 5 * 60000 ? { token_enc: r.token_enc, expires_at: new Date(r.expires_at) } : null;
    },
    async putInstallationToken(installationId, scopeKey, tokenEnc, expiresAt) {
      installTokens.set(`${installationId}\u0000${scopeKey}`, { token_enc: tokenEnc, expires_at: new Date(expiresAt) });
      let removed = 0;
      for (const [k, v] of installTokens) if (removed < 100 && v.expires_at.getTime() < clock()) { installTokens.delete(k); removed++; }
    },
    async deleteInstallationTokens(installationId) {
      for (const k of [...installTokens.keys()]) if (k.startsWith(`${installationId}\u0000`)) installTokens.delete(k);
    },
    async createSetupState({ state, purpose, accountHint = null, codeVerifierEnc = null, ttlSeconds = 3600 }) {
      if (!['manifest', 'user_auth'].includes(purpose)) throw new TypeError('Unknown setup purpose.');
      if (typeof state !== 'string' || state.length < 32) throw new TypeError('A setup state must be an unguessable string.');
      if (setupStates.has(state)) throw new Error('duplicate key value violates unique constraint "setup_states_pkey"');
      setupStates.set(state, { purpose, account_hint: accountHint, code_verifier_enc: codeVerifierEnc, expires_at: clock() + ttlSeconds * 1000 });
    },
    async consumeSetupState(state, purpose) {
      const r = setupStates.get(state);
      if (!r || r.purpose !== purpose || r.expires_at <= clock()) return null;
      setupStates.delete(state);
      return { account_hint: r.account_hint, code_verifier_enc: r.code_verifier_enc };
    },
    async addOneTimeSecret({ id, account = null, kind, ciphertext, expiresAt }) {
      if (oneTime.has(id)) throw new Error('duplicate key value violates unique constraint "one_time_secrets_pkey"');
      oneTime.set(id, { account, kind, ciphertext, expires_at: new Date(expiresAt).getTime() });
      let removed = 0;
      for (const [k, v] of oneTime) if (removed < 100 && v.expires_at < clock()) { oneTime.delete(k); removed++; }
    },
    async consumeOneTimeSecret(id) {
      const r = oneTime.get(id);
      if (!r || r.expires_at <= clock()) return null;
      oneTime.delete(id);
      return { account: r.account, kind: r.kind, ciphertext: r.ciphertext };
    },

    async claimWriteSlot(installationKey, { spacingMs = 1000, maxWaitMs = 5000 } = {}) {
      if (typeof installationKey !== 'string' || !installationKey) throw new TypeError('claimWriteSlot needs an installation key.');
      const now = clock(); // no await between the check and the write: atomic like the real statement
      const next = slots.get(installationKey);
      if (next !== undefined && next > now + maxWaitMs) return null;
      const slot = next === undefined ? now : Math.max(next, now);
      slots.set(installationKey, slot + spacingMs);
      return { waitMs: Math.max(0, Math.round(slot - now)) };
    },
    async recordRateState({ account, resource, remaining = null, resetAt = null, blockedUntil = null }) {
      rates.set(`${account}\u0000${resource}`, { remaining, reset_at: resetAt && new Date(resetAt), blocked_until: blockedUntil && new Date(blockedUntil) });
    },
    async getRateState(account, resource) {
      const row = rates.get(`${account}\u0000${resource}`);
      if (!row) return null;
      return { ...row, blocked_until: row.blocked_until && row.blocked_until.getTime() > clock() ? row.blocked_until : null };
    },
    async getEtag(account, urlKey) {
      const row = etags.get(`${account}\u0000${urlKey}`);
      return row && row.stored_at > clock() - DAY_MS ? { etag: row.etag, body: structuredClone(row.body) } : null;
    },
    async putEtag(account, urlKey, etag, body) {
      const key = `${account}\u0000${urlKey}`;
      if (Buffer.byteLength(JSON.stringify(body ?? null)) > ETAG_BODY_LIMIT_BYTES) { etags.delete(key); return false; }
      etags.set(key, { etag, body: structuredClone(body ?? null), stored_at: clock() });
      let removed = 0;
      for (const [k, v] of etags) if (removed < 100 && v.stored_at < clock() - DAY_MS) { etags.delete(k); removed++; }
      return true;
    },

    /** Test seam: the fake has no gh_accounts table, so tests seed the login page's account list here. */
    async seedAccounts(list) { accounts.splice(0, accounts.length, ...structuredClone(list)); },
    async listAccountsForLogin() {
      return structuredClone(accounts).sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.login.localeCompare(b.login));
    }
  };
}
