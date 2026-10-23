import {describe,it,expect} from 'vitest';
import {userGrantBinding,currentUserGrantBinding} from '../../src/tenancy/credential-binding.js';
import {createTenantScopedCredentials} from '../../src/tenancy/user-authorization.js';
import {encryptSecret} from '../../src/core/crypto.js';

const tenant={tenantId:'tenant-a',identityId:'identity-a',membershipRevision:2,pilotRevision:3};
const account={login:'fixture-org',account_id:101,installation_id:102,app_id:103,
  credential_kind:'app',installation_status:'active'};
const now=Date.now();
const expiry=new Date(now+3600000);
const envelope='v1.fixture-ciphertext';
const proof=()=>userGrantBinding({subject:'42',tenant,account,accessEnc:envelope,expiresAt:expiry});
const stored=()=>({access_enc:envelope,access_expires_at:expiry,authority_binding:proof()});
const read=(patch={})=>currentUserGrantBinding({row:stored(),tenant,subject:'42',account,now,...patch});

describe('CAP-3 binding of existing private encrypted user authority',()=>{
  it('allows only the exact verified identity read, not installation or write permissions',()=>{
    const result=read();
    expect(result).toMatchObject({kind:'app_user',host:'github.com',githubUserId:42,
      operations:['GET /user'],resources:['user/42'],permissions:[],scopes:[]});
    expect(result.currentCipherFingerprint).toBe(result.fingerprint);
    expect(JSON.stringify(result)).not.toContain(envelope);
    expect(read({row:{...stored(),authority_binding:{...proof(),secret:'ghp_FAKEextra'}}}))
      .not.toHaveProperty('secret');
  });
  it.each([
    {subject:'43'},
    {tenant:{...tenant,tenantId:'tenant-b'}},
    {tenant:{...tenant,identityId:'identity-b'}},
    {tenant:{...tenant,membershipRevision:3}},
    {tenant:{...tenant,pilotRevision:4}},
    {account:{...account,account_id:104}},
    {account:{...account,app_id:104}},
    {account:{...account,installation_id:104}},
    {account:{...account,installation_status:'suspended'}},
    {row:{...stored(),access_enc:'v1.replaced-ciphertext'}},
    {row:{...stored(),access_expires_at:new Date(now+7200000)}},
    {row:{...stored(),authority_binding:null}},
    {row:{...stored(),authority_binding:{...proof(),host:'other.example'}}},
    {row:{...stored(),authority_binding:{...proof(),permissions:['user:profile:write']}}},
    {row:{...stored(),authority_binding:{...proof(),resources:['user/43']}}},
  ])('refuses changed or absent ownership/proof without exposing ciphertext: %j',patch=>{
    expect(read(patch)).toBeNull();
  });
  it('permits expired metadata only for the internal refresh validation, never a diagnostic pass',()=>{
    expect(read({now:now+7200000})).toBeNull();
    expect(read({now:now+7200000,allowExpired:true})).not.toBeNull();
    expect(()=>userGrantBinding({subject:'0',tenant,account,accessEnc:envelope,expiresAt:expiry}))
      .toThrow(/binding required/);
  });
  it('diagnostic traces the real directory/account stores and never decrypts or borrows the base token',async()=>{
    const directory={
      getPilotVerifiedSubject:async()=>'42',
      authorizedPilotIdentity:async()=>tenant,
      getPilotUserAuthorization:async()=>stored()
    };
    const credentials=createTenantScopedCredentials({base:{token:()=>{throw Error('no base');}},
      directory,tenant,db:{getAccount:async()=>account},now:()=>now});
    expect(await credentials.operationAuthority({account:account.login,operation:'GET /user'}))
      .toMatchObject({status:'verified-for-scope',providerExecution:'not-tested'});
    expect(await credentials.operationAuthority({account:account.login,operation:'PATCH /user',resource:'user/42'}))
      .toMatchObject({status:'needs-consent'});
    expect(await credentials.operationAuthority({account:account.login,operation:'GET /user',resource:'user/43'}))
      .toMatchObject({status:'needs-consent'});
    directory.authorizedPilotIdentity=async()=>({...tenant,pilotRevision:4});
    expect(await credentials.operationAuthority({account:account.login,operation:'GET /user'}))
      .toMatchObject({status:'needs-consent'});
  });
  it('checks binding before opening a token and never opens a foreign/stale grant',async()=>{
    const env={TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64url')};
    const accessEnc=encryptSecret('ghu_FAKEfixture_user_bearer',{
      key:Buffer.alloc(32,7),aad:'github-mcp/private-tenant/tenant-a/identity/identity-a/account/fixture-org/access'});
    const row={access_enc:accessEnc,access_expires_at:expiry,
      authority_binding:userGrantBinding({subject:'42',tenant,account,accessEnc,expiresAt:expiry})};
    const directory={getPilotVerifiedSubject:async()=>'42',
      authorizedPilotIdentity:async()=>tenant,getPilotUserAuthorization:async()=>row};
    const credentials=createTenantScopedCredentials({base:{token:()=>{throw Error('no base');}},
      directory,tenant,db:{getAccount:async()=>account},env,now:()=>now});
    expect(await credentials.token({account:account.login,cred:'U'})).toBe('ghu_FAKEfixture_user_bearer');
    for(const scope of [{repositories:['fixture']},{repository_ids:[101]},
      {permissions:{contents:'read'}}])
      await expect(credentials.token({account:account.login,cred:'U',scope}))
        .rejects.toThrow(/authorization/);
    row.authority_binding={...row.authority_binding,accountId:999};
    await expect(credentials.token({account:account.login,cred:'U'})).rejects.toThrow(/authorization/);
    await expect(credentials.token({account:account.login,cred:'K'})).rejects.toThrow(/authorization/);
    await expect(credentials.token({account:account.login,cred:'P'})).rejects.toThrow(/authorization/);
  });
});
