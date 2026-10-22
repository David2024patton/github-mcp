import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { beforeAll,afterAll,describe,expect,it } from 'vitest';
import { createDb } from '../../src/db.js';
import { createTenantDirectory, initializeProvisionedTenant,
  tenantConnectionString } from '../../src/tenancy/directory.js';
import { purgeRevokedTenantArtifacts } from '../../src/tenancy/incident-cleanup.js';

const handles=[];
const sqlFor=client=>async(parts,...values)=>{
  let q=parts[0];
  for(let i=0;i<values.length;i++)q+='$'+(i+1)+parts[i+1];
  return (await client.query(q,values)).rows;
};
async function connect(url){
  const client=new pg.Client({connectionString:url});
  await client.connect();handles.push(client);return client;
}
let root,dir,tenantA,tenantB,sqlA,sqlB,dbA,dbB,ownerA,ownerB,schema;
beforeAll(async()=>{
  const url=process.env.TEST_DATABASE_URL;
  if(!url || !['localhost','127.0.0.1','::1','[::1]'].includes(new URL(url).hostname))
    throw new Error('PUB-3 incident tests require local disposable PostgreSQL.');
  root=await connect(url);
  schema='github_pub3_incident_'+randomBytes(6).toString('hex');
  await root.query('CREATE SCHEMA "'+schema+'"');
  await root.query('SET search_path TO "'+schema+'"');
  dir=createTenantDirectory(sqlFor(root));
  await dir.initSchema();
  ownerA=await dir.enrollVerifiedGithubSubject('991001');
  ownerB=await dir.enrollVerifiedGithubSubject('991002');
  const aId=await dir.provisionPilotForOwnerAccount(ownerA,'incident-a');
  const bId=await dir.provisionPilotForOwnerAccount(ownerB,'incident-b');
  tenantA={id:aId};tenantB={id:bId};
  const first=await connect(tenantConnectionString(url,aId));
  const second=await connect(tenantConnectionString(url,bId));
  sqlA=sqlFor(first);sqlB=sqlFor(second);
  await initializeProvisionedTenant({tenantId:aId,connectionString:url,sqlFactory:()=>sqlA});
  await initializeProvisionedTenant({tenantId:bId,connectionString:url,sqlFactory:()=>sqlB});
  const as='gh_t_'+aId.replaceAll('-',''),bs='gh_t_'+bId.replaceAll('-','');
  expect(await dir.activate(aId,as)).toBe(true);
  expect(await dir.activate(bId,bs)).toBe(true);
  await dir.allowlistPilotIdentity(aId,ownerA,ownerA);
  await dir.allowlistPilotIdentity(bId,ownerB,ownerB);
  dbA=createDb(sqlA);dbB=createDb(sqlB);
});
afterAll(async()=>{
  if(root){
    for(const t of [tenantA,tenantB])if(t?.id)
      await root.query('DROP SCHEMA IF EXISTS "gh_t_'+t.id.replaceAll('-','')+'" CASCADE').catch(()=>{});
    if(schema)await root.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE').catch(()=>{});
  }
  for(const client of handles.reverse())await client.end().catch(()=>{});
});

