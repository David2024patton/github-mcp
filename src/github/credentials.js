// The credential store (A3–A5): GitHub App secrets, installation tokens, the owner's user authorization and pasted
// tokens, all encrypted at rest (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`) with a context tying each value to its owner so a
// copied ciphertext cannot be moved to another account. Nothing here is returned by a tool; the only consumer of plain
// values is `credentials.token()`, which the client calls once per request. Errors are plain words and never carry a value.
import crypto from 'node:crypto';
import { decryptSecret, encryptSecret, readEncryptionKey } from '../core/crypto.js';
import { bareOctokit } from './client.js';
import { GithubClientError } from './errors.js';

export const INSTALLATION_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // enforced by the database query too
export const USER_TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;
const OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const KEY_HELP = 'Credential storage is not set up on this server. Set TOKEN_ENCRYPTION_KEY (a base64 32-byte key; see docs/DEPLOY.md) and try again.';

const b64url = (input) => Buffer.from(input).toString('base64url');
const lower = (login) => String(login).toLowerCase();

/** Stable text for a downscoping request: 'all' when unscoped, else a short hash of its canonical JSON. */
export function scopeKeyOf(scope) {
  if (!scope || (!scope.repositories?.length && !scope.repository_ids?.length && !scope.permissions)) return 'all';
  const canonical = JSON.stringify({
    repositories: [...(scope.repositories || [])].sort(), repository_ids: [...(scope.repository_ids || [])].sort(),
    permissions: Object.fromEntries(Object.entries(scope.permissions || {}).sort(([a], [b]) => a.localeCompare(b)))
  });
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

/** The GitHub App JWT (RS256, valid ten minutes, backdated sixty seconds for clock drift). */
export function signAppJwt({ appId, privateKey, now = Date.now }) {
  const iat = Math.floor(now() / 1000) - 60;
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat, exp: iat + 9 * 60 + 60, iss: String(appId) }));
  const signature = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url');
  return `${head}.${body}.${signature}`;
}

/**
 * @param {{ db: object, env?: object, fetch?: Function, now?: () => number }} options
 * @returns the credential API: `token({ account, cred, scope })` for the client, plus the storing and verifying calls the
 *   setup page uses. `cred`: `I` the account's main credential (App installation token, or its fine-grained token),
 *   `U` the owner's user authorization, `K` the classic notifications token.
 */
