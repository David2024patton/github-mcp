import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { issueTenantCredential, verifyTenantCredential, isTenantRoutedCredential } from '../../src/tenancy/routed-credential.js';
import { isPrivateTenantBearer, resolvePrivateTenantMcpBearer } from '../../src/tenancy/mcp-route.js';

const A='5ca85cbb-2222-4222-8222-333333333333';
const B='5ca85cbb-2222-4222-8222-444444444444';
const revisions={membershipRevision:2,pilotRevision:4};
const on = { GITHUB_PRIVATE_TENANT_PILOT:'enabled',
  GITHUB_TENANT_ROUTING_KEY:randomBytes(32).toString('base64url') };

describe('PUB-2 signed private tenant credentials',()=>{
  it('binds tenant, identity and credential purpose without exposing another account',()=>{
    for(const kind of ['tac','trf','tcl']){
      const token=issueTenantCredential(kind,{tenantId:A,identityId:B,...revisions},on);
      expect(isTenantRoutedCredential(token)).toBe(true);
      expect(token).toMatch(new RegExp('^'+kind+'_[A-Za-z0-9_-]+$'));
      expect(token).not.toContain(A);
      expect(token).not.toContain(B);
      expect(verifyTenantCredential(token,kind,on)).toEqual({tenantId:A,identityId:B,...revisions});
      expect(verifyTenantCredential(token,kind==='tac'?'trf':'tac',on)).toBeNull();
      expect(isPrivateTenantBearer('Bearer '+token)).toBe(true);
      // Alter the signed nonce, tenant bytes, kind and digest independently.
      const other=token.replace(/.$/,token.endsWith('a')?'b':'a');
      expect(verifyTenantCredential(other,kind,on)).toBeNull();
      const rotated={...on,GITHUB_TENANT_ROUTING_KEY:randomBytes(32).toString('base64url')};
      expect(verifyTenantCredential(token,kind,rotated)).toBeNull();
    }
  });
  it('defaults CLOSED and never allows malformed, unsupported or unkeyed grants',()=>{
    expect(()=>issueTenantCredential('tac',{tenantId:A,identityId:B,...revisions},{})).toThrow(/disabled/);
    expect(()=>issueTenantCredential('tac',{tenantId:A,identityId:B,...revisions},
      {GITHUB_PRIVATE_TENANT_PILOT:'enabled'})).toThrow(/key/);
    expect(()=>issueTenantCredential('tac',{tenantId:'public',identityId:B},on)).toThrow();
    expect(()=>issueTenantCredential('foo',{tenantId:A,identityId:B,...revisions},on)).toThrow();
    expect(verifyTenantCredential('tac_bad','tac',on)).toBeNull();
    expect(verifyTenantCredential('tac_bad','tac',{})).toBeNull();
    expect(verifyTenantCredential('Bearer irrelevant','tac',on)).toBeNull();
    expect(isPrivateTenantBearer('Bearer tac_bad')).toBe(true);
    expect(isPrivateTenantBearer('Bearer ordinary_owner_credential')).toBe(false);
  });
  it('refuses invalid routed token BEFORE querying the root or tenant database',async()=>{
    const rootSqlFactory=()=>{throw Error('root must not be queried');};
    const tenantSqlFactory=()=>{throw Error('tenant must not be queried');};
    const invalid=issueTenantCredential('trf',{tenantId:A,identityId:B,...revisions},on);
    expect(await resolvePrivateTenantMcpBearer({
      authorization:'Bearer '+invalid,env:{...on,DATABASE_URL:'postgresql://u:p@localhost/db'},
      rootSqlFactory,tenantSqlFactory})).toBeNull();
    expect(await resolvePrivateTenantMcpBearer({
      authorization:'Bearer tac_bad',env:{...on,DATABASE_URL:'postgresql://u:p@localhost/db'},
      rootSqlFactory,tenantSqlFactory})).toBeNull();
  });
});
