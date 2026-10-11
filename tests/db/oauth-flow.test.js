import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createDb } from '../../src/db.js';
import { createOAuthHandlers } from '../../src/core/oauth-handlers.js';
import { createGithubPolicy } from '../../src/oauth/policy.js';
import { requireMcpToken } from '../../src/core/mcp-auth.js';
import { openIsolatedSchema, closeIsolatedSchema, neonShapedQuery, rawQuery } from '../../test/helpers/pg-neon-adapter.js';
import { call, json, request, response } from '../../test/helpers/http-harness.js';

const env = { PUBLIC_BASE_URL: 'https://github-mcp.example.test', ADMIN_PASSPHRASE: 'only-the-owner-knows', VERCEL_ENV: 'production' };
const resource = env.PUBLIC_BASE_URL + '/api/mcp';
const callback = 'https://client.example.test/cb';
const verifier = 'a'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');

let db;
let h;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must point to disposable localhost Postgres (npm run test:db)');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(process.env.TEST_DATABASE_URL).hostname)) throw new Error('Refusing non-local Postgres in tests');
  await openIsolatedSchema(process.env.TEST_DATABASE_URL);
  db = createDb(neonShapedQuery());
  await db.initSchema();
  await rawQuery(`INSERT INTO gh_accounts (login, account_id, account_type, label, production_enabled, is_default) VALUES
    ('example-org', 1, 'Organization', 'Example Org', FALSE, TRUE), ('example-user', 2, 'User', 'Example User', TRUE, FALSE)`);
  h = createOAuthHandlers({ db, env, policy: createGithubPolicy({ env }) });
});
afterAll(async () => { await closeIsolatedSchema(); });

describe('connector login end to end on throwaway Postgres', () => {
  it('registers, signs in, exchanges the code, refreshes, and the MCP gate sees every setting each time', async () => {
    const client = json(await call(h.register, request('POST', { redirect_uris: [callback], client_name: 'Personal agent' })));
    const form = {
      client_id: client.client_id, redirect_uri: callback, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource, state: 's',
      'acct:example-org': 'on', 'acct:example-user': 'on', default_account: 'example-user', mode: 'preview', profile: 'read_only', listing: 'compact'
    };
    const page = await call(h.authorize, request('GET', form));
    expect(page.body).toContain('Example Org');

    const production = await call(h.authorize, request('POST', { ...form, mode: 'production', passphrase: env.ADMIN_PASSPHRASE }));
    expect(production.statusCode).toBe(400);
    expect(production.body).toContain('Production is not turned on for: example-org.');
    expect(Number((await rawQuery('SELECT count(*) FROM oauth_codes'))[0].count)).toBe(0);

    const authorized = await call(h.authorize, request('POST', { ...form, passphrase: env.ADMIN_PASSPHRASE }));
    expect(authorized.statusCode).toBe(302);
    const code = new URL(authorized.headers.Location).searchParams.get('code');
    const exchange = { grant_type: 'authorization_code', client_id: client.client_id, client_secret: client.client_secret, redirect_uri: callback, code, code_verifier: verifier, resource };
    const first = json(await call(h.token, request('POST', exchange)));
    expect((await call(h.token, request('POST', exchange))).statusCode).toBe(400);

    const toConnection = createGithubPolicy({ env }).toConnection;
    const expected = { client_id: client.client_id, default_account: 'example-user', accounts: ['example-org', 'example-user'], mode: 'preview', profile: 'read_only', listing: 'compact' };
    const gate = (token) => requireMcpToken(request('POST', {}, { authorization: `Bearer ${token}` }), response(), db, env, { toConnection });
    expect(await gate(first.access_token)).toEqual(expected);

    const refresh = (token) => call(h.token, request('POST', { grant_type: 'refresh_token', client_id: client.client_id, client_secret: client.client_secret, refresh_token: token, resource }));
    const second = json(await refresh(first.refresh_token));
    expect(await gate(second.access_token)).toEqual(expected);
    expect(await gate(first.access_token)).toBeNull();
    expect((await refresh(first.refresh_token)).statusCode).toBe(400);
    const third = json(await refresh(second.refresh_token));
    expect(await gate(third.access_token)).toEqual(expected);
  });

  it('grants production to the one account that has it turned on, and the MCP gate then accepts it on the production deployment', async () => {
    const client = json(await call(h.register, request('POST', { redirect_uris: [callback] })));
    const form = {
      client_id: client.client_id, redirect_uri: callback, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource,
      'acct:example-user': 'on', default_account: 'example-user', mode: 'production', profile: 'full', listing: 'catalog', passphrase: env.ADMIN_PASSPHRASE
    };
    const authorized = await call(h.authorize, request('POST', form));
    expect(authorized.statusCode).toBe(302);
    const code = new URL(authorized.headers.Location).searchParams.get('code');
    const tokens = json(await call(h.token, request('POST', { grant_type: 'authorization_code', client_id: client.client_id, client_secret: client.client_secret, redirect_uri: callback, code, code_verifier: verifier, resource })));
    const connection = await requireMcpToken(request('POST', {}, { authorization: `Bearer ${tokens.access_token}` }), response(), db, env, { toConnection: createGithubPolicy({ env }).toConnection });
    expect(connection).toMatchObject({ mode: 'production', accounts: ['example-user'], profile: 'full', listing: 'catalog' });
    const preview = { ...env, VERCEL_ENV: 'preview' };
    const refused = response();
    expect(await requireMcpToken(request('POST', {}, { authorization: `Bearer ${tokens.access_token}` }), refused, db, preview, { toConnection: createGithubPolicy({ env: preview }).toConnection })).toBeNull();
    expect(refused.statusCode).toBe(403);
  });
});
