import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { createDb } from '../../src/db.js';
import { createTenantDirectory } from '../../src/tenancy/directory.js';
import { createOAuthHandlers } from '../../src/core/oauth-handlers.js';
import { createGithubPolicy } from '../../src/oauth/policy.js';
import { MUSE_PUBLIC_CLIENT_ID, MUSE_REDIRECT_URI } from '../../src/tenancy/muse-client.js';
import { hashToken } from '../../src/core/oauth.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery } from '../../test/helpers/pg-neon-adapter.js';
import { call, json, request } from '../../test/helpers/http-harness.js';

const env = { PUBLIC_BASE_URL: 'https://github.example.test', ADMIN_PASSPHRASE: 'fixture-owner-passphrase' };
const redirect = 'https://agent.meta.ai/api/hatch/oauth/callback';
const verifier = 'x'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
let db, directory, handlers;
beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname))
    throw new Error('Requires disposable localhost PostgreSQL');
  await openIsolatedSchema(url);
  directory = createTenantDirectory(neonShapedQuery());
  await directory.initSchema();
  db = createDb(neonShapedQuery());
  await db.initSchema();
  await rawQuery("INSERT INTO gh_accounts (login,account_id,account_type,label,production_enabled,is_default) VALUES ('example-user',1,'User','Example user',FALSE,TRUE)");
  handlers = createOAuthHandlers({ db, env, policy: createGithubPolicy({ env }) });
});
afterAll(async () => { await closeIsolatedSchema(); });

const params = (client, extra = {}) => ({
  client_id: client.client_id, redirect_uri: redirect, response_type: 'code',
  code_challenge: challenge, code_challenge_method: 'S256',
  'acct:example-user': 'on', default_account: 'example-user',
  mode: 'preview', profile: 'read_only', listing: 'compact', state: 'muse-state', ...extra
});
const register = (method) => call(handlers.register, request('POST', {
  redirect_uris: [redirect], client_name: 'Muse public test',
  token_endpoint_auth_method: method
}));

describe('Muse OAuth against isolated real PostgreSQL', () => {
  it('stores independent public versus confidential client modes and preserves confidential authentication', async () => {
    const publicResponse = await register('none');
    expect(publicResponse.statusCode).toBe(201);
    const publicClient = json(publicResponse);
    expect(publicClient.client_id).toBeTruthy();
    expect(publicClient).not.toHaveProperty('client_secret');
    expect((await db.getOAuthClient(publicClient.client_id)).token_endpoint_auth_method).toBe('none');
    const confidential = json(await register('client_secret_post'));
    expect(confidential.client_secret).toBeTruthy();
    expect((await db.getOAuthClient(confidential.client_id)).token_endpoint_auth_method).toBe('client_secret_post');
    const issued = await call(handlers.authorize, request('POST', params(confidential, { passphrase: env.ADMIN_PASSPHRASE })));
    expect(issued.statusCode).toBe(302);
    const code = new URL(issued.headers.Location).searchParams.get('code');
    const body = { client_id: confidential.client_id, code, redirect_uri: redirect, code_verifier: verifier, grant_type: 'authorization_code' };
    expect((await call(handlers.token, request('POST', body))).statusCode).toBe(401);
    expect((await call(handlers.token, request('POST', { ...body, client_secret: confidential.client_secret }))).statusCode).toBe(200);
  });

  it('uses per-client PKCE and refresh binding when Muse omits resource and secret', async () => {
    const publicClient = json(await register('none'));
    const other = json(await register('none'));
    const authorized = await call(handlers.authorize, request('POST', params(publicClient, {
      passphrase: env.ADMIN_PASSPHRASE, resource: undefined
    })));
    expect(authorized.statusCode).toBe(302);
    const code = new URL(authorized.headers.Location).searchParams.get('code');
    const body = { client_id: publicClient.client_id, code, redirect_uri: redirect, code_verifier: verifier, grant_type: 'authorization_code' };
    expect((await call(handlers.token, request('POST', { ...body, resource: 'https://foreign.example.test/api/mcp' }))).statusCode).toBe(400);
    const tokens = json(await call(handlers.token, request('POST', body)));
    expect(tokens.access_token).toBeTruthy();
    expect((await call(handlers.token, request('POST', { client_id: other.client_id, refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }))).statusCode).toBe(400);
    const next = await call(handlers.token, request('POST', { client_id: publicClient.client_id, refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }));
    expect(next.statusCode).toBe(200);
    expect(json(next).refresh_token).not.toBe(tokens.refresh_token);
  });

  it('keeps a single Muse fallback registration tied to Meta and separate from other public clients', async () => {
    await directory.ensureMusePublicClient(MUSE_PUBLIC_CLIENT_ID, MUSE_REDIRECT_URI, hashToken('fixture-unusable-placeholder'));
    const saved = await directory.getPublicClient(MUSE_PUBLIC_CLIENT_ID);
    expect(saved).toMatchObject({ clientId: MUSE_PUBLIC_CLIENT_ID, authMethod: 'none', redirectUris: [redirect] });
    await directory.ensureMusePublicClient(MUSE_PUBLIC_CLIENT_ID, MUSE_REDIRECT_URI, hashToken('different-unusable-placeholder'));
    expect((await directory.getPublicClient(MUSE_PUBLIC_CLIENT_ID)).secretHash).toBe(saved.secretHash);
    await expect(directory.ensureMusePublicClient(MUSE_PUBLIC_CLIENT_ID, 'https://attacker.example.test/cb', hashToken('x'))).rejects.toThrow();
    const newClient = await directory.createPublicClient({ clientId: 'pcl_' + 'a'.repeat(32), secretHash: hashToken('random-placeholder'),
      redirectUris: ['https://legitimate.example.test/cb'], authMethod: 'none', clientName: 'Other user', maxClients: 10000 });
    expect(newClient).toBe(true);
    expect((await directory.getPublicClient('pcl_' + 'a'.repeat(32))).redirectUris).toEqual(['https://legitimate.example.test/cb']);
  });
});
