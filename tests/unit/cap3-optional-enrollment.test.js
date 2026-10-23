import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {createTenantScopedCredentials} from '../../src/tenancy/user-authorization.js';
import {enrollVerifiedPilotOptionalCredential,pilotOptionalAad}
  from '../../src/tenancy/optional-credentials.js';
import {decryptSecret} from '../../src/core/crypto.js';

const key=Buffer.alloc(32,11);
const env={TOKEN_ENCRYPTION_KEY:key.toString('base64url')};
const tenant={tenantId:'workspace-a',identityId:'identity-a',membershipRevision:2,pilotRevision:3};
const account={login:'fixture-org',account_id:111,credential_kind:'app',installation_status:'active'};
const bearer='ghp_FAKEOPTIONAL_private_fixture';
const make=(overrides={})=>{
  const directory={
    authorizedPilotIdentity:vi.fn(async()=>tenant),
    getPilotVerifiedSubject:vi.fn(async()=>'42'),
    putPilotOptionalCredential:vi.fn(async()=>true)
  };
  const db={getAccount:vi.fn(async()=>account)};
  const requests=[];
  const fetchImpl=vi.fn(async(url,options)=>{
    requests.push({url,options});
    if(url==='https://api.github.com/user')
      return {ok:true,status:200,json:async()=>({id:42,type:'User',login:'fixture-user'})};
    return {ok:true,status:200,headers:{
      get:()=>overrides.providerScopes??(overrides.kind==='P'?'read:packages':'notifications')
    }};
  });
  return {directory,db,requests,fetchImpl};
};
const execute=async(kind,extra={},fixture=make({kind}))=>({
  result:await enrollVerifiedPilotOptionalCredential({
    directory:fixture.directory,db:fixture.db,tenant,accountLogin:'fixture-org',
    kind,bearer,env,fetchImpl:fixture.fetchImpl,now:()=>10_000,...extra
  }),fixture
});
describe('CAP-3 private optional K/P issuer proof and isolated AAD',()=>{
  it.each(['K','P'])('accepts only same-human, scoped exact harmless %s readback; seals before store',async kind=>{
    const {result,fixture}=await execute(kind);
    expect(result).toMatchObject({status:'read-observed-at-enrollment',
      kind,host:'github.com',currentProviderPermission:'not-tested'});
    expect(JSON.stringify(result)).not.toContain(bearer);
    expect(fixture.directory.putPilotOptionalCredential).toHaveBeenCalledTimes(1);
    const record=fixture.directory.putPilotOptionalCredential.mock.calls[0][0];
    expect(record).toMatchObject({tenantId:tenant.tenantId,identityId:tenant.identityId,
      accountLogin:account.login,actorId:42,accountId:111,
      operation:kind==='K'?'GET /notifications':'GET /orgs/{org}/packages',
      scopes:[kind==='K'?'notifications':'read:packages']});
    expect(decryptSecret(record.accessEnc,{aad:pilotOptionalAad({
      tenantId:tenant.tenantId,identityId:tenant.identityId,accountLogin:account.login,kind
    }),key})).toBe(bearer);
    expect(()=>decryptSecret(record.accessEnc,{aad:pilotOptionalAad({
      tenantId:'workspace-b',identityId:tenant.identityId,accountLogin:account.login,kind
    }),key})).toThrow();
    expect(fixture.requests.map(x=>x.url)).toEqual(['https://api.github.com/user',
      kind==='K'?'https://api.github.com/notifications?per_page=1':
        'https://api.github.com/orgs/fixture-org/packages?package_type=container&per_page=1']);
    expect(fixture.requests.every(x=>x.options.headers.authorization==='Bearer '+bearer)).toBe(true);
  });
  it('refuses cross-person identity and never stores token',async()=>{
    const fixture=make();
    fixture.directory.getPilotVerifiedSubject=async()=> '999';
    await expect(execute('K',{},fixture)).rejects.toThrow(/not verified/);
    expect(fixture.directory.putPilotOptionalCredential).not.toHaveBeenCalled();
    // The harmless GitHub /user identity read is necessary to detect the
    // mismatch. Only the second optional-capability read must be suppressed.
    expect(fixture.requests.map(x=>x.url)).toEqual(['https://api.github.com/user']);
  });
  it('refuses a GitHub numeric subject that JavaScript cannot represent safely',async()=>{
    const fixture=make();
    fixture.directory.getPilotVerifiedSubject=async()=> '9999999999999999999';
    await expect(execute('K',{},fixture)).rejects.toThrow(/not verified/);
    expect(fixture.fetchImpl).not.toHaveBeenCalled();
  });
  it('refuses wrong account before any provider call',async()=>{
    const fixture=make();
    fixture.db.getAccount=async()=>({...account,account_id:null});
    await expect(execute('K',{},fixture)).rejects.toThrow(/not verified/);
    expect(fixture.fetchImpl).not.toHaveBeenCalled();
  });
  it('refuses stale membership before provider call',async()=>{
    const fixture=make();
    fixture.directory.authorizedPilotIdentity=async()=>({...tenant,pilotRevision:4});
    await expect(execute('K',{},fixture)).rejects.toThrow(/not verified/);
    expect(fixture.fetchImpl).not.toHaveBeenCalled();
  });
  it.each([['K','repo'],['P','notifications'],['K',''],['P','']])
    ('denies %s without the required provider-attested scope (%s)',async(kind,providerScopes)=>{
      const fixture=make({kind,providerScopes});
      await expect(execute(kind,{},fixture)).rejects.toThrow(/not verified/);
      expect(fixture.directory.putPilotOptionalCredential).not.toHaveBeenCalled();
    });
  it('refuses failed capability readback with no persistence or bearer leak',async()=>{
    const fixture=make();
    const original=fixture.fetchImpl;
    fixture.fetchImpl=vi.fn(async(url,options)=>url.endsWith('/user')?
      original(url,options):{ok:false,status:403,headers:{get:()=> 'notifications'}});
    try{await execute('K',{},fixture);throw Error('expected refusal');}
    catch(e){expect(e.message).not.toContain(bearer);expect(e.message).toMatch(/not verified/);}
    expect(fixture.directory.putPilotOptionalCredential).not.toHaveBeenCalled();
  });
  it('refuses a concurrently changed tenant after provider calls',async()=>{
    const fixture=make();
    fixture.directory.authorizedPilotIdentity
      .mockResolvedValueOnce(tenant)
      .mockResolvedValueOnce({...tenant,membershipRevision:3});
    await expect(execute('K',{},fixture)).rejects.toThrow(/not verified/);
    expect(fixture.directory.putPilotOptionalCredential).not.toHaveBeenCalled();
  });
  it('fails closed for unsupported credential kinds and never asks GitHub',async()=>{
    const fixture=make();
    await expect(execute('I',{},fixture)).rejects.toThrow(/not verified/);
    expect(fixture.fetchImpl).not.toHaveBeenCalled();
    expect(fixture.directory.putPilotOptionalCredential).not.toHaveBeenCalled();
  });
  it('honors versioned compare-and-swap failure without storing an alternate credential',async()=>{
    const fixture=make();
    fixture.directory.putPilotOptionalCredential.mockResolvedValue(false);
    await expect(execute('K',{expectedFingerprint:'f'.repeat(64)},fixture)).rejects.toThrow(/not verified/);
    expect(fixture.directory.putPilotOptionalCredential).toHaveBeenCalledWith(
      expect.objectContaining({expectedFingerprint:'f'.repeat(64)}));
  });
});

