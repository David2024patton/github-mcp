import { describe, expect, it, vi } from 'vitest';
import { verifyGithubBearerIdentity, verifyGithubUserInstallation, resolvePrivatePilotIdentity } from '../../src/tenancy/github-identity.js';

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

describe('PUB-4 multi-page provider installation proof for independent clients',()=>{
  const bearer='fixture-verifiable-oauth-token';
  const target={installationId:550201,appId:550202,accountId:550203};
  const entry=i=>({id:550000+i,app_id:550202,
    account:{id:550203},suspended_at:null});
  const response=(total_count,installations,status=200)=>({
    ok:status===200,status,json:async()=>({total_count,installations})
  });
  it('accepts an exact App installation only after all three pages complete',async()=>{
    const pages=[
      Array.from({length:100},(_,i)=>entry(i+1)),
      Array.from({length:100},(_,i)=>entry(i+101)),
      [entry(201),entry(202)]
    ];
    const calls=[];
    const fetchImpl=async(url,options)=>{
      calls.push(url);
      expect(options.headers.authorization).toBe('Bearer '+bearer);
      return response(202,pages[calls.length-1]);
    };
    expect(await verifyGithubUserInstallation(bearer,{...target,fetchImpl})).toBe(true);
    expect(calls).toEqual([
      'https://api.github.com/user/installations?per_page=100',
      'https://api.github.com/user/installations?per_page=100&page=2',
      'https://api.github.com/user/installations?per_page=100&page=3'
    ]);
    expect(await verifyGithubUserInstallation(bearer,{
      ...target,accountId:999999,fetchImpl:async()=>response(1,[entry(201)])
    })).toBe(false);
  });
  it('fails closed on partial, changed, duplicate, denied and oversized inventories',async()=>{
    const first=[entry(201),...Array.from({length:99},(_,i)=>entry(i+1))];
    const check=async(other)=>{
      let page=0;
      return verifyGithubUserInstallation(bearer,{...target,
        fetchImpl:async()=>page++===0?response(101,first):other});
    };
    expect(await check(response(101,[]))).toBe(false);
    expect(await check(response(100,[entry(102)]))).toBe(false);
    expect(await check(response(101,[first[0]]))).toBe(false);
    expect(await verifyGithubUserInstallation(bearer,{...target,
      fetchImpl:async()=>response(101,first,403)})).toBe(false);
    expect(await verifyGithubUserInstallation(bearer,{...target,
      fetchImpl:async()=>response(2001,first)})).toBe(false);
    expect(await verifyGithubUserInstallation(bearer,{...target,
      fetchImpl:async()=>{throw Error('Sensitive provider error '+bearer);}})).toBe(false);
  });
});
