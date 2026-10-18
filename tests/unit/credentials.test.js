import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCredentials, scopeKeyOf, signAppJwt } from '../../src/github/credentials.js';
import { githubFor } from '../../src/github/client.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { makeFakeGitHub } from '../../test/helpers/fake-github.js';

// Every key here is generated at run time; nothing secret-shaped is committed. Token values are obvious fakes.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const ENV = { TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64url') };
const CONVERSION = { id: 424242, slug: 'example-org-mcp', client_id: 'Iv1.fixtureclientid', client_secret: 'fixture-client-secret-value', pem: PEM, webhook_secret: 'fixture-webhook-secret-value', permissions: { contents: 'write' } };
const T0 = Date.UTC(2026, 9, 10, 12, 0, 0);

async function setup({ env = ENV, kind = 'app', install = true } = {}) {
  const clock = { t: T0 };
  const db = createFakeDb({ clock: () => clock.t });
  await db.initSchema();
  const gh = makeFakeGitHub();
  let oauth = [];
  const respond = { oauth: () => ({ ok: true, json: async () => ({}) }) };
  const fetch = async (url, init) => {
    if (String(url).startsWith('https://github.com/login/oauth/access_token')) {
      oauth.push(Object.fromEntries(new URLSearchParams(String(init.body))));
      const r = respond.oauth(oauth.at(-1), init.signal);
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
    }
    return gh.fetch(url, init);
  };
  const credentials = createCredentials({ db, env, fetch, now: () => clock.t });
  await db.upsertAccount({ login: 'example-org', accountId: 1001, accountType: 'Organization', label: 'Example Org', credentialKind: kind });
  if (kind === 'app') {
    await credentials.storeApp(CONVERSION, { ownerLogin: 'example-org', ownerType: 'Organization' });
    await db.upsertAccount({ login: 'example-org', accountId: 1001, accountType: 'Organization', label: 'Example Org', appId: 424242 });
    if (install) await db.setInstallation('example-org', { installationId: 777, repositorySelection: 'all', permissions: { contents: 'write' }, status: 'active' });
  }
  let minted = 0;
  gh.when('POST /app/installations/{installation_id}/access_tokens').reply(201, (req) => ({
    token: `ghs_FAKEinstallation${++minted}`, expires_at: new Date(clock.t + 3600e3).toISOString(), permissions: { contents: 'write' }, repository_selection: 'all', received: req.body
  }));
  return { clock, db, gh, credentials, respond, oauth, fetch, minted: () => minted };
}