export function createCredentials({ db, env = process.env, fetch = globalThis.fetch, now = Date.now }) {
  let cachedKey = null;
  function key() {
    if (cachedKey) return cachedKey;
    try { cachedKey = readEncryptionKey(env); } catch { throw new GithubClientError('no_credentials', KEY_HELP); }
    return cachedKey;
  }
  const seal = (value, aad) => encryptSecret(value, { aad, key: key() });
  const open = (envelope, aad) => {
    try { return decryptSecret(envelope, { aad, key: key() }); } catch (error) {
      if (error instanceof GithubClientError) throw error;
      throw new GithubClientError('no_credentials', 'A saved GitHub credential could not be read (wrong TOKEN_ENCRYPTION_KEY, or it changed). Add the credential again on the setup page.');
    }
  };
  const contexts = {
    privateKey: (appId) => `github-mcp/app/${appId}/private_key`,
    clientSecret: (appId) => `github-mcp/app/${appId}/client_secret`,
    webhookSecret: (appId) => `github-mcp/app/${appId}/webhook_secret`,
    userToken: (login) => `github-mcp/account/${lower(login)}/user_token`,
    userRefresh: (login) => `github-mcp/account/${lower(login)}/user_refresh`,
    fineGrained: (login) => `github-mcp/account/${lower(login)}/fine_grained`,
    classic: (login) => `github-mcp/account/${lower(login)}/classic`,
    installation: (installationId, scopeKey) => `github-mcp/installation/${installationId}/${scopeKey}`,
    verifier: (state) => `github-mcp/setup/${state}/verifier`
  };

  const missing = (account, what) => new GithubClientError('no_credentials', `${account}: ${what} Open the setup page to fix it.`, { account });

  async function appOf(row) {
    const app = row.app_id == null ? null : await db.getApp(row.app_id);
    if (!app) throw missing(row.login, 'no GitHub App has been created for this account yet.');
    return app;
  }

  async function installationToken(row, scope) {
    if (row.installation_id == null || row.installation_status !== 'active') {
      throw missing(row.login, row.installation_status === 'suspended' ? 'its GitHub App installation is suspended.' : 'the GitHub App is not installed on this account yet.');
    }
    const scopeKey = scopeKeyOf(scope);
    const cached = await db.getInstallationToken(row.installation_id, scopeKey);
    if (cached) return open(cached.token_enc, contexts.installation(row.installation_id, scopeKey));
    const app = await appOf(row);
    const jwt = signAppJwt({ appId: app.id, privateKey: open(app.private_key_enc, contexts.privateKey(app.id)), now });
    const body = {};
    if (scope?.repositories?.length) body.repositories = scope.repositories;
    if (scope?.repository_ids?.length) body.repository_ids = scope.repository_ids;
    if (scope?.permissions) body.permissions = scope.permissions;
    let response;
    try {
      response = await bareOctokit({ token: jwt, fetch }).request('POST /app/installations/{installation_id}/access_tokens', { installation_id: row.installation_id, ...body });
    } catch (error) {
      if (error?.status === 404) await db.setInstallationStatus(row.login, 'none');
      if ([401, 403, 404, 422].includes(error?.status)) {
        throw missing(row.login, `GitHub would not give the server a token (${error.status}). The App may have been uninstalled or its key replaced.`);
      }
      throw error;
    }
    const expiresAt = new Date(response.data.expires_at);
    await db.putInstallationToken(row.installation_id, scopeKey, seal(response.data.token, contexts.installation(row.installation_id, scopeKey)), expiresAt);
    return response.data.token;
  }

  async function refreshUser(row, app) {
    const refresh = open(row.user_refresh_enc, contexts.userRefresh(row.login));
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: app.client_id, client_secret: open(app.client_secret_enc, contexts.clientSecret(app.id)), grant_type: 'refresh_token', refresh_token: refresh })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error || !data.access_token) {
      // A refresh token works once. If another server instance just used it, the row already holds the new tokens.
      const latest = await db.getAccount(row.login);
      if (latest?.user_token_enc && latest.user_token_enc !== row.user_token_enc) return latest;
      await db.clearUserAuthorization(row.login);
      throw missing(row.login, 'your GitHub sign-in for personal settings has expired.');
    }
    await storeUserAuthorization(row.login, { userLogin: row.user_login, accessToken: data.access_token, expiresIn: data.expires_in, refreshToken: data.refresh_token, refreshExpiresIn: data.refresh_token_expires_in });
    return await db.getAccount(row.login);
  }

  async function userToken(row) {
    if (!row.user_token_enc) throw missing(row.login, 'it has not been authorized for personal settings yet ("Authorize as me").');
    let current = row;
    if (current.user_token_expires_at && new Date(current.user_token_expires_at).getTime() - now() < USER_TOKEN_REFRESH_MARGIN_MS) {
      if (!current.user_refresh_enc) { await db.clearUserAuthorization(row.login); throw missing(row.login, 'your GitHub sign-in for personal settings has expired.'); }
      current = await refreshUser(current, await appOf(current));
    }
    return open(current.user_token_enc, contexts.userToken(row.login));
  }

  async function storeUserAuthorization(login, { userLogin, accessToken, expiresIn, refreshToken, refreshExpiresIn }) {
    const at = now();
    return await db.setUserAuthorization(login, {
      userLogin, tokenEnc: seal(accessToken, contexts.userToken(login)), tokenExpiresAt: new Date(at + Number(expiresIn || 28800) * 1000),
      refreshEnc: refreshToken ? seal(refreshToken, contexts.userRefresh(login)) : null,
      refreshExpiresAt: refreshToken ? new Date(at + Number(refreshExpiresIn || 15811200) * 1000) : null
    });
  }

  return {
    /** Called by `githubFor` once per request. Returns the plain token string, or throws a plain `no_credentials`. */
    async token({ account, cred = 'I', scope } = {}) {
      const row = await db.getAccount(account);
      if (!row) throw missing(account, 'it is not one of the accounts set up on this server.');
      if (cred === 'U') return await userToken(row);
      if (cred === 'K') {
        if (!row.classic_enc) throw missing(row.login, 'no notifications token has been added.');
        return open(row.classic_enc, contexts.classic(row.login));
      }
      if (row.credential_kind === 'fine_grained') {
        if (scope?.permissions || scope?.repositories?.length) throw missing(row.login, 'it uses a fine-grained token, which cannot be narrowed per connection; switch it to the GitHub App.');
        if (!row.fine_grained_enc) throw missing(row.login, 'no fine-grained token has been added.');
        if (row.fine_grained_expires_at && new Date(row.fine_grained_expires_at).getTime() <= now()) throw missing(row.login, 'its fine-grained token has expired.');
        return open(row.fine_grained_enc, contexts.fineGrained(row.login));
      }
      return await installationToken(row, scope);
    },

    /** Stores the App returned by `POST /app-manifests/{code}/conversions`, encrypting its three secrets. Returns no secret. */
    async storeApp(conversion, { ownerLogin, ownerType }) {
      const id = Number(conversion?.id);
      for (const field of ['slug', 'client_id', 'client_secret', 'pem', 'webhook_secret']) {
        if (typeof conversion?.[field] !== 'string' || !conversion[field]) throw new TypeError(`The GitHub App response is missing ${field}.`);
      }
      if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError('The GitHub App response has no valid id.');
      await db.saveApp({
        id, slug: conversion.slug, ownerLogin, ownerType, clientId: conversion.client_id,
        clientSecretEnc: seal(conversion.client_secret, contexts.clientSecret(id)),
        privateKeyEnc: seal(conversion.pem, contexts.privateKey(id)),
        webhookSecretEnc: seal(conversion.webhook_secret, contexts.webhookSecret(id)),
        permissions: conversion.permissions ?? {}
      });
      return { id, slug: conversion.slug, client_id: conversion.client_id };
    },
    /** The App's webhook secret, for verifying `X-Hub-Signature-256` (A12) and nothing else. */
    async webhookSecret(appId) {
      const app = await db.getApp(appId);
      return app ? open(app.webhook_secret_enc, contexts.webhookSecret(app.id)) : null;
    },
    /** The App's OAuth client id and secret, for the user-authorization exchange on the setup page (A-5b). */
    async clientCredentials(appId) {
      const app = await db.getApp(appId);
      return app ? { clientId: app.client_id, clientSecret: open(app.client_secret_enc, contexts.clientSecret(app.id)) } : null;
    },
    /** A short-lived JWT for calls made as the App itself (`GET /app`, installation lookups). */
    async appJwt(appId) {
      const app = await db.getApp(appId);
      if (!app) throw new GithubClientError('no_credentials', 'That GitHub App is not stored on this server.');
      return signAppJwt({ appId: app.id, privateKey: open(app.private_key_enc, contexts.privateKey(app.id)), now });
    },
    storeUserAuthorization,
    async storeFineGrained(login, token, { expiresAt = null } = {}) {
      if (typeof token !== 'string' || token.length < 20) throw new TypeError('That does not look like a GitHub token.');
      return await db.setFineGrainedToken(login, { enc: seal(token, contexts.fineGrained(login)), last4: token.slice(-4), expiresAt });
    },
    async storeClassic(login, token, scopes) {
      if (typeof token !== 'string' || token.length < 20) throw new TypeError('That does not look like a GitHub token.');
      return await db.setClassicToken(login, { enc: seal(token, contexts.classic(login)), scopes: [...scopes], last4: token.slice(-4) });
    },
    /** For a user-token 401: forget the authorization so the setup page asks for it again (A5). */
    async forgetUserAuthorization(login) { await db.clearUserAuthorization(login); },
    /** Seals a PKCE verifier for the time between the setup page and the callback. */
    sealVerifier(state, verifier) { return seal(verifier, contexts.verifier(state)); },
    openVerifier(state, envelope) { return open(envelope, contexts.verifier(state)); },
    /** True when the encryption key is configured and valid (the setup page refuses to store anything otherwise). */
    keyConfigured() { try { key(); return true; } catch { return false; } }
  };
}
