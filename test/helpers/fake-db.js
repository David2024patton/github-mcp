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
