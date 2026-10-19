import { describe, expect, it, vi } from 'vitest';
import { verifyGithubBearerIdentity, resolvePrivatePilotIdentity } from '../../src/tenancy/github-identity.js';

const bearer = 'fixture-oauth-bearer-never-real';
const tenantId = '5ca85cbb-2222-4222-8222-333333333333';
const identityId = '5ca85cbb-2222-4222-8222-444444444444';

const jsonResponse = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data
});

describe('PUB-2 closed pilot identity proof', () => {
  it('verifies only a GitHub-owned immutable numeric /user subject, not email/login assertion', async () => {
    const mockFetch = vi.fn(async () => jsonResponse({
      id: 123456789, login: 'GitHub-Proof-User', type: 'User',
      email: 'not-a-principal@example.com'
    }));
    const principal = await verifyGithubBearerIdentity(bearer, { fetchImpl: mockFetch });
    expect(principal).toEqual({ provider: 'github', subject: '123456789', login: 'GitHub-Proof-User' });
    expect(JSON.stringify(principal)).not.toContain(bearer);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.github.com/user');
    expect(options.method).toBe('GET');
    expect(options.headers.authorization).toBe('Bearer ' + bearer);
  });

  it('rejects forged identities, errors and malformed provider response, with no bearer in errors', async () => {
    const fakes = [
      jsonResponse({ id: 1, login: 'alice', type: 'User' }, 401),
      jsonResponse({ id: 1, login: 'alice', type: 'User' }, 403),
      jsonResponse({ id: 'abc', login: 'alice', type: 'User' }),
      jsonResponse({ id: 7, login: 'alice', type: 'Organization' }),
      jsonResponse({ id: 7, login: '<script>', type: 'User' }),
      jsonResponse({ id: 7, login: '', type: 'User' }),
      jsonResponse({ id: Number.MAX_SAFE_INTEGER + 1, login: 'alice', type: 'User' }),
    ];
    for (const response of fakes) {
      await expect(verifyGithubBearerIdentity(bearer, {
        fetchImpl: async () => response })).rejects.toThrow();
    }
    await expect(verifyGithubBearerIdentity(bearer, {
      fetchImpl: async () => { throw new Error('underlying transport echoed ' + bearer); }
    })).rejects.not.toThrow(bearer);
    await expect(verifyGithubBearerIdentity('bad token')).rejects.toThrow(/bearer/);
  });

  it('refuses every call while pilot disabled without even contacting provider', async () => {
    const fetchImpl = vi.fn();
    const directory = { resolveAllowlistedPilotSubject: vi.fn(), authorized: vi.fn() };
    await expect(resolvePrivatePilotIdentity({
      oauthBearer: bearer, trustedTenantId: tenantId, directory,
      env: {}, fetchImpl
    })).rejects.toThrow(/disabled/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(directory.resolveAllowlistedPilotSubject).not.toHaveBeenCalled();
  });

  it('requires both provider proof and existing tenant allowlist / current membership', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: 456, login: 'pilot-user', type: 'User' }));
    const allowed = {
      identityId, tenantId, namespace: 'gh_t_5ca85cbb222242228222333333333333',
      membershipRevision: 4, pilotRevision: 2, role: 'member'
    };
    const directory = {
      resolveAllowlistedPilotSubject: vi.fn(async () => allowed),
      authorized: vi.fn(async () => ({ namespace: allowed.namespace, membershipRevision: 4 }))
    };
    const p = { oauthBearer: bearer, trustedTenantId: tenantId, directory,
      env: { GITHUB_PRIVATE_TENANT_PILOT: 'enabled' }, fetchImpl };
    expect((await resolvePrivatePilotIdentity(p)).tenant).toEqual(allowed);
    expect(directory.resolveAllowlistedPilotSubject).toHaveBeenCalledWith(tenantId, '456');
    expect(directory.authorized).toHaveBeenCalledWith(tenantId, identityId);
    directory.authorized.mockResolvedValueOnce({ namespace: allowed.namespace, membershipRevision: 5 });
    await expect(resolvePrivatePilotIdentity(p)).rejects.toThrow(/no longer active/);
    directory.resolveAllowlistedPilotSubject.mockResolvedValueOnce(null);
    await expect(resolvePrivatePilotIdentity(p)).rejects.toThrow(/no approved private tenant/);
  });

  it('does not reveal tenant identity when provider bearer verification fails', async () => {
    const directory = { resolveAllowlistedPilotSubject: vi.fn(), authorized: vi.fn() };
    await expect(resolvePrivatePilotIdentity({
      oauthBearer: bearer, trustedTenantId: tenantId, directory,
      env: { GITHUB_PRIVATE_TENANT_PILOT: 'enabled' },
      fetchImpl: async () => jsonResponse({}, 401)
    })).rejects.toThrow(/verification/);
    expect(directory.resolveAllowlistedPilotSubject).not.toHaveBeenCalled();
  });
});