describe('PUB-3 owner incident cleanup in real isolated PostgreSQL',()=>{
  it('atomically revokes one private tenant without deleting a second tenant or restoring old grants',async()=>{
    const clientId='fixture-identical-client';
    for(const [db,login,source] of [[dbA,'incident-a','A'],[dbB,'incident-b','B']]){
      await db.createOAuthClient({clientId,clientSecret:'fixture-mcp-only-'+source,
        redirectUris:['https://fixture.example.test/callback'],
        clientName:'fixture-'+source});
      await db.createAuthCode({code:'fixture-code-'+source,clientId,
        redirectUri:'https://fixture.example.test/callback',
        codeChallenge:'k'.repeat(43),codeChallengeMethod:'S256',
        defaultAccount:login,accounts:[login],mode:'preview',profile:'full',listing:'compact'});
      await db.createAccessToken({clientId,accessToken:'fixture-access-'+source,
        refreshToken:'fixture-refresh-'+source,defaultAccount:login,
        accounts:[login],mode:'preview',profile:'full',listing:'compact'});
      await db.putResult({handle:'res_'+randomBytes(16).toString('base64url'),
        connection:clientId,summary:source,body:{owner:source}});
      await db.createJob({id:'job_'+randomBytes(8).toString('hex'),
        connection:clientId,owner:login,kind:'autofix',providerRef:'11'});
    }
    const rootSql=sqlFor(root);
    for(const [t,id,login] of [[tenantA,ownerA,'incident-a'],[tenantB,ownerB,'incident-b']]){
      await rootSql`INSERT INTO gh_tenant_user_authorizations
        (tenant_id,identity_id,account_login,user_login,access_enc,access_expires_at)
        VALUES (${t.id}::uuid,${id}::uuid,${login},${login},
          'v1.fake.test.fixture',now()+interval '1 hour')`;
    }
    // Both workspaces possess independent synthetic optional-token records.
    // The incident purge must delete ONLY incident-a, in the same transaction
    // as its U grants and pending OAuth states. No real token is involved.
    for(const [tenant,owner,account,subject] of [
      [tenantA,ownerA,'incident-a','991001'],
      [tenantB,ownerB,'incident-b','991002']
    ]){
      const active=await dir.authorizedPilotIdentity(tenant.id,owner);
      expect(active).not.toBeNull();
      await rootSql`INSERT INTO gh_tenant_optional_credentials(
        tenant_id,identity_id,account_login,kind,provider_host,
        actor_id,account_id,membership_revision,pilot_revision,
        access_enc,cipher_fingerprint,verified_operation,verified_resource,scopes)
        VALUES(${tenant.id}::uuid,${owner}::uuid,${account},'K','github.com',
          ${Number(subject)},${Number(subject)},${active.membershipRevision},
          ${active.pilotRevision},'v1.fake.test.fixture',${'a'.repeat(64)},
          'GET /notifications',${'user/'+subject},${['notifications']}::text[])`;
    }
    const pilots=await dir.listPilotsForAccount('incident-a');
    expect(pilots).toEqual([{tenantId:tenantA.id,ownerIdentityId:ownerA}]);
    expect(await dir.revokePrivatePilotsForAccount('incident-a')).toBe(1);
    expect(await dir.authorizedPilotIdentity(tenantA.id,ownerA)).toBeNull();
    await expect(purgeRevokedTenantArtifacts({directory:dir,tenantId:tenantA.id,
      ownerIdentityId:ownerB,connectionString:process.env.TEST_DATABASE_URL,
      sqlFactory:()=>sqlA})).rejects.toThrow(/owner/);
    const removed=await purgeRevokedTenantArtifacts({directory:dir,tenantId:tenantA.id,
      ownerIdentityId:ownerA,connectionString:process.env.TEST_DATABASE_URL,
      sqlFactory:()=>sqlA});
    expect(removed).toMatchObject({tokens:1,codes:1,clients:1,jobs:1,results:1});
    expect(await dbA.getOAuthClient(clientId)).toBeNull();
    expect(await dbA.getAccessToken('fixture-access-A')).toBeNull();
    expect(await dbB.getOAuthClient(clientId)).not.toBeNull();
    expect(await dbB.getAccessToken('fixture-access-B')).not.toBeNull();
    const secrets=await dir.purgePrivatePilotRootSecrets('incident-a');
    expect(secrets).toEqual({userGrants:1,pendingStates:0,optionalGrants:1});
    const remainingOptional=await rootSql`SELECT account_login
      FROM gh_tenant_optional_credentials ORDER BY account_login`;
    expect(remainingOptional.map(x=>x.account_login)).toEqual(['incident-b']);
    const remaining=await rootSql`SELECT account_login FROM gh_tenant_user_authorizations`;
    expect(remaining.map(x=>x.account_login)).toEqual(['incident-b']);
    // A second owner click after partial cleanup is safe and cannot resurrect anything.
    expect(await dir.revokePrivatePilotsForAccount('incident-a')).toBe(0);
    expect(await purgeRevokedTenantArtifacts({directory:dir,tenantId:tenantA.id,
      ownerIdentityId:ownerA,connectionString:process.env.TEST_DATABASE_URL,
      sqlFactory:()=>sqlA})).toEqual({tokens:0,codes:0,clients:0,jobs:0,results:0});
    expect((await dbB.getAccessToken('fixture-access-B')).profile).toBe('full');
  });
});
