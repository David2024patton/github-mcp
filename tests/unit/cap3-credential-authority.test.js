import {describe,it,expect} from 'vitest';
import {resolveDocumentedCredential,credentialTypeForAccount} from '../../src/github/credential-authority.js';
const account={accountId:101,login:'fixture-org',credential_kind:'app'};
const principal={githubUserId:42,tenantId:'tenant-a',identityId:'human-a',host:'github.com'};
const resource='fixture-org/project';
const op='GET /repos/{owner}/{repo}';
const data=(kind='app_installation')=>({
  kind,host:'github.com',login:'fixture-org',accountId:101,
  tenantId:'tenant-a',identityId:'human-a',githubUserId:42,
  fingerprint:'ciphertext-hash-a',currentCipherFingerprint:'ciphertext-hash-a',
  resources:[resource],permissions:['repository:metadata:read'],
  verification:'identity-and-capability-readback',revokedAt:null,expiresAt:Date.now()+600000
});
const run=(patch={})=>resolveDocumentedCredential({operation:op,host:'github.com',
  account,principal,resource,grants:[data()],...patch});
describe('CAP-3 strict source-pinned credential eligibility',()=>{
  it('does not accept an operation merely because a tool exists or credentials are stored',()=>{
    expect(credentialTypeForAccount(account)).toBe('app_installation');
    expect(run({grants:[]})).toMatchObject({status:'needs-consent',requiredKinds:expect.any(Array)});
    expect(run({operation:'GET /not-reviewed'})).toMatchObject({
      status:'unknown',code:'provider_documentation_unreviewed'});
    expect(run({host:'github.enterprise.example',principal:{...principal,host:'github.enterprise.example'}}))
      .toMatchObject({status:'unknown',code:'provider_documentation_unreviewed'});
    expect(run({requestedKind:'classic_pat',grants:[data('classic_pat')]}))
      .toMatchObject({status:'unknown',code:'no_reviewed_credential_match'});
  });
  it('uses only one already verified exact principal/host/resource grant, still not a provider call',()=>{
    expect(run({requestedKind:'app_installation'})).toMatchObject({
      status:'verified-for-scope',requiresExplicitCall:true,providerExecution:'not-tested',
      selected:{kind:'app_installation',resource,verification:'metadata-only'}});
    expect(run({grants:[data(),data('app_user')]})).toMatchObject({
      status:'needs-explicit-credential-selection',providerExecution:'not-tested'});
    expect(run({requestedKind:'app_jwt',operation:'GET /app',grants:[]}).requiredKinds)
      .toEqual(['app_jwt']);
  });
  it.each([
    [{revokedAt:new Date()},'revoked'],
    [{expiresAt:Date.now()-10},'expired'],
    [{currentCipherFingerprint:'new-ciphertext'},'stale_or_replaced'],
    [{githubUserId:99},'foreign_principal_host_or_account'],
    [{tenantId:'tenant-b'},'foreign_principal_host_or_account'],
    [{identityId:'human-b'},'foreign_principal_host_or_account'],
    [{host:'other.github.enterprise.example'},'foreign_principal_host_or_account'],
    [{accountId:102},'foreign_principal_host_or_account'],
    [{resources:['fixture-org/other']},'resource_not_granted'],
    [{verification:'identity-only'},'capability_not_verified'],
    [{permissions:[]},'permission_or_scope_missing'],
  ])('refuses a mismatched or stale grant before selecting it: %j', (edit,reason)=>{
    const result=run({requestedKind:'app_installation',grants:[{...data(),...edit}]});
    expect(result).toMatchObject({status:'needs-consent',missing:[{reason}]});
    expect(JSON.stringify(result)).not.toMatch(/gh[pousr]_[A-Za-z0-9]{8,}/);
  });
  it('rejects absent/unverified principal, invalid host and resource before grant inspection',()=>{
    expect(run({principal:{...principal,githubUserId:0}}).code).toBe('principal_unverified');
    expect(run({host:'https://github.com'}).code).toBe('invalid_host');
    expect(run({resource:''}).code).toBe('resource_unverified');
    expect(run({account:{...account,accountId:0}}).code).toBe('account_unverified');
    expect(run({grants:null}).code).toBe('grant_registry_unavailable');
  });
  it('interprets documented OAuth scopes as alternatives and never accepts an absent scope',()=>{
    const oauth=data('oauth_app');
    const check=scopes=>run({operation:'GET /user',requestedKind:'oauth_app',
      grants:[{...oauth,scopes}]});
    expect(check(['read:user'])).toMatchObject({status:'verified-for-scope'});
    expect(check(['user'])).toMatchObject({status:'verified-for-scope'});
    expect(check([])).toMatchObject({status:'needs-consent',
      missing:[{reason:'permission_or_scope_missing'}]});
    expect(check(['repo'])).toMatchObject({status:'needs-consent',
      missing:[{reason:'permission_or_scope_missing'}]});
    expect(()=>run({operation:'GET user'})).toThrow(/pinned REST/);
  });
  it('keeps service App JWT and unknown permissions independently gated',()=>{
    const x=data('app_jwt');
    expect(run({operation:'GET /app',requestedKind:'app_jwt',grants:[x]})).toMatchObject({
      status:'needs-consent',missing:[{reason:'service_ownership_not_proven'}]});
    expect(run({operation:'PATCH /user',requestedKind:'app_installation',grants:[data()]}))
      .toMatchObject({status:'unknown',code:'documented_credential_unsupported'});
  });
});
