import {describe,it,expect,vi} from 'vitest';
import {createTenantScopedCredentials} from '../../src/tenancy/user-authorization.js';
import {encryptSecret} from '../../src/core/crypto.js';

const tenant={tenantId:'fixture-tenant',identityId:'fixture-human',role:'member'};
const account='fixture-org';
const key=Buffer.alloc(32,7);
const env={TOKEN_ENCRYPTION_KEY:key.toString('base64url')};
function fixture(role='member'){
  const base={token:vi.fn(async()=> 'ghs_FAKEinstallation_scoped')};
  const directory={getPilotUserAuthorization:vi.fn(async()=>({
    access_enc:encryptSecret('ghu_FAKEown_user_bearer',{key,
      aad:'github-mcp/private-tenant/fixture-tenant/identity/fixture-human/account/fixture-org/access'}),
    access_expires_at:new Date(Date.now()+3600000)
  }))};
  return {base,directory,credentials:createTenantScopedCredentials({
    base,directory,tenant:{...tenant,role},env})};
}
describe('private user credentials cannot ignore restricted pass downscoping',()=>{
  it.each(['U','I'])('refuses repository, ID and permission restrictions before accessing a %s user bearer',async cred=>{
    const {credentials,base,directory}=fixture();
    for(const scope of [{repositories:['fixture']},{repository_ids:[101]},
      {permissions:{contents:'read'}},{permissions:{}}])
      await expect(credentials.token({account,cred,scope})).rejects.toThrow(/authorization/);
    expect(directory.getPilotUserAuthorization).not.toHaveBeenCalled();
    expect(base.token).not.toHaveBeenCalled();
  });
  it('refuses an owner U bearer for restricted scope as well',async()=>{
    const {credentials,base,directory}=fixture('owner');
    await expect(credentials.token({account,cred:'U',scope:{repositories:['fixture']}}))
      .rejects.toThrow(/authorization/);
    expect(directory.getPilotUserAuthorization).not.toHaveBeenCalled();
    expect(base.token).not.toHaveBeenCalled();
  });
  it.each(['U','I'])('preserves an ordinary member own-user %s grant',async cred=>{
    const {credentials,base,directory}=fixture();
    expect(await credentials.token({account,cred})).toBe('ghu_FAKEown_user_bearer');
    expect(directory.getPilotUserAuthorization).toHaveBeenCalledWith(tenant.tenantId,tenant.identityId,account);
    expect(base.token).not.toHaveBeenCalled();
  });
  it('preserves the exact owner installation downscope request',async()=>{
    const {credentials,base,directory}=fixture('owner');
    const args={account,cred:'I',profile:'read_only',scope:{repositories:['fixture'],permissions:{contents:'read'}}};
    expect(await credentials.token(args)).toBe('ghs_FAKEinstallation_scoped');
    expect(base.token).toHaveBeenCalledWith(args);
    expect(directory.getPilotUserAuthorization).not.toHaveBeenCalled();
  });
});
