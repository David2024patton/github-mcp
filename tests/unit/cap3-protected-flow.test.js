import {describe,it,expect,vi} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {issueTenantCredential} from '../../src/tenancy/routed-credential.js';
import {createPrivateOptionalEnrollment} from '../../src/tenancy/optional-setup.js';
import {makePrivateOptionalPage} from '../../api/tenant/optional.js';
import {createTenantScopedCredentials} from '../../src/tenancy/user-authorization.js';
import {credentialFor,githubFor} from '../../src/github/client.js';
import {handlers as diagnosticHandlers} from '../../src/tools/server-diagnostics.js';
import {decryptSecret} from '../../src/core/crypto.js';
import {pilotOptionalAad} from '../../src/tenancy/optional-credentials.js';

const env={
  VERCEL_ENV:'production',GITHUB_PRIVATE_TENANT_PILOT:'enabled',
  PUBLIC_BASE_URL:'https://service.example',DATABASE_URL:'postgres://fixture',
  GITHUB_PILOT_APP_ID:'902',
  TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,14).toString('base64url'),
  GITHUB_TENANT_ROUTING_KEY:Buffer.alloc(32,9).toString('base64url')
};
const sha=x=>createHash('sha256').update(x).digest('hex');
const returnUri='https://client.example/return';
const token='ghp_FAKEprivate_optional_member';
function fixture(){
  const claim={tenantId:randomUUID(),identityId:randomUUID(),
    membershipRevision:2,pilotRevision:3};
  const tenant={...claim,namespace:'gh_test',role:'member'};
  const client=issueTenantCredential('tcl',claim,env);
  const states=new Map(),grants=new Map(),requests=[];
  const db={getOAuthClient:vi.fn(async id=>id===client
    ?{redirect_uris:[returnUri]}:null),
  getAccount:vi.fn(async login=>login==='fixture-org'?{
    login:'fixture-org',account_id:901,app_id:902,installation_id:903,
    credential_kind:'app',installation_status:'active'
  }:null)};
  let responseSubject=42,respondToRead=true,scopeHeader='notifications';
  const directory={
    authorizedPilotIdentity:vi.fn(async(t,i)=>
      t===tenant.tenantId&&i===tenant.identityId?tenant:null),
    getPilotVerifiedSubject:vi.fn(async()=> '42'),
    pilotOptionalFingerprint:vi.fn(async({kind})=>{
      const found=grants.get(kind);
      return found?{cipher_fingerprint:found.cipher_fingerprint}:null;
    }),
    createPilotOptionalSetupState:vi.fn(async row=>{
      states.set(row.stateHash,{...row});return true;
    }),
    consumePilotOptionalSetupState:vi.fn(async key=>{
      const row=states.get(key)||null;states.delete(key);
      return row?{...row}:null;
    }),
    putPilotOptionalCredential:vi.fn(async row=>{
      const previous=grants.get(row.kind);
      if(previous?.cipher_fingerprint!==undefined &&
         previous.cipher_fingerprint!==row.expectedFingerprint)return false;
      if(!previous && row.expectedFingerprint!==null)return false;
      const entry={
        access_enc:row.accessEnc,cipher_fingerprint:sha(row.accessEnc),
        kind:row.kind,actor_id:row.actorId,account_id:row.accountId,
        verified_operation:row.operation,verified_resource:row.resource,
        provider_host:'github.com',scopes:row.scopes,expires_at:row.expiresAt
      };
      grants.set(row.kind,entry);return true;
    }),
    getPilotOptionalCredential:vi.fn(async({kind})=>{
      const found=grants.get(kind);return found?.revoked_at?null:found||null;
    }),
    revokePilotOptionalCredential:vi.fn(async({kind,expectedFingerprint})=>{
      const value=grants.get(kind);
      if(!value||value.cipher_fingerprint!==expectedFingerprint)return false;
      grants.set(kind,{...value,access_enc:'v1.revoked',
        cipher_fingerprint:'0'.repeat(64),revoked_at:new Date()});
      return true;
    })
  };
  const fetchImpl=vi.fn(async(url,opts)=>{
    requests.push({url,method:opts.method,authorization:opts.headers.authorization});
    if(url==='https://api.github.com/user')return {
      ok:true,status:200,json:async()=>({
        id:responseSubject,type:'User',login:'fixture-member'
      })};
    return {ok:respondToRead,status:respondToRead?200:403,
      headers:{get:()=>scopeHeader}};
  });
  const enrollment=createPrivateOptionalEnrollment({
    env,fetchImpl,admitOAuth:vi.fn(async()=>{}),directoryFactory:()=>directory,
    tenantAccess:async()=>({tenant,db})
  });
  const args={client_id:client,account:'fixture-org',kind:'K',
    redirect_uri:returnUri};
  return {claim,tenant,client,states,grants,requests,db,directory,
    fetchImpl,enrollment,args,
    changeSubject:n=>{responseSubject=n;},
    changeScope:s=>{scopeHeader=s;},
    failRead:()=>{respondToRead=false;}};
}
describe('CAP-3 protected private member handoff',()=>{
  it('requires the signed client, a registered return URI and active epochs before issuing one-use state',async()=>{
    const f=fixture();
    await expect(f.enrollment.start({...f.args,client_id:'tcl_forger'})).rejects.toThrow();
    await expect(f.enrollment.start({...f.args,redirect_uri:'https://evil.example/callback'})).rejects.toThrow();
    expect(f.states.size).toBe(0);
    const flow=await f.enrollment.start(f.args);
    expect(flow.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(f.states.get(sha(flow.state))).toMatchObject({
      tenantId:f.claim.tenantId,identityId:f.claim.identityId,
      clientId:f.client,accountLogin:'fixture-org',kind:'K',
      expectedFingerprint:null,redirectUri:returnUri});
    expect(JSON.stringify([...f.states.values()])).not.toContain(token);
    f.directory.authorizedPilotIdentity.mockResolvedValueOnce({
      ...f.tenant,pilotRevision:4});
    await expect(f.enrollment.start(f.args)).rejects.toThrow();
  });
  it('verifies exact identity/permission, seals before saving and returns only nonsecret status to registered client',async()=>{
    const f=fixture();
    const flow=await f.enrollment.start(f.args);
    const result=await f.enrollment.finish({state:flow.state,action:'save',value:token});
    expect(result).toMatchObject({kind:'K',operation:'GET /notifications',
      status:'read-observed-at-enrollment'});
    const returned=new URL(result.destination);
    expect(returned.origin).toBe('https://client.example');
    expect(returned.pathname).toBe('/return');
    expect(returned.searchParams.get('github_mcp_optional')).toBe('read-observed-at-enrollment');
    expect(result.destination).not.toContain(token);
    expect(f.requests.map(x=>x.url)).toEqual([
      'https://api.github.com/user','https://api.github.com/notifications?per_page=1']);
    expect(f.requests.every(x=>x.authorization==='Bearer '+token)).toBe(true);
    const sealed=f.grants.get('K');
    expect(sealed.access_enc).toMatch(/^v1\./);
    expect(sealed.access_enc).not.toContain(token);
    expect(decryptSecret(sealed.access_enc,{key:Buffer.alloc(32,14),
      aad:pilotOptionalAad({tenantId:f.claim.tenantId,
        identityId:f.claim.identityId,accountLogin:'fixture-org',kind:'K'})})).toBe(token);
    await expect(f.enrollment.finish({state:flow.state,
      action:'save',value:token})).rejects.toThrow();
    expect(f.grants.size).toBe(1);
  });
  it('recovers from interruption and denied provider scopes without losing a previous grant',async()=>{
    const f=fixture();
    let flow=await f.enrollment.start(f.args);
    f.changeScope('repo');
    await expect(f.enrollment.finish({state:flow.state,
      action:'save',value:token})).rejects.toThrow();
    expect(f.grants.size).toBe(0);
    await expect(f.enrollment.finish({state:flow.state,
      action:'save',value:token})).rejects.toThrow();
    f.changeScope('notifications');
    flow=await f.enrollment.start(f.args);
    await f.enrollment.finish({state:flow.state,action:'save',value:token});
    const old=f.grants.get('K').cipher_fingerprint;
    flow=await f.enrollment.start(f.args);
    f.failRead();
    await expect(f.enrollment.finish({state:flow.state,
      action:'save',value:token})).rejects.toThrow();
    expect(f.grants.get('K').cipher_fingerprint).toBe(old);
  });
  it('refuses wrong GitHub human and prevents concurrent stale renewal from replacing another grant',async()=>{
    const f=fixture();
    let flow=await f.enrollment.start(f.args);
    f.changeSubject(99);
    await expect(f.enrollment.finish({state:flow.state,
      action:'save',value:token})).rejects.toThrow();
    expect(f.grants.size).toBe(0);
    f.changeSubject(42);
    const first=await f.enrollment.start(f.args);
    const stale=await f.enrollment.start(f.args);
    await f.enrollment.finish({state:first.state,action:'save',value:token});
    const fingerprint=f.grants.get('K').cipher_fingerprint;
    await expect(f.enrollment.finish({state:stale.state,
      action:'save',value:token})).rejects.toThrow();
    expect(f.grants.get('K').cipher_fingerprint).toBe(fingerprint);
  });
  it('renews through current CAS, revokes with independent same-person proof and refuses replay',async()=>{
    const f=fixture();
    let state=(await f.enrollment.start(f.args)).state;
    await f.enrollment.finish({state,action:'save',value:token});
    const old=f.grants.get('K').cipher_fingerprint;
    state=(await f.enrollment.start(f.args)).state;
    const renewed=await f.enrollment.finish({
      state,action:'save',value:'ghp_FAKEnew_member_bearer'});
    expect(renewed.status).toBe('read-observed-at-enrollment');
    expect(f.grants.get('K').cipher_fingerprint).not.toBe(old);
    const stale=(await f.enrollment.start(f.args)).state;
    state=(await f.enrollment.start(f.args)).state;
    const outcome=await f.enrollment.finish({
      state,action:'revoke',value:'ghp_FAKEnew_member_bearer'});
    expect(outcome.status).toBe('revoked-on-this-service');
    expect(f.grants.get('K').access_enc).toBe('v1.revoked');
    await expect(f.enrollment.finish({state:stale,
      action:'save',value:token})).rejects.toThrow();
    expect(await f.directory.getPilotOptionalCredential({kind:'K'})).toBeNull();
    await expect(f.enrollment.finish({state,action:'revoke',value:token})).rejects.toThrow();
    const fresh=(await f.enrollment.start(f.args)).state;
    await f.enrollment.finish({state:fresh,action:'save',value:token});
    expect(f.grants.get('K').revoked_at).toBeUndefined();
  });
});
function response(){
  const h={},res={
    headers:h,statusCode:200,headersSent:false,
    setHeader:(name,value)=>{h[name.toLowerCase()]=value;},
    status(n){this.statusCode=n;return this;},
    send(x){this.body=x;this.headersSent=true;return this;},
    end(){this.headersSent=true;return this;}
  };
  return res;
}
describe('CAP-3 browser POST rejects CSRF, forged Origin and raw-token output',()=>{
  const make=()=>{
    const enrollment={
      start:vi.fn(async()=>({state:'x'.repeat(43),account:'fixture-org',
        operation:'GET /notifications'})),
      finish:vi.fn(async()=>({destination:'https://client.example/return?github_mcp_optional=ok'}))
    };
    return {enrollment,page:makePrivateOptionalPage({env,enrollment})};
  };
  it('shows an escaped mobile-friendly form with strict security headers',async()=>{
    const {page}=make(),res=response();
    await page({method:'GET',query:{client_id:'fixture'},headers:{}},res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('name="csrf"');
    expect(res.body).not.toContain(token);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toContain("form-action 'self'");
    expect(res.headers['set-cookie']).toContain('HttpOnly');
  });
  it('does not call issuer on wrong Origin, missing cookie or mismatched CSRF',async()=>{
    const {page,enrollment}=make();
    for(const req of [
      {method:'POST',headers:{origin:'https://evil.example'},body:{csrf:'x'.repeat(43),value:token}},
      {method:'POST',headers:{origin:env.PUBLIC_BASE_URL},body:{csrf:'x'.repeat(43),value:token}},
      {method:'POST',headers:{origin:env.PUBLIC_BASE_URL,cookie:'gh_tenant_optional_state='+'x'.repeat(43)},body:{csrf:'y'.repeat(43),value:token}}
    ]){
      const res=response();await page(req,res);expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain(token);
    }
    expect(enrollment.finish).not.toHaveBeenCalled();
  });
  it('posts only to issuer and redirects to registered completion URI',async()=>{
    const {page,enrollment}=make(),res=response();
    await page({method:'POST',headers:{
      origin:env.PUBLIC_BASE_URL,cookie:'gh_tenant_optional_state='+'x'.repeat(43)
    },body:{csrf:'x'.repeat(43),action:'save',value:token}},res);
    expect(enrollment.finish).toHaveBeenCalledWith({
      state:'x'.repeat(43),action:'save',value:token});
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('https://client.example/return?github_mcp_optional=ok');
    expect(JSON.stringify(res)).not.toContain(token);
  });
});


describe('CAP-3 agent-initiated private diagnostic only exposes registered client setup',()=>{
  it('provides a nonsecret, canonical protected handoff before/after scoped readback',async()=>{
    const f=fixture();
    const ctx={
      env,connection:{client_id:f.client,accounts:['fixture-org'],
        default_account:'fixture-org',profile:'full',mode:'preview'},
      credentials:{operationAuthority:vi.fn(async()=>({
        status:'needs-consent',providerExecution:'not-tested'}))},
      db:{...f.db,listAccounts:async()=>[await f.db.getAccount('fixture-org')]}
    };
    const args={account:'fixture-org',operation:'GET /notifications',area:'organization'};
    const before=await diagnosticHandlers.github_check_permissions(args,ctx);
    const entry=before.accounts[0];
    expect(entry.additional_setup).toMatchObject({
      status:'protected-tenant-setup',kind:'classic_pat',
      operation:'GET /notifications'});
    const link=new URL(entry.additional_setup.url);
    expect(link.origin).toBe(env.PUBLIC_BASE_URL);
    expect(link.pathname).toBe('/api/tenant/optional');
    expect(link.searchParams.get('client_id')).toBe(f.client);
    expect(link.searchParams.get('redirect_uri')).toBe(returnUri);
    expect(link.toString()).not.toContain(token);
    ctx.credentials.operationAuthority.mockResolvedValue({
      status:'verified-for-scope',providerExecution:'not-tested'});
    const after=await diagnosticHandlers.github_check_permissions(args,ctx);
    expect(after.accounts[0].additional_setup.status).toBe('renew-or-revoke');
    expect(after.accounts[0].operation_authority.providerExecution).toBe('not-tested');
    ctx.db.getOAuthClient=async()=>({redirect_uris:[returnUri,'https://other.example/callback']});
    const ambiguous=await diagnosticHandlers.github_check_permissions(args,ctx);
    expect(ambiguous.accounts[0].additional_setup?.url).toBeUndefined();
    expect(JSON.stringify(ambiguous)).not.toContain(token);
  });
  it('never gives signed tenant setup link to a delegated service pass',async()=>{
    const f=fixture();
    const ctx={
      env,connection:{client_id:f.client,accounts:['fixture-org'],
        default_account:'fixture-org',profile:'full',mode:'preview',pass:true},
      credentials:{operationAuthority:vi.fn(async()=>({status:'needs-consent'}))},
      db:{...f.db,listAccounts:async()=>[await f.db.getAccount('fixture-org')]}
    };
    const result=await diagnosticHandlers.github_check_permissions({
      account:'fixture-org',operation:'GET /notifications',area:'organization'},ctx);
    expect(result.accounts[0].additional_setup?.url).toBeUndefined();
  });
});


describe('CAP-3 enrolled private K/P tokens only dispatch exact observed reads',()=>{
  const authorize=(f)=>{
    f.directory.getPilotUserAuthorization=vi.fn(async()=>null);
    const base={token:vi.fn(async()=>{throw Error('Must not borrow owner token');})};
    const credentials=createTenantScopedCredentials({
      base,directory:f.directory,tenant:f.tenant,db:f.db,env});
    return {base,credentials};
  };
  it('decrypts only the matching active member K token and gates every HTTP request',async()=>{
    const f=fixture();
    const flow=await f.enrollment.start(f.args);
    await f.enrollment.finish({state:flow.state,action:'save',value:token});
    const {base,credentials}=authorize(f);
    expect(await credentials.token({account:'fixture-org',cred:'K'})).toBe(token);
    expect(base.token).not.toHaveBeenCalled();
    for(const path of ['https://api.github.com/user',
      'https://api.github.com/notifications?per_page=100']){
      expect(await credentials.authorizeOptionalRequest({
        account:'fixture-org',kind:'K',method:'GET',url:path})).toBe(true);
    }
    for(const testCase of [
      ['PATCH','https://api.github.com/notifications'],
      ['GET','https://api.github.com/repos/fixture-org/foreign/notifications'],
      ['GET','https://other.example/notifications'],
      ['GET','https://api.github.com/orgs/fixture-org/packages'],
      ['POST','https://api.github.com/graphql']
    ])await expect(credentials.authorizeOptionalRequest({
      account:'fixture-org',kind:'K',method:testCase[0],url:testCase[1]}))
      .rejects.toThrow();
    await expect(credentials.token({account:'fixture-org',cred:'K',
      scope:{repositories:['foreign']}})).rejects.toThrow();
    await expect(credentialFor({connection:{
      default_account:'fixture-org',accounts:['fixture-org'],
      profile:'full',pass:true},credentials},{
      owner:'fixture-org',cred:'K'})).rejects.toThrow();
    f.grants.get('K').expires_at=new Date(Date.now()-60000);
    await expect(credentials.token({account:'fixture-org',cred:'K'})).rejects.toThrow();
    await expect(credentials.authorizeOptionalRequest({
      account:'fixture-org',kind:'K',method:'GET',
      url:'https://api.github.com/notifications'})).rejects.toThrow();
  });

  it('sends an enrolled K/P token only on the audited Octokit read path; denies writes before fetch',async()=>{
    const f=fixture();
    const k=await f.enrollment.start(f.args);
    await f.enrollment.finish({state:k.state,action:'save',value:token});
    f.changeScope('read:packages');
    const p=await f.enrollment.start({...f.args,kind:'P'});
    await f.enrollment.finish({state:p.state,action:'save',
      value:'ghp_FAKEpackages_same_member'});
    const {credentials}=authorize(f);
    const transport=vi.fn(async()=>new Response('[]',{
      status:200,headers:{'content-type':'application/json'}
    }));
    const ctx={
      credentials,db:{...f.db,getRateState:async()=>null},
      connection:{default_account:'fixture-org',accounts:['fixture-org'],
        profile:'read_only',mode:'preview',pass:false},
      fetch:transport
    };
    const kClient=await githubFor(ctx,{owner:'fixture-org',cred:'K'});
    const beforeK=await kClient.request('GET /notifications',{per_page:1});
    expect(beforeK.status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(kClient.request('PUT /notifications',{})).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
    const pClient=await githubFor(ctx,{owner:'fixture-org',cred:'P'});
    const beforeP=await pClient.request('GET /orgs/{org}/packages',{
      org:'fixture-org',package_type:'container'});
    expect(beforeP.status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(2);
    await expect(pClient.request('DELETE /orgs/{org}/packages/{package_type}/{package_name}',{
      org:'fixture-org',package_type:'container',package_name:'fake'}))
      .rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('limits optional P to exactly the verified organization packages collection',async()=>{
    const f=fixture();
    f.changeScope('read:packages');
    const flow=await f.enrollment.start({...f.args,kind:'P'});
    await f.enrollment.finish({state:flow.state,
      action:'save',value:'ghp_FAKEpackages_same_member'});
    const {credentials}=authorize(f);
    expect(await credentials.token({account:'fixture-org',cred:'P'}))
      .toBe('ghp_FAKEpackages_same_member');
    expect(await credentials.authorizeOptionalRequest({account:'fixture-org',
      kind:'P',method:'GET',url:'https://api.github.com/orgs/fixture-org/packages?package_type=container'}))
      .toBe(true);
    for(const [method,url] of [
      ['DELETE','https://api.github.com/orgs/fixture-org/packages/container/image'],
      ['GET','https://api.github.com/orgs/foreign-org/packages'],
      ['GET','https://api.github.com/orgs/fixture-org/packages/container/image'],
      ['GET','https://api.github.com/notifications'],
      ['GET','https://github.com/orgs/fixture-org/packages']
    ])await expect(credentials.authorizeOptionalRequest({
      account:'fixture-org',kind:'P',method,url})).rejects.toThrow();
    await expect(credentials.token({account:'foreign-org',cred:'P'})).rejects.toThrow();
  });
});
