import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, request } from '../../test/helpers/http-harness.js';
import consentPage from '../../api/tenant/oauth/authorize.js';
import consentCallback from '../../api/tenant/oauth/callback.js';
import { issueTenantCredential } from '../../src/tenancy/routed-credential.js';

const tenantId='5ca85cbb-2222-4222-8222-333333333333';
const identityId='5ca85cbb-2222-4222-8222-444444444444';
const origin='https://pilot.github.example.test';
const makeEnv=()=>{
  vi.stubEnv('PUBLIC_BASE_URL',origin);
  vi.stubEnv('GITHUB_PRIVATE_TENANT_PILOT','enabled');
  vi.stubEnv('GITHUB_TENANT_ROUTING_KEY',randomBytes(32).toString('base64url'));
  vi.stubEnv('VERCEL_ENV','production');
  return process.env;
};
afterEach(()=>vi.unstubAllEnvs());

describe('PUB-2 private browser entry routes',()=>{
  it('denies all browser authorization and callbacks by default, including POST',async()=>{
    vi.stubEnv('GITHUB_PRIVATE_TENANT_PILOT','disabled');
    expect((await call(consentPage,request('GET',{client_id:'unknown'}))).statusCode).toBe(403);
    expect((await call(consentPage,request('POST',{client_id:'unknown'}))).statusCode).toBe(403);
    expect((await call(consentCallback,request('GET',{state:'x',code:'y'}))).statusCode).toBe(403);
  });
  it('offers a mobile-sized form with zero tenant account disclosure and requires signed client',async()=>{
    const env=makeEnv();
    const clientId=issueTenantCredential('tcl',{tenantId,identityId,membershipRevision:1,pilotRevision:1},env);
    const params={client_id:clientId,redirect_uri:'https://app.example.test/cb',
      resource:origin+'/api/mcp',response_type:'code',code_challenge:'a'.repeat(43),
      code_challenge_method:'S256',state:'testcaller'};
    const response=await call(consentPage,request('GET',params));
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('GitHub by Robinson AI Systems');
    expect(response.body).toContain('<select name="mode">');
    expect(response.body).toContain('<option value="production">');
    expect(response.body).toContain('<select name="profile">');
    expect(response.body).toContain('Continue to GitHub');
    expect(response.body).not.toContain('robinson-ai-scratch');
    expect(response.body).not.toContain('ADMIN_PASSPHRASE');
    expect(response.headers['Set-Cookie']).toContain('gh_tenant_pilot_form=');
    expect((await call(consentPage,request('GET',{...params,client_id:'tcl_forged'}))).statusCode).toBe(403);
    const denied=await call(consentPage,request('POST',{...params,mode:'full',
      form_csrf:'not-authentic'},{origin}));
    expect(denied.statusCode).toBe(403);
  });
  it('does not offer PRODUCTION choices on a nonproduction deployment',async()=>{
    const env=makeEnv();
    vi.stubEnv('VERCEL_ENV','preview');
    const token=issueTenantCredential('tcl',{tenantId,identityId,membershipRevision:1,pilotRevision:1},env);
    const response=await call(consentPage,request('GET',{client_id:token}));
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<option value="preview">');
    expect(response.body).not.toContain('<option value="production">');
  });
});
