import {randomBytes,randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {createTenantDirectory,initializeProvisionedTenant,tenantConnectionString,
  tenantSchemaName} from '../../src/tenancy/directory.js';
import {createDb} from '../../src/db.js';
import {storePilotUserGrant,createTenantScopedCredentials} from '../../src/tenancy/user-authorization.js';

let admin,directory,identity,first,second,namespace;
const clients=[];
const env={TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64url')};
const login='cap3-fixture';
const sqlFor=client=>async(parts,...values)=>{
  let text=parts[0];
  values.forEach((_,i)=>{text+='$'+(i+1)+parts[i+1];});
  return (await client.query(text,values)).rows;
};
async function connect(url){const c=new pg.Client({connectionString:url});await c.connect();clients.push(c);return c;}
async function makeTenant(){
  const t=await directory.provision(identity);
  const client=await connect(tenantConnectionString(process.env.TEST_DATABASE_URL,t.id));
  const sql=sqlFor(client);
  await initializeProvisionedTenant({tenantId:t.id,connectionString:process.env.TEST_DATABASE_URL,sqlFactory:()=>sql});
  await directory.activate(t.id,tenantSchemaName(t.id));
  await directory.allowlistPilotIdentity(t.id,identity,identity);
  const db=createDb(sql);
  await db.upsertAccount({login,accountId:901,accountType:'Organization',
    label:'Fake provider fixture',credentialKind:'app',appId:902});
  await db.setInstallation(login,{installationId:903,repositorySelection:'all',
    permissions:{metadata:'read'},status:'active'});
  return {id:t.id,db};
}
async function scope(t){return directory.authorizedPilotIdentity(t.id,identity);}
async function save(t,token='ghu_FAKEcap3_user_bearer',verified=true){
  return storePilotUserGrant({directory,tenantId:t.id,identityId:identity,account:login,
    userLogin:'fixture-human',accessToken:token,expiresIn:3600,env,
    verifiedContext:verified?{subject:'30001',tenant:await scope(t),account:await t.db.getAccount(login)}:null});
}
async function credentials(t){return createTenantScopedCredentials({
  base:{token:()=>{throw Error('No owner bearer fallback');}},directory,
  tenant:await scope(t),db:t.db,env});}
async function authority(t,extra={}){return (await credentials(t)).operationAuthority({
  account:login,operation:'GET /user',...extra});}
async function row(t){return directory.getPilotUserAuthorization(t.id,identity,login);}

beforeAll(async()=>{
  const url=process.env.TEST_DATABASE_URL;
  if (!url || !['localhost','127.0.0.1','[::1]','::1'].includes(new URL(url).hostname))
    throw Error('Only disposable localhost PostgreSQL is allowed.');
  admin=await connect(url);
  namespace='cap3_binding_'+randomBytes(8).toString('hex');
  await admin.query('CREATE SCHEMA "'+namespace+'"');
  await admin.query('SET search_path TO "'+namespace+'"');
  directory=createTenantDirectory(sqlFor(admin));
  await directory.initSchema();
  identity=await directory.enrollVerifiedGithubSubject('30001');
  first=await makeTenant();second=await makeTenant();
});
afterAll(async()=>{
  if(admin){
    for(const t of [first,second]) if(t) await admin.query('DROP SCHEMA IF EXISTS "'+tenantSchemaName(t.id)+'" CASCADE');
    if(namespace) await admin.query('DROP SCHEMA IF EXISTS "'+namespace+'" CASCADE');
  }
  for(const c of clients.reverse()) await c.end();
});

describe('CAP-3 existing sealed-grant metadata in real PostgreSQL',()=>{
  it('migrates twice without copying credentials or promoting legacy rows to verified',async()=>{
    await save(first,'ghu_FAKElegacy_unchanged',false);
    const before=await row(first);
    // Simulate an existing deployment before its first upgraded write. Reads
    // must preserve that legacy grant even while the nullable column is absent.
    await admin.query('ALTER TABLE gh_tenant_user_authorizations DROP COLUMN authority_binding');
    directory=createTenantDirectory(sqlFor(admin));
    expect((await row(first)).access_enc).toBe(before.access_enc);
    expect((await row(first)).authority_binding).toBeNull();
    await save(first,'ghu_FAKElegacy_unchanged',false);
    const migrated=await row(first);
    expect(migrated.authority_binding).toBeNull();
    await directory.initSchema();await directory.initSchema();
    expect((await row(first)).access_enc).toBe(migrated.access_enc);
    expect((await row(first)).authority_binding).toBeNull();
    expect(await authority(first)).toMatchObject({status:'needs-consent'});
  });
  it('changes only the exact consented identity-read capability, with isolated grants for the same human in two workspaces',async()=>{
    expect(await authority(second)).toMatchObject({status:'needs-consent'});
    await save(first);await save(second,'ghu_FAKEother_workspace');
    expect(await authority(first)).toMatchObject({status:'verified-for-scope',providerExecution:'not-tested'});
    expect(await authority(second)).toMatchObject({status:'verified-for-scope'});
    expect((await row(first)).access_enc).not.toBe((await row(second)).access_enc);
    expect((await row(first)).authority_binding.tenantId).toBe(first.id);
    expect((await row(second)).authority_binding.tenantId).toBe(second.id);
    expect(await authority(first,{resource:'user/30002'})).toMatchObject({status:'needs-consent'});
    expect(await authority(first,{host:'other.github.example'})).toMatchObject({status:'denied'});
    expect(await authority(first,{operation:'PATCH /user',resource:'user/30001'}))
      .toMatchObject({status:'needs-consent'});
    const metadata=JSON.stringify(await authority(first));
    expect(metadata).not.toContain('ghu_FAKE');
    expect(metadata).not.toContain((await row(first)).access_enc);
  });
  it('replaces proof atomically and a delayed refresh cannot restore a superseded grant',async()=>{
    const old=await row(first);
    const claimId=randomUUID();
    // Exercise the real claimed-refresh CAS using an existing encrypted test
    // envelope; no provider token is ever sent to a real endpoint.
    await admin.query('UPDATE gh_tenant_user_authorizations SET refresh_enc=$1,refresh_expires_at=now()+interval \'1 hour\' WHERE tenant_id=$2',
      [old.access_enc,first.id]);
    expect(await directory.claimPilotUserRefresh({tenantId:first.id,identityId:identity,
      accountLogin:login,expectedAccessEnc:old.access_enc,claimId})).not.toBeNull();
    await save(first,'ghu_FAKEreplacement_bearer');
    expect(await directory.finishPilotUserRefresh({tenantId:first.id,identityId:identity,
      accountLogin:login,expectedAccessEnc:old.access_enc,claimId,
      accessEnc:old.access_enc,accessExpiresAt:old.access_expires_at,
      refreshEnc:old.access_enc,refreshExpiresAt:old.access_expires_at,
      authorityBinding:old.authority_binding})).toBe(false);
    expect(await authority(first)).toMatchObject({status:'verified-for-scope'});
    expect(await (await credentials(first)).token({account:login,cred:'U'}))
      .toBe('ghu_FAKEreplacement_bearer');
    await save(first,'ghu_FAKEunverified_replacement',false);
    expect(await authority(first)).toMatchObject({status:'needs-consent'});
  });
  it('revocation and reallowlisting do not revive old proof, and stale consent cannot replace the current row',async()=>{
    await save(first);
    const old=await row(first);
    await directory.revokePilotIdentity(first.id,identity,identity);
    expect(await row(first)).toBeNull();
    expect(await directory.getPilotUserAuthorization(second.id,identity,login)).not.toBeNull();
    await directory.allowlistPilotIdentity(first.id,identity,identity);
    expect(await authority(first)).toMatchObject({status:'needs-consent'});
    expect(await directory.storePilotUserAuthorization({tenantId:first.id,identityId:identity,
      accountLogin:login,userLogin:'fixture-human',accessEnc:old.access_enc,
      accessExpiresAt:old.access_expires_at,authorityBinding:old.authority_binding})).toBe(false);
    await save(first);
    expect(await authority(first)).toMatchObject({status:'verified-for-scope'});
    expect(await directory.revokePilotUserAuthorization(first.id,identity,login)).toBe(true);
    expect(await row(first)).toBeNull();
    expect(await authority(first)).toMatchObject({status:'needs-consent'});
    expect(await authority(second)).toMatchObject({status:'verified-for-scope'});
  });
});

describe('CAP-3 sealed private-member optional K/P lifecycle in disposable PostgreSQL',()=>{
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const context=async()=>({
    tenantId:first.id,identityId:identity,accountLogin:login,
    actorId:30001,accountId:901,
    ...(await directory.authorizedPilotIdentity(first.id,identity))
  });
  const proof=(ctx,kind,encrypted,expectedFingerprint=null)=>({
    ...ctx,kind,accessEnc:encrypted,expectedFingerprint,
    operation:kind==='K'?'GET /notifications':'GET /orgs/{org}/packages',
    resource:kind==='K'?'user/'+ctx.actorId:'org/'+ctx.accountId,
    scopes:kind==='K'?['notifications']:['read:packages']
  });
  it('does not enroll without exact bootstrap; never borrows an identically named other workspace',async()=>{
    await directory.initSchema();await directory.initSchema();
    const ctx=await context();
    const enc='v1.'+randomBytes(56).toString('hex');
    expect(await directory.putPilotOptionalCredential(proof(ctx,'K',enc))).toBe(false);
    await admin.query('INSERT INTO gh_tenant_pilot_bootstraps(identity_id,account_login,tenant_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [identity,login,first.id]);
    expect(await directory.putPilotOptionalCredential(proof(ctx,'K',enc))).toBe(true);
    const row=await directory.getPilotOptionalCredential({
      tenantId:first.id,identityId:identity,accountLogin:login,kind:'K'});
    expect(row).toMatchObject({kind:'K',verified_operation:'GET /notifications',
      verified_resource:'user/30001',provider_host:'github.com'});
    expect(row.access_enc).toBe(enc);
    expect((await directory.getPilotOptionalCredential({
      tenantId:second.id,identityId:identity,accountLogin:login,kind:'K'}))).toBeNull();
    expect(await directory.putPilotOptionalCredential(proof(
      {...ctx,tenantId:second.id},'K','v1.'+randomBytes(40).toString('hex')))).toBe(false);
    expect(await directory.putPilotOptionalCredential(proof(
      {...ctx,actorId:30002},'K','v1.'+randomBytes(40).toString('hex')))).toBe(false);
    expect(await directory.putPilotOptionalCredential(proof(
      {...ctx,accountLogin:'foreign-owner'},'K','v1.'+randomBytes(40).toString('hex')))).toBe(false);
  });
  it('uses compare-and-swap for replacement, rejects malformed authority and independently revokes',async()=>{
    const ctx=await context();
    const old=(await directory.getPilotOptionalCredential({
      tenantId:first.id,identityId:identity,accountLogin:login,kind:'K'}));
    expect(old).not.toBeNull();
    const renewed='v1.'+randomBytes(48).toString('hex');
    expect(await directory.putPilotOptionalCredential(proof(ctx,'K',renewed))).toBe(false);
    expect(await directory.putPilotOptionalCredential(proof(ctx,'K',renewed,'0'.repeat(64)))).toBe(false);
    expect(await directory.putPilotOptionalCredential(proof(ctx,'K',renewed,old.cipher_fingerprint))).toBe(true);
    const newer=await directory.getPilotOptionalCredential({
      tenantId:first.id,identityId:identity,accountLogin:login,kind:'K'});
    expect(newer.access_enc).toBe(renewed);
    expect(newer.cipher_fingerprint).toBe(hash(renewed));
    expect(await directory.putPilotOptionalCredential(proof(ctx,'K',
      'v1.'+randomBytes(50).toString('hex'),old.cipher_fingerprint))).toBe(false);
    expect(await directory.putPilotOptionalCredential(proof(
      {...ctx,membershipRevision:ctx.membershipRevision+1},'P',
      'v1.'+randomBytes(50).toString('hex')))).toBe(false);
    await expect(directory.putPilotOptionalCredential({
      ...proof(ctx,'K',renewed,hash(renewed)),scopes:['repo']})).rejects.toThrow(/invalid/i);
    await expect(directory.putPilotOptionalCredential({
      ...proof(ctx,'P',renewed,null),operation:'DELETE /orgs/{org}/packages'}))
      .rejects.toThrow(/invalid/i);
    const pkg='v1.'+randomBytes(48).toString('hex');
    expect(await directory.putPilotOptionalCredential(proof(ctx,'P',pkg))).toBe(true);
    expect((await directory.getPilotOptionalCredential({
      tenantId:first.id,identityId:identity,accountLogin:login,kind:'P'})).access_enc).toBe(pkg);
    expect(await directory.revokePilotOptionalCredential({
      tenantId:first.id,identityId:identity,accountLogin:login,kind:'K'})).toBe(true);
    expect(await directory.getPilotOptionalCredential({
      tenantId:first.id,identityId:identity,accountLogin:login,kind:'K'})).toBeNull();
    expect((await directory.getPilotOptionalCredential({
      tenantId:first.id,identityId:identity,accountLogin:login,kind:'P'})).access_enc).toBe(pkg);
    expect(await directory.revokePilotOptionalCredential({
      tenantId:first.id,identityId:identity,accountLogin:login,kind:'K'})).toBe(false);
  });
  it('membership suspension invalidates the remaining private extra grant immediately',async()=>{
    expect(await directory.revokePilotIdentity(first.id,identity,identity)).toBe(true);
    expect(await directory.getPilotOptionalCredential({
      tenantId:first.id,identityId:identity,accountLogin:login,kind:'P'})).toBeNull();
    expect(await directory.allowlistPilotIdentity(first.id,identity,identity)).toBe(true);
    // A newly active allowance has a DIFFERENT revision: no stale P revival.
    expect(await directory.getPilotOptionalCredential({
      tenantId:first.id,identityId:identity,accountLogin:login,kind:'P'})).toBeNull();
    expect(await directory.getPilotOptionalCredential({
      tenantId:second.id,identityId:identity,accountLogin:login,kind:'K'})).toBeNull();
  });
});