describe('CAP-3 optional private diagnostic: no token exposure or automatic fallback',()=>{
  const options={base:{token:()=>{throw Error('never consult global owner bearer');}},
    tenant,now:()=>10_000};
  it.each([['K','GET /notifications','user/42'],['P','GET /orgs/{org}/packages','org/111']])
    ('shows a scoped, non-executing %s historical read only after verified storage',async(kind,operation,resource)=>{
      const fixture=make({kind});
      fixture.directory.getPilotUserAuthorization=async()=>null;
      fixture.directory.getPilotOptionalCredential=vi.fn(async()=>null);
      const creds=createTenantScopedCredentials({...options,directory:fixture.directory,db:fixture.db});
      expect(await creds.operationAuthority({account:'fixture-org',operation}))
        .toMatchObject({status:'needs-consent',providerExecution:'not-tested'});
      await execute(kind,{},fixture);
      const row=fixture.directory.putPilotOptionalCredential.mock.calls[0][0];
      fixture.directory.getPilotOptionalCredential.mockResolvedValue({
        access_enc:row.accessEnc,cipher_fingerprint:createHash('sha256')
          .update(row.accessEnc).digest('hex'),
        kind,actor_id:42,account_id:111,verified_operation:operation,
        verified_resource:resource,provider_host:'github.com',scopes:row.scopes,
        expires_at:row.expiresAt
      });
      const later=await creds.operationAuthority({account:'fixture-org',operation});
      expect(later).toMatchObject({status:'verified-for-scope',
        selected:{kind:'classic_pat',operation,resource},
        providerExecution:'not-tested',requiresExplicitCall:true});
      expect(JSON.stringify(later)).not.toContain(bearer);
      expect(await creds.operationAuthority({account:'fixture-org',operation,
        resource:'user/43'})).toMatchObject({status:'needs-consent'});
      expect(fixture.directory.getPilotOptionalCredential).toHaveBeenCalledWith({
        tenantId:tenant.tenantId,identityId:tenant.identityId,
        accountLogin:account.login,kind
      });
    });
  it('refuses altered ciphertext/proof and membership epoch changes',async()=>{
    const fixture=make({kind:'K'});
    fixture.directory.getPilotUserAuthorization=async()=>null;
    fixture.directory.getPilotOptionalCredential=async()=>({
      access_enc:'v1.forget-this-ciphertext',cipher_fingerprint:'f'.repeat(64),
      kind:'K',actor_id:42,account_id:111,provider_host:'github.com',
      verified_operation:'GET /notifications',verified_resource:'user/42',
      scopes:['notifications'],expires_at:new Date(20_000)
    });
    const creds=createTenantScopedCredentials({...options,directory:fixture.directory,db:fixture.db});
    expect(await creds.operationAuthority({account:'fixture-org',
      operation:'GET /notifications'})).toMatchObject({status:'needs-consent'});
    fixture.directory.authorizedPilotIdentity=async()=>({...tenant,pilotRevision:5});
    expect(await creds.operationAuthority({account:'fixture-org',
      operation:'GET /notifications'})).toMatchObject({status:'needs-consent'});
  });
});
