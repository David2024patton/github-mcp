// Contract for the connector login store (A-3a). Run against the in-memory fake and against real PostgreSQL so the two
// cannot drift. `make()` returns a fresh database exposing the store plus `seedAccounts(list)` and `initSchema()`.
import { describe, expect, it } from 'vitest';
import { CONNECTION_FIELDS } from '../../src/db.js';
import { hashToken } from '../../src/core/oauth.js';

const REDIRECT = 'https://example.test/cb';
const SCOPE = { defaultAccount: 'example-org', accounts: ['example-org', 'example-user'], mode: 'preview', profile: 'read_only', listing: 'compact' };
const SETTINGS = { default_account: 'example-org', accounts: ['example-org', 'example-user'], mode: 'preview', profile: 'read_only', listing: 'compact' };

export function runOAuthContract(name, make) {
  describe(`connector login store: ${name}`, () => {
    it('reports only aggregate custom-MCP client/session readiness, including expired and revoked behavior',async()=>{
      const db=await make();
      expect(await db.getConnectorOAuthReadiness()).toEqual({
        registered_clients:0,unrevoked_sessions:0,usable_access_tokens:0,refresh_credentials:0});
      await db.createOAuthClient({clientId:'readiness-client',clientSecret:'not-a-real-secret',
        redirectUris:[REDIRECT],clientName:'Fixture'});
      expect(await db.getConnectorOAuthReadiness()).toMatchObject({registered_clients:1,
        unrevoked_sessions:0,usable_access_tokens:0,refresh_credentials:0});
      await db.createAccessToken({accessToken:'readiness-live',refreshToken:'readiness-refresh',
        clientId:'readiness-client',...SCOPE});
      expect(await db.getConnectorOAuthReadiness()).toEqual({
        registered_clients:1,unrevoked_sessions:1,usable_access_tokens:1,refresh_credentials:1});
      await db.createAccessToken({accessToken:'readiness-expired',refreshToken:'expired-refresh',
        clientId:'readiness-client',ttlSeconds:-20,...SCOPE});
      expect(await db.getConnectorOAuthReadiness()).toEqual({
        registered_clients:1,unrevoked_sessions:2,usable_access_tokens:1,refresh_credentials:2});
      expect(await db.revokeAccessToken('readiness-live')).toBe(true);
      expect(await db.getConnectorOAuthReadiness()).toEqual({
        registered_clients:1,unrevoked_sessions:1,usable_access_tokens:0,refresh_credentials:1});
    });
    it('registers a client keeping only the hash of its secret', async () => {
      const db = await make();
      await db.createOAuthClient({ clientId: 'client-1', clientSecret: 'fixture-secret-not-real', redirectUris: [REDIRECT], clientName: 'Example' });
      const client = await db.getOAuthClient('client-1');
      expect(client).toMatchObject({ client_id: 'client-1', client_secret_hash: hashToken('fixture-secret-not-real'), redirect_uris: [REDIRECT], client_name: 'Example' });
      expect(JSON.stringify(client)).not.toContain('fixture-secret-not-real');
      expect(await db.getOAuthClient('nobody')).toBeNull();
      await expect(db.createOAuthClient({ clientId: 'client-2', clientSecret: '', redirectUris: [REDIRECT] })).rejects.toThrow(TypeError);
      await expect(db.createOAuthClient({ clientId: 'client-3', clientSecret: 'x', redirectUris: [] })).rejects.toThrow(TypeError);
    });

    it('consumes an authorization code once, with every connection setting, and refuses expired codes', async () => {
      const db = await make();
      await db.createAuthCode({ code: 'code-A', clientId: 'client-1', redirectUri: REDIRECT, codeChallenge: 'Z'.repeat(43), ...SCOPE });
      const consumed = await db.consumeAuthCode('code-A');
      expect(consumed).toMatchObject({ client_id: 'client-1', redirect_uri: REDIRECT, code_challenge: 'Z'.repeat(43), code_challenge_method: 'S256', ...SETTINGS });
      expect(await db.consumeAuthCode('code-A')).toBeNull();
      await db.createAuthCode({ code: 'old-code', clientId: 'client-1', redirectUri: REDIRECT, ttlSeconds: -10, ...SCOPE });
      expect(await db.consumeAuthCode('old-code')).toBeNull();
      expect(await db.consumeAuthCode('')).toBeNull();
      expect(await db.consumeAuthCode(undefined)).toBeNull();
    });

    it('refuses connection settings that are inconsistent or unknown, for codes and tokens alike', async () => {
      const db = await make();
      const bad = [
        { ...SCOPE, accounts: [] },
        { ...SCOPE, accounts: undefined },
        { ...SCOPE, accounts: ['example-org', 'example-org'] },
        { ...SCOPE, defaultAccount: 'someone-else' },
        { ...SCOPE, defaultAccount: undefined },
        { ...SCOPE, mode: 'live' },
        { ...SCOPE, profile: 'admin' },
        { ...SCOPE, listing: 'everything' }
      ];
      for (const scope of bad) {
        await expect(db.createAuthCode({ code: 'c', clientId: 'client-1', redirectUri: REDIRECT, ...scope })).rejects.toThrow(TypeError);
        await expect(db.createAccessToken({ accessToken: 'a', refreshToken: 'r', clientId: 'client-1', ...scope })).rejects.toThrow(TypeError);
      }
    });

    it('stores defaults of preview, everyday and catalog only when the caller names none of them', async () => {
      const db = await make();
      await db.createAccessToken({ accessToken: 'access-D', refreshToken: 'refresh-D', clientId: 'client-1', defaultAccount: 'example-org', accounts: ['example-org'] });
      expect(await db.getAccessToken('access-D')).toMatchObject({ mode: 'preview', profile: 'everyday', listing: 'catalog', kind: 'connector', accounts: ['example-org'] });
    });

    it('looks tokens up only while they are live, and revokes them once', async () => {
      const db = await make();
      await db.createAccessToken({ accessToken: 'access-A', refreshToken: 'refresh-A', clientId: 'client-1', ...SCOPE });
      const found = await db.getAccessToken('access-A');
      expect(found).toMatchObject({ client_id: 'client-1', kind: 'connector', ...SETTINGS });
      expect(found.expires_at).toBeInstanceOf(Date);
      expect(await db.getAccessToken('access-unknown')).toBeNull();
      expect(await db.getAccessToken('')).toBeNull();
      await db.createAccessToken({ accessToken: 'access-old', refreshToken: 'refresh-old', clientId: 'client-1', ttlSeconds: -10, ...SCOPE });
      expect(await db.getAccessToken('access-old')).toBeNull();
      expect(await db.revokeAccessToken('access-A')).toBe(true);
      expect(await db.getAccessToken('access-A')).toBeNull();
      expect(await db.getTokenByRefreshToken('refresh-A')).toBeNull();
      expect(await db.revokeAccessToken('access-A')).toBe(false);
      expect(await db.revokeAccessToken('never-issued')).toBe(false);
    });

    it('keeps every connection setting across an atomic refresh, once, for the same client only', async () => {
      const db = await make();
      const scope = { defaultAccount: 'example-user', accounts: ['example-org', 'example-user'], mode: 'production', profile: 'full', listing: 'compact' };
      await db.createAccessToken({ accessToken: 'access-A', refreshToken: 'refresh-A', clientId: 'client-1', ...scope });
      const expected = { default_account: 'example-user', accounts: ['example-org', 'example-user'], mode: 'production', profile: 'full', listing: 'compact' };
      expect(await db.getTokenByRefreshToken('refresh-A')).toMatchObject({ client_id: 'client-1', ...expected });
      expect(await db.rotateRefreshToken({ refreshToken: 'refresh-A', clientId: 'other-client', accessToken: 'bad', newRefreshToken: 'bad-r' })).toBeNull();
      expect(await db.rotateRefreshToken({ refreshToken: 'refresh-A', clientId: '', accessToken: 'bad', newRefreshToken: 'bad-r' })).toBeNull();
      expect(await db.rotateRefreshToken({ refreshToken: 'no-such-refresh', clientId: 'client-1', accessToken: 'bad', newRefreshToken: 'bad-r' })).toBeNull();

      const base = { refreshToken: 'refresh-A', clientId: 'client-1' };
      const results = await Promise.all([
        db.rotateRefreshToken({ ...base, accessToken: 'access-B', newRefreshToken: 'refresh-B' }),
        db.rotateRefreshToken({ ...base, accessToken: 'access-C', newRefreshToken: 'refresh-C' })
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const [winner] = results.filter(Boolean);
      expect(winner).toMatchObject({ client_id: 'client-1', ...expected });
      for (const field of CONNECTION_FIELDS) expect(winner[field]).toEqual(expected[field]);

      expect(await db.getTokenByRefreshToken('refresh-A')).toBeNull();
      expect(await db.getAccessToken('access-A')).toBeNull();
      const winningAccess = results[0] ? 'access-B' : 'access-C';
      const winningRefresh = results[0] ? 'refresh-B' : 'refresh-C';
      expect(await db.getAccessToken(winningAccess)).toMatchObject(expected);
      expect(await db.getAccessToken(results[0] ? 'access-C' : 'access-B')).toBeNull();

      expect(await db.revokeAccessToken(winningAccess)).toBe(true);
      expect(await db.getTokenByRefreshToken(winningRefresh)).toBeNull();
      expect(await db.rotateRefreshToken({ refreshToken: winningRefresh, clientId: 'client-1', accessToken: 'access-D', newRefreshToken: 'refresh-D' })).toBeNull();
    });

    it('lets a refresh work after the access token expired, until the connection is revoked', async () => {
      const db = await make();
      await db.createAccessToken({ accessToken: 'access-X', refreshToken: 'refresh-X', clientId: 'client-1', ttlSeconds: -10, ...SCOPE });
      expect(await db.getAccessToken('access-X')).toBeNull();
      const rotated = await db.rotateRefreshToken({ refreshToken: 'refresh-X', clientId: 'client-1', accessToken: 'access-Y', newRefreshToken: 'refresh-Y' });
      expect(rotated).toMatchObject(SETTINGS);
      expect(await db.getAccessToken('access-Y')).toMatchObject(SETTINGS);
    });

    it('counts failed logins per address and never counts a succeeded attempt', async () => {
      const db = await make();
      const first = await db.recordLoginAttempt('192.0.2.20');
      expect(await db.countRecentFailedLogins('192.0.2.20', 15)).toBe(1);
      await db.markLoginAttemptSucceeded(first);
      expect(await db.countRecentFailedLogins('192.0.2.20', 15)).toBe(0);
      await db.recordLoginAttempt('192.0.2.20');
      expect(await db.countRecentFailedLogins('192.0.2.21', 15)).toBe(0);
      expect(await db.countRecentFailedLogins('192.0.2.20', 15)).toBe(1);
    });

    it('lists the accounts for the login page: default first, then by name, with the production switch and no credentials', async () => {
      const db = await make();
      expect(await db.listAccountsForLogin()).toEqual([]);
      await db.seedAccounts([
        { login: 'zeta', label: 'Zeta', production_enabled: false, is_default: false },
        { login: 'alpha', label: 'Alpha', production_enabled: true, is_default: false },
        { login: 'example-org', label: 'Example', production_enabled: false, is_default: true }
      ]);
      expect(await db.listAccountsForLogin()).toEqual([
        { login: 'example-org', label: 'Example', production_enabled: false, is_default: true },
        { login: 'alpha', label: 'Alpha', production_enabled: true, is_default: false },
        { login: 'zeta', label: 'Zeta', production_enabled: false, is_default: false }
      ]);
    });
  });
}