describe('storing a GitHub App', () => {
  it('keeps only ciphertext for the key, client secret and webhook secret, and returns none of them', async () => {
    const { db, credentials } = await setup();
    const app = await db.getApp(424242);
    const stored = JSON.stringify(app);
    for (const secret of ['fixture-client-secret-value', 'fixture-webhook-secret-value', 'PRIVATE KEY']) expect(stored).not.toContain(secret);
    expect(app.private_key_enc).toMatch(/^v1\./);
    expect(await credentials.webhookSecret(424242)).toBe('fixture-webhook-secret-value');
    expect(await credentials.clientCredentials(424242)).toEqual({ clientId: 'Iv1.fixtureclientid', clientSecret: 'fixture-client-secret-value' });
    expect(await credentials.webhookSecret(1)).toBeNull();
    const result = await credentials.storeApp(CONVERSION, { ownerLogin: 'example-org', ownerType: 'Organization' });
    for (const secret of ['fixture-client-secret-value', 'fixture-webhook-secret-value', 'PRIVATE KEY']) expect(JSON.stringify(result)).not.toContain(secret);
    expect(result).toEqual({ id: 424242, slug: 'example-org-mcp', client_id: 'Iv1.fixtureclientid' });
  });

  it('refuses an incomplete GitHub response', async () => {
    const { credentials } = await setup();
    for (const field of ['id', 'slug', 'client_id', 'client_secret', 'pem', 'webhook_secret']) {
      await expect(credentials.storeApp({ ...CONVERSION, [field]: undefined }, { ownerLogin: 'x', ownerType: 'User' })).rejects.toThrow(TypeError);
    }
    await expect(credentials.storeApp({ ...CONVERSION, id: -1 }, { ownerLogin: 'x', ownerType: 'User' })).rejects.toThrow(TypeError);
  });

  it('says what to set when the encryption key is missing or wrong, and a changed key cannot read old values', async () => {
    const { db } = await setup();
    const keyless = createCredentials({ db, env: {}, now: () => T0 });
    await expect(keyless.storeApp(CONVERSION, { ownerLogin: 'x', ownerType: 'User' })).rejects.toMatchObject({ code: 'no_credentials', message: expect.stringContaining('TOKEN_ENCRYPTION_KEY') });
    expect(keyless.keyConfigured()).toBe(false);
    const rekeyed = createCredentials({ db, env: { TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64url') }, now: () => T0 });
    const error = await rekeyed.token({ account: 'example-org' }).catch((e) => e);
    expect(error).toMatchObject({ code: 'no_credentials' });
    expect(error.message).toContain('Add the credential again');
    expect(error.message).not.toContain('PRIVATE');
  });
});

describe('installation tokens', () => {
  it('mints with a valid RS256 App JWT, caches until five minutes before expiry, then mints again', async () => {
    const { gh, credentials, clock, minted } = await setup();
    expect(await credentials.token({ account: 'EXAMPLE-ORG' })).toBe('ghs_FAKEinstallation1');
    expect(await credentials.token({ account: 'example-org' })).toBe('ghs_FAKEinstallation1');
    expect(gh.calls).toHaveLength(1);
    const [head, body, sig] = gh.calls[0].headers.authorization.replace(/^Bearer /i, '').split('.');
    expect(JSON.parse(Buffer.from(head, 'base64url'))).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(body, 'base64url'));
    expect(claims.iss).toBe('424242');
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    expect(claims.iat).toBe(Math.floor(T0 / 1000) - 60);
    expect(crypto.createVerify('RSA-SHA256').update(`${head}.${body}`).verify(publicKey, Buffer.from(sig, 'base64url'))).toBe(true);
    expect(gh.calls[0].params.installation_id).toBe('777');
    expect(gh.calls[0].headers['x-github-api-version']).toBe('2026-03-10');
    clock.t += 56 * 60e3; // 4 minutes left: too close to expiry
    expect(await credentials.token({ account: 'example-org' })).toBe('ghs_FAKEinstallation2');
    expect(minted()).toBe(2);
    expect(gh.invalid).toEqual([]);
  });

  it('stores the cached token as ciphertext bound to its installation and scope', async () => {
    const { db, credentials } = await setup();
    await credentials.token({ account: 'example-org' });
    const cached = await db.getInstallationToken(777, 'all');
    expect(cached.token_enc).toMatch(/^v1\./);
    expect(cached.token_enc).not.toContain('FAKEinstallation');
    await db.putInstallationToken(777, scopeKeyOf({ repositories: ['hello'] }), cached.token_enc, new Date(T0 + 3600e3)); // a copy under another scope
    await expect(credentials.token({ account: 'example-org', scope: { repositories: ['hello'] } })).rejects.toMatchObject({ code: 'no_credentials' });
  });

  it('downscopes: each scope is its own token with the repositories and permissions sent to GitHub', async () => {
    const { gh, credentials, minted } = await setup();
    const readOnly = { permissions: { contents: 'read', metadata: 'read' } };
    const one = { repositories: ['hello'], permissions: { contents: 'read' } };
    expect(await credentials.token({ account: 'example-org' })).toBe('ghs_FAKEinstallation1');
    expect(await credentials.token({ account: 'example-org', scope: readOnly })).toBe('ghs_FAKEinstallation2');
    expect(await credentials.token({ account: 'example-org', scope: one })).toBe('ghs_FAKEinstallation3');
    expect(await credentials.token({ account: 'example-org', scope: { permissions: { metadata: 'read', contents: 'read' } } })).toBe('ghs_FAKEinstallation2'); // order does not matter
    expect(minted()).toBe(3);
    expect(gh.calls[1].body).toEqual(readOnly);
    expect(gh.calls[2].body).toEqual(one);
    expect(gh.calls[0].body).toBeUndefined();
    expect(scopeKeyOf(undefined)).toBe('all');
    expect(scopeKeyOf({})).toBe('all');
    expect(scopeKeyOf(readOnly)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('answers in words when the App is missing, not installed, suspended or GitHub refuses', async () => {
    const none = await setup({ install: false });
    await expect(none.credentials.token({ account: 'example-org' })).rejects.toMatchObject({ code: 'no_credentials', message: expect.stringContaining('not installed') });
    await none.db.setInstallation('example-org', { installationId: 777, repositorySelection: 'all', permissions: {}, status: 'suspended' });
    await expect(none.credentials.token({ account: 'example-org' })).rejects.toMatchObject({ message: expect.stringContaining('suspended') });
    await expect(none.credentials.token({ account: 'nobody' })).rejects.toMatchObject({ code: 'no_credentials', message: expect.stringContaining('not one of the accounts') });
    const noApp = await setup({ install: false });
    await noApp.db.setInstallation('example-org', { installationId: 777, repositorySelection: 'all', permissions: {}, status: 'active' });
    await noApp.db.upsertAccount({ login: 'second-org', accountId: 5, accountType: 'Organization', label: 'Second' });
    await noApp.db.setInstallation('second-org', { installationId: 888, repositorySelection: 'all', permissions: {}, status: 'active' });
    await expect(noApp.credentials.token({ account: 'second-org' })).rejects.toMatchObject({ message: expect.stringContaining('no GitHub App') });
    const refused = await setup();
    refused.gh.when('POST /app/installations/{installation_id}/access_tokens').reply(404, { message: 'Not Found' });
    await expect(refused.credentials.token({ account: 'example-org' })).rejects.toMatchObject({ code: 'no_credentials', message: expect.stringContaining('uninstalled') });
    expect((await refused.db.getAccount('example-org')).installation_status).toBe('none');
  });
});

describe('user authorization', () => {
  async function authorized(expiresInSeconds = 28800) {
    const s = await setup();
    await s.credentials.storeUserAuthorization('example-org', { userLogin: 'example-user', accessToken: 'ghu_FAKEuseraccess1', expiresIn: expiresInSeconds, refreshToken: 'ghr_FAKEuserrefresh1', refreshExpiresIn: 15811200 });
    return s;
  }

  it('stores both tokens as ciphertext and returns the access token while it is fresh', async () => {
    const { db, credentials, gh } = await authorized();
    const row = await db.getAccount('example-org');
    expect(JSON.stringify(row)).not.toContain('FAKEuser');
    expect(await credentials.token({ account: 'example-org', cred: 'U' })).toBe('ghu_FAKEuseraccess1');
    expect(gh.calls).toHaveLength(0);
  });

  it('refreshes ten minutes before expiry using the App client credentials and stores the new pair', async () => {
    const { db, credentials, clock, respond, oauth } = await authorized(3600);
    clock.t += 51 * 60e3; // 9 minutes left
    respond.oauth = () => ({ body: { access_token: 'ghu_FAKEuseraccess2', expires_in: 28800, refresh_token: 'ghr_FAKEuserrefresh2', refresh_token_expires_in: 15811200 } });
    expect(await credentials.token({ account: 'example-org', cred: 'U' })).toBe('ghu_FAKEuseraccess2');
    expect(oauth).toEqual([{ client_id: 'Iv1.fixtureclientid', client_secret: 'fixture-client-secret-value', grant_type: 'refresh_token', refresh_token: 'ghr_FAKEuserrefresh1' }]);
    expect(await credentials.token({ account: 'example-org', cred: 'U' })).toBe('ghu_FAKEuseraccess2');
    expect(oauth).toHaveLength(1);
    expect(new Date((await db.getAccount('example-org')).user_token_expires_at).getTime()).toBe(clock.t + 28800e3);
  });

  it('clears the authorization and asks for it again when the refresh is refused', async () => {
    const { db, credentials, clock, respond } = await authorized(3600);
    clock.t += 55 * 60e3;
    respond.oauth = () => ({ body: { error: 'bad_refresh_token' } });
    await expect(credentials.token({ account: 'example-org', cred: 'U' })).rejects.toMatchObject({ code: 'no_credentials', message: expect.stringContaining('has expired') });
    expect(await db.getAccount('example-org')).toMatchObject({ user_token_enc: null, user_refresh_enc: null, user_login: null });
    await expect(credentials.token({ account: 'example-org', cred: 'U' })).rejects.toMatchObject({ message: expect.stringContaining('Authorize as me') });
  });

  it('uses the tokens another instance just stored instead of clearing them when a refresh token was already used', async () => {
    const { db, credentials, clock, respond } = await authorized(3600);
    clock.t += 55 * 60e3;
    respond.oauth = () => ({ body: { error: 'bad_refresh_token' } }); // this instance's refresh token was already spent
    expect(await createRacing(db, credentials)()).toBe('ghu_FAKEuseraccess9');
    expect((await db.getAccount('example-org')).user_token_enc).not.toBeNull();
  });

  it('serializes a one-use user refresh across two server instances and returns one persisted token', async () => {
    const { db, credentials, clock, respond, oauth, fetch } = await authorized(3600);
    clock.t += 55 * 60e3;
    respond.oauth = () => ({ body: { access_token: 'ghu_FAKEuseraccess2', expires_in: 28800,
      refresh_token: 'ghr_FAKEuserrefresh2', refresh_token_expires_in: 15811200 } });
    let release, started;
    const held = new Promise(resolve => { release = resolve; });
    const underway = new Promise(resolve => { started = resolve; });
    const first = createCredentials({ db, env: ENV, now: () => clock.t, fetch: (url, init) => {
      if (String(url).includes('/login/oauth/access_token')) {
        started();
        return held.then(() => fetch(url, init));
      }
      return fetch(url, init);
    } });
    const a = first.token({ account: 'example-org', cred: 'U' });
    await underway;
    const second = credentials.token({ account: 'example-org', cred: 'U' });
    release();
    const values = await Promise.all([a, second]);
    expect(values).toEqual(['ghu_FAKEuseraccess2', 'ghu_FAKEuseraccess2']);
    expect(oauth).toHaveLength(1);
    expect(await db.getAccount('example-org')).toMatchObject({ user_refresh_claim: null, user_refresh_claim_expires_at: null });
  });

  it('sends a bounded provider timeout before another worker may claim the one-use refresh token', async () => {
    const { credentials, clock, respond } = await authorized(3600);
    clock.t += 55 * 60e3;
    let observed;
    respond.oauth = (_fields, signal) => {
      observed = signal;
      return { body: { access_token: 'ghu_FAKErenewedaccess', expires_in: 28800,
        refresh_token: 'ghr_FAKErenewedrefresh', refresh_token_expires_in: 15811200 } };
    };
    expect(await credentials.token({ account: 'example-org', cred: 'U' })).toBe('ghu_FAKErenewedaccess');
    expect(observed).toBeInstanceOf(AbortSignal);
    expect(observed.aborted).toBe(false);
  });

  it('does not erase valid encrypted authorization when GitHub OAuth temporarily fails', async () => {
    const { db, credentials, clock, respond } = await authorized(3600);
    clock.t += 55 * 60e3;
    const before = await db.getAccount('example-org');
    respond.oauth = () => ({ status: 503, body: { message: 'Service unavailable' } });
    await expect(credentials.token({ account: 'example-org', cred: 'U' })).rejects.toMatchObject({
      code: 'rate_limited', message: expect.stringContaining('not erased')
    });
    const after = await db.getAccount('example-org');
    expect(after.user_token_enc).toBe(before.user_token_enc);
    expect(after.user_refresh_enc).toBe(before.user_refresh_enc);
    expect(after.user_refresh_claim).toBeNull();
  });

  it('cannot overwrite a fresh owner authorization while a stale refresh is in flight', async () => {
    const { db, credentials, clock, respond, fetch } = await authorized(3600);
    clock.t += 55 * 60e3;
    respond.oauth = () => ({ body: { access_token: 'ghu_FAKEstaleaccess', expires_in: 28800,
      refresh_token: 'ghr_FAKEstalerefresh', refresh_token_expires_in: 15811200 } });
    let release, started;
    const held = new Promise(resolve => { release = resolve; });
    const underway = new Promise(resolve => { started = resolve; });
    const oldInstance = createCredentials({ db, env: ENV, now: () => clock.t, fetch: (url, init) => {
      if (String(url).includes('/login/oauth/access_token')) { started(); return held.then(() => fetch(url, init)); }
      return fetch(url, init);
    } });
    const request = oldInstance.token({ account: 'example-org', cred: 'U' });
    await underway;
    await credentials.storeUserAuthorization('example-org', { userLogin: 'example-user',
      accessToken: 'ghu_FAKEfreshowner', expiresIn: 28800,
      refreshToken: 'ghr_FAKEfreshowner', refreshExpiresIn: 15811200 });
    release();
    expect(await request).toBe('ghu_FAKEfreshowner');
    expect(await credentials.token({ account: 'example-org', cred: 'U' })).toBe('ghu_FAKEfreshowner');
    expect((await db.getAccount('example-org')).user_refresh_claim).toBeNull();
  });

  it('cannot resurrect a revoked U authorization after an in-flight refresh', async () => {
    const { db, credentials, clock, respond, fetch } = await authorized(3600);
    clock.t += 55 * 60e3;
    respond.oauth = () => ({ body: { access_token: 'ghu_FAKEstaleaccess', expires_in: 28800,
      refresh_token: 'ghr_FAKEstalerefresh', refresh_token_expires_in: 15811200 } });
    let release, started;
    const held = new Promise(resolve => { release = resolve; });
    const underway = new Promise(resolve => { started = resolve; });
    const oldInstance = createCredentials({ db, env: ENV, now: () => clock.t, fetch: (url, init) => {
      if (String(url).includes('/login/oauth/access_token')) { started(); return held.then(() => fetch(url, init)); }
      return fetch(url, init);
    } });
    const request = oldInstance.token({ account: 'example-org', cred: 'U' });
    await underway;
    await credentials.forgetUserAuthorization('example-org');
    release();
    await expect(request).rejects.toMatchObject({ code: 'no_credentials' });
    expect(await db.getAccount('example-org')).toMatchObject({ user_token_enc: null, user_refresh_enc: null, user_refresh_claim: null });
  });

  it('refuses when never authorized or when no refresh token was kept', async () => {
    const { credentials, db, clock } = await setup();
    await expect(credentials.token({ account: 'example-org', cred: 'U' })).rejects.toMatchObject({ message: expect.stringContaining('Authorize as me') });
    await credentials.storeUserAuthorization('example-org', { userLogin: 'example-user', accessToken: 'ghu_FAKEuseraccess1', expiresIn: 3600 });
    clock.t += 55 * 60e3;
    await expect(credentials.token({ account: 'example-org', cred: 'U' })).rejects.toMatchObject({ message: expect.stringContaining('has expired') });
    expect((await db.getAccount('example-org')).user_token_enc).toBeNull();
  });

  it('forgets the authorization on request (a user token that GitHub rejected)', async () => {
    const { credentials, db } = await authorized();
    await credentials.forgetUserAuthorization('example-org');
    expect((await db.getAccount('example-org')).user_token_enc).toBeNull();
  });
});

// A refresh that loses the race: while the refresh request is in flight another instance stores a newer pair.
function createRacing(db, credentials) {
  return async () => {
    const original = db.getAccount.bind(db);
    let calls = 0;
    db.getAccount = async (login) => {
      calls += 1;
      if (calls === 2) { // the first read is token(); the second is the re-read after the failed refresh
        await credentials.storeUserAuthorization('example-org', { userLogin: 'example-user', accessToken: 'ghu_FAKEuseraccess9', expiresIn: 28800, refreshToken: 'ghr_FAKEuserrefresh9', refreshExpiresIn: 15811200 });
      }
      return original(login);
    };
    return await credentials.token({ account: 'example-org', cred: 'U' });
  };
}

describe('fine-grained and classic tokens', () => {
  it('returns a stored fine-grained token for an account that uses one, shows only its last four, and refuses narrowing', async () => {
    const { credentials, db, clock } = await setup({ kind: 'fine_grained' });
    await credentials.storeFineGrained('example-org', 'github_pat_FAKEfinegrained000000000000000ABCD', { expiresAt: new Date(T0 + 86400e3) });
    expect(JSON.stringify(await db.getAccount('example-org'))).not.toContain('FAKEfinegrained');
    expect((await db.listAccounts())[0]).toMatchObject({ has_fine_grained: true, fine_grained_last4: 'ABCD' });
    expect(await credentials.token({ account: 'example-org' })).toBe('github_pat_FAKEfinegrained000000000000000ABCD');
    await expect(credentials.token({ account: 'example-org', scope: { permissions: { contents: 'read' } } })).rejects.toMatchObject({ message: expect.stringContaining('cannot be narrowed') });
    await expect(credentials.token({ account: 'example-org', cred: 'U' })).rejects.toMatchObject({ code: 'no_credentials' });
    clock.t += 2 * 86400e3;
    await expect(credentials.token({ account: 'example-org' })).rejects.toMatchObject({ message: expect.stringContaining('expired') });
  });

  it('says so when a fine-grained account has no token yet', async () => {
    const { credentials } = await setup({ kind: 'fine_grained' });
    await expect(credentials.token({ account: 'example-org' })).rejects.toMatchObject({ message: expect.stringContaining('no fine-grained token') });
  });

  it('stores the classic notifications token separately and returns it only for credential K', async () => {
    const { credentials, db } = await setup();
    await expect(credentials.token({ account: 'example-org', cred: 'K' })).rejects.toMatchObject({ message: expect.stringContaining('no notifications token') });
    await credentials.storeClassic('example-org', 'ghp_FAKEclassic000000000000000000WXYZ', ['notifications']);
    expect(await credentials.token({ account: 'example-org', cred: 'K' })).toBe('ghp_FAKEclassic000000000000000000WXYZ');
    expect(await credentials.token({ account: 'example-org' })).toMatch(/^ghs_FAKEinstallation/);
    expect((await db.listAccounts())[0]).toMatchObject({ has_classic: true, classic_scopes: ['notifications'], classic_last4: 'WXYZ' });
    await expect(credentials.storeClassic('example-org', 'short', ['notifications'])).rejects.toThrow(TypeError);
    await expect(credentials.storeFineGrained('example-org', 'short')).rejects.toThrow(TypeError);
  });

  it('a ciphertext copied to another account cannot be opened there', async () => {
    const { credentials, db } = await setup({ kind: 'fine_grained' });
    await db.upsertAccount({ login: 'other-org', accountId: 2, accountType: 'Organization', label: 'Other', credentialKind: 'fine_grained' });
    await credentials.storeFineGrained('example-org', 'github_pat_FAKEfinegrained000000000000000ABCD');
    const { fine_grained_enc } = await db.getAccount('example-org');
    await db.setFineGrainedToken('other-org', { enc: fine_grained_enc, last4: 'ABCD' });
    await expect(credentials.token({ account: 'other-org' })).rejects.toMatchObject({ code: 'no_credentials', message: expect.stringContaining('could not be read') });
  });
});

describe('through the GitHub client', () => {
  it('githubFor asks the store for the right credential and sends it to GitHub', async () => {
    const { gh, db, credentials, fetch, clock } = await setup();
    gh.when('GET /repos/{owner}/{repo}').reply(200, { id: 1 });
    const ctx = { connection: { client_id: 'c', default_account: 'example-org', accounts: ['example-org'], mode: 'preview', profile: 'everyday', listing: 'catalog' }, db, credentials, fetch, now: () => clock.t, sleep: async () => {} };
    const octokit = await githubFor(ctx, {});
    await octokit.request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' });
    const call = gh.calls.at(-1);
    expect(call.route).toBe('GET /repos/{owner}/{repo}');
    expect(call.headers.authorization).toBe('token ghs_FAKEinstallation1');
  });
});

describe('no secret appears in an error', () => {
  it('none of the plain-language errors contains a key, token or secret', async () => {
    const s = await setup();
    const errors = [];
    const grab = (p) => p.catch((e) => errors.push(`${e.message} ${JSON.stringify(e.details ?? {})}`));
    await grab(s.credentials.token({ account: 'example-org', cred: 'U' }));
    await grab(s.credentials.token({ account: 'example-org', cred: 'K' }));
    await grab(s.credentials.token({ account: 'nobody' }));
    await grab(createCredentials({ db: s.db, env: {}, now: () => T0 }).token({ account: 'example-org' }));
    await grab(s.credentials.storeApp({ ...CONVERSION, pem: '' }, { ownerLogin: 'x', ownerType: 'User' }));
    const text = errors.join('\n');
    expect(errors).toHaveLength(5);
    for (const secret of ['fixture-client-secret-value', 'fixture-webhook-secret-value', 'BEGIN', ENV.TOKEN_ENCRYPTION_KEY]) expect(text).not.toContain(secret);
  });
});

describe('the App JWT', () => {
  it('is signed with the stored key, backdated sixty seconds, and expires within ten minutes', async () => {
    const { credentials } = await setup();
    const jwt = await credentials.appJwt(424242);
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url'));
    expect(claims.iat).toBe(Math.floor(T0 / 1000) - 60);
    expect(claims.exp - Math.floor(T0 / 1000)).toBeLessThanOrEqual(600);
    await expect(credentials.appJwt(1)).rejects.toMatchObject({ code: 'no_credentials' });
    expect(signAppJwt({ appId: 1, privateKey: PEM, now: () => T0 }).split('.')).toHaveLength(3);
  });
});
