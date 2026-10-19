import crypto, { createHash } from 'node:crypto';
import pg from 'pg';
import { createDb } from '../../src/db.js';
import { issueTenantCredential } from '../../src/tenancy/routed-credential.js';
import { resolvePrivateTenantMcpBearer } from '../../src/tenancy/mcp-route.js';
import { privateTenantToken } from '../../src/tenancy/oauth-token.js';
import { call, json, request } from '../../test/helpers/http-harness.js';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createTenantDirectory, tenantConnectionString, tenantSchemaName,
  initializeProvisionedTenant } from '../../src/tenancy/directory.js';

let admin, tenantA, tenantB, directory, a, b, ownerA, ownerB, namespace;
const clients = [];
const connect = async (url) => {
  const p = new pg.Client({ connectionString: url });
  await p.connect(); clients.push(p); return p;
};
const sqlFor = (client) => async (template, ...values) => {
  let query = template[0];
  for (let i = 0; i < values.length; i++) query += '$' + (i + 1) + template[i + 1];
  return (await client.query(query, values)).rows;
};

beforeAll(async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Disposable TEST_DATABASE_URL is required.');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname))
    throw new Error('Refusing non-local PostgreSQL for private-pilot tests.');
  admin = await connect(url);
  namespace = 'github_pub2_pilot_' + crypto.randomBytes(6).toString('hex');
  await admin.query('CREATE SCHEMA "' + namespace + '"');
  await admin.query('SET search_path TO "' + namespace + '"');
  directory = createTenantDirectory(sqlFor(admin));
  await directory.initSchema();
  ownerA = await directory.enrollVerifiedGithubSubject('20001');
  ownerB = await directory.enrollVerifiedGithubSubject('20002');
  a = await directory.provision(ownerA);
  b = await directory.provision(ownerB);
  const pa = await connect(tenantConnectionString(url, a.id));
  const pb = await connect(tenantConnectionString(url, b.id));
  tenantA = sqlFor(pa); tenantB = sqlFor(pb);
  await initializeProvisionedTenant({ tenantId: a.id, connectionString: url, sqlFactory: () => tenantA });
  await initializeProvisionedTenant({ tenantId: b.id, connectionString: url, sqlFactory: () => tenantB });
  expect(await directory.activate(a.id, tenantSchemaName(a.id))).toBe(true);
  expect(await directory.activate(b.id, tenantSchemaName(b.id))).toBe(true);
});

afterAll(async () => {
  if (admin) {
    for (const tenant of [a, b]) {
      if (tenant?.id) await admin.query('DROP SCHEMA IF EXISTS "' + tenantSchemaName(tenant.id) + '" CASCADE').catch(() => {});
    }
    if (namespace) await admin.query('DROP SCHEMA IF EXISTS "' + namespace + '" CASCADE').catch(() => {});
  }
  for (const c of clients.reverse()) await c.end().catch(() => {});
});

describe('PUB-2 private-only provider identity and tenant pilot allowlist in REAL PostgreSQL', () => {
  it('does not allow an unknown, cross-tenant, or merely invited identity into a pilot', async () => {
    expect(await directory.resolveAllowlistedPilotSubject(a.id, '20001')).toBeNull();
    expect(await directory.resolveAllowlistedPilotSubject(a.id, '20002')).toBeNull();
    expect(await directory.resolveAllowlistedPilotSubject(b.id, '20001')).toBeNull();
    expect(await directory.resolveAllowlistedPilotSubject(a.id, '29999')).toBeNull();
    expect(await directory.allowlistPilotIdentity(a.id, ownerB, ownerB)).toBe(false);
    expect(await directory.allowlistPilotIdentity(a.id, ownerA, ownerB)).toBe(false);
    expect(await directory.grant(a.id, ownerA, ownerB, 'member')).toBe(true);
    expect(await directory.resolveAllowlistedPilotSubject(a.id, '20002')).toBeNull();
  });

  it('permits exactly one owner-issued pilot member and rejects cross-tenant actions', async () => {
    expect(await directory.allowlistPilotIdentity(a.id, ownerB, ownerB)).toBe(false);
    expect(await directory.allowlistPilotIdentity(a.id, ownerA, ownerB)).toBe(true);
    const match = await directory.resolveAllowlistedPilotSubject(a.id, '20002');
    expect(match).toMatchObject({ identityId: ownerB, tenantId: a.id,
      role: 'member', pilotRevision: 1 });
    expect(await directory.resolveAllowlistedPilotSubject(b.id, '20002')).toBeNull();
    expect(await directory.revokePilotIdentity(a.id, ownerB, ownerB)).toBe(false);
    expect(await directory.revokePilotIdentity(b.id, ownerA, ownerB)).toBe(false);
    expect(await directory.revokePilotIdentity(a.id, ownerA, ownerB)).toBe(true);
    expect(await directory.resolveAllowlistedPilotSubject(a.id, '20002')).toBeNull();
  });

  it('routes valid signed access into only its own tenant store; revoked and forged routes stay closed',async()=>{
    const { randomBytes } = await import('node:crypto');
    const env={GITHUB_PRIVATE_TENANT_PILOT:'enabled',
      GITHUB_TENANT_ROUTING_KEY:randomBytes(32).toString('base64url'),
      DATABASE_URL:process.env.TEST_DATABASE_URL};
    const { root }={root:sqlFor(admin)};
    const tenantDbA=createDb(tenantA);
    const tenantDbB=createDb(tenantB);
    const claimA={tenantId:a.id,identityId:ownerA};
    const claimB={tenantId:b.id,identityId:ownerB};
    expect(await directory.allowlistPilotIdentity(a.id,ownerA,ownerA)).toBe(true);
    expect(await directory.allowlistPilotIdentity(b.id,ownerB,ownerB)).toBe(true);
    const clientA=issueTenantCredential('tcl',claimA,env);
    const tokenA=issueTenantCredential('tac',claimA,env);
    const refreshA=issueTenantCredential('trf',claimA,env);
    const clientB=issueTenantCredential('tcl',claimB,env);
    const tokenB=issueTenantCredential('tac',claimB,env);
    await tenantDbA.createOAuthClient({clientId:clientA,clientSecret:'fixture-a-test-secret',
      redirectUris:['https://pilot.example.test/cb'],clientName:'A'});
    await tenantDbB.createOAuthClient({clientId:clientB,clientSecret:'fixture-b-test-secret',
      redirectUris:['https://pilot.example.test/cb'],clientName:'B'});
    await tenantDbA.createAccessToken({clientId:clientA,accessToken:tokenA,refreshToken:refreshA,
      defaultAccount:'overlap-org',accounts:['overlap-org'],mode:'preview',profile:'full',listing:'compact'});
    await tenantDbB.createAccessToken({clientId:clientB,accessToken:tokenB,
      refreshToken:issueTenantCredential('trf',claimB,env),defaultAccount:'overlap-org',
      accounts:['overlap-org'],mode:'preview',profile:'read_only',listing:'compact'});
    const overrides={env,rootSqlFactory:()=>root,tenantSqlFactory:(url)=>
      url.includes(tenantSchemaName(a.id))?tenantA:tenantB};
    const one=await resolvePrivateTenantMcpBearer({...overrides,authorization:'Bearer '+tokenA});
    const two=await resolvePrivateTenantMcpBearer({...overrides,authorization:'Bearer '+tokenB});
    expect(one.tenant).toMatchObject({tenantId:a.id,identityId:ownerA});
    expect(two.tenant).toMatchObject({tenantId:b.id,identityId:ownerB});
    expect((await one.db.getAccessToken(tokenA)).profile).toBe('full');
    expect((await two.db.getAccessToken(tokenB)).profile).toBe('read_only');
    expect(await one.db.getAccessToken(tokenB)).toBeNull();
    expect(await two.db.getAccessToken(tokenA)).toBeNull();
    expect(await resolvePrivateTenantMcpBearer({...overrides,
      authorization:'Bearer '+tokenA,env:{...env,GITHUB_PRIVATE_TENANT_PILOT:'disabled'}})).toBeNull();
    expect(await directory.revokePilotIdentity(a.id,ownerA,ownerA)).toBe(true);
    expect(await resolvePrivateTenantMcpBearer({...overrides,authorization:'Bearer '+tokenA})).toBeNull();
    expect(await resolvePrivateTenantMcpBearer({...overrides,authorization:'Bearer '+tokenB})).not.toBeNull();
    expect(await tenantDbB.revokeAccessToken(tokenB)).toBe(true);
    expect(await resolvePrivateTenantMcpBearer({...overrides,authorization:'Bearer '+tokenB})).toBeNull();
  });

  it('redeems tenant-scoped OAuth code exactly once, rotates refresh atomically, and denies wrong clients',async()=>{
    const env={PUBLIC_BASE_URL:'https://pilot.github.example.test',
      GITHUB_PRIVATE_TENANT_PILOT:'enabled',
      GITHUB_TENANT_ROUTING_KEY:crypto.randomBytes(32).toString('base64url'),
      DATABASE_URL:process.env.TEST_DATABASE_URL};
    const grant={tenantId:a.id,identityId:ownerA};
    const other={tenantId:b.id,identityId:ownerB};
    expect(await directory.allowlistPilotIdentity(a.id,ownerA,ownerA)).toBe(true);
    expect(await directory.allowlistPilotIdentity(b.id,ownerB,ownerB)).toBe(true);
    const clientA=issueTenantCredential('tcl',grant,env);
    const clientB=issueTenantCredential('tcl',other,env);
    const clientSecret='fixture-private-tenant-a-secret';
    const clientSecretB='fixture-private-tenant-b-secret';
    const dbA=createDb(tenantA),dbB=createDb(tenantB);
    const redirect='https://pilot.example.test/callback';
    const verifier='z'.repeat(43);
    const challenge=createHash('sha256').update(verifier).digest('base64url');
    await dbA.createOAuthClient({clientId:clientA,clientSecret,redirectUris:[redirect],clientName:'tenant-A-pilot'});
    await dbB.createOAuthClient({clientId:clientB,clientSecret:clientSecretB,redirectUris:[redirect],clientName:'tenant-B-pilot'});
    const code='fixture-signed-pilot-code';
    await dbA.createAuthCode({code,clientId:clientA,redirectUri:redirect,codeChallenge:challenge,
      codeChallengeMethod:'S256',defaultAccount:'overlap-org',accounts:['overlap-org'],
      mode:'preview',profile:'full',listing:'compact'});
    const route=(url)=>url.includes(tenantSchemaName(a.id))?tenantA:tenantB;
    const handler=(req,res)=>privateTenantToken(req,res,{env,rootSqlFactory:()=>sqlFor(admin),tenantSqlFactory:route});
    const form={grant_type:'authorization_code',client_id:clientA,client_secret:clientSecret,
      redirect_uri:redirect,code,code_verifier:verifier,resource:env.PUBLIC_BASE_URL+'/api/mcp'};
    const wrongClient=await call(handler,request('POST',{...form,client_id:clientB,client_secret:clientSecretB}));
    expect(wrongClient.statusCode).toBe(400);
    const redeemed=await call(handler,request('POST',form));
    expect(redeemed.statusCode).toBe(200);
    const first=json(redeemed);
    expect(first.access_token).toMatch(/^tac_/);
    expect(first.refresh_token).toMatch(/^trf_/);
    expect((await dbA.getAccessToken(first.access_token)).profile).toBe('full');
    expect(await dbB.getAccessToken(first.access_token)).toBeNull();
    expect((await call(handler,request('POST',form))).statusCode).toBe(400);
    const tokenRoute=await resolvePrivateTenantMcpBearer({
      authorization:'Bearer '+first.access_token,env,
      rootSqlFactory:()=>sqlFor(admin),tenantSqlFactory:route});
    expect(tokenRoute.tenant.tenantId).toBe(a.id);
    const rotation={grant_type:'refresh_token',client_id:clientA,client_secret:clientSecret,
      refresh_token:first.refresh_token,resource:env.PUBLIC_BASE_URL+'/api/mcp'};
    const refreshed=await call(handler,request('POST',rotation));
    expect(refreshed.statusCode).toBe(200);
    const second=json(refreshed);
    expect(second.access_token).toMatch(/^tac_/);
    expect(second.access_token).not.toBe(first.access_token);
    expect((await call(handler,request('POST',rotation))).statusCode).toBe(400);
    expect(await dbA.getAccessToken(first.access_token)).toBeNull();
    expect((await dbA.getAccessToken(second.access_token)).profile).toBe('full');
    expect((await call(handler,request('POST',{...rotation,client_id:clientB,
      client_secret:clientSecretB,refresh_token:second.refresh_token}))).statusCode).toBe(400);
    expect(await directory.revokePilotIdentity(a.id,ownerA,ownerA)).toBe(true);
    expect((await call(handler,request('POST',{...rotation,
      refresh_token:second.refresh_token}))).statusCode).toBe(401);
    expect(await dbA.getAccessToken(second.access_token)).not.toBeNull();
    expect(await resolvePrivateTenantMcpBearer({
      authorization:'Bearer '+second.access_token,env,
      rootSqlFactory:()=>sqlFor(admin),tenantSqlFactory:route})).toBeNull();
  });

  it('cannot reactivate a revoked tenant member through the allowlist alone', async () => {
    expect(await directory.allowlistPilotIdentity(a.id, ownerA, ownerB)).toBe(true);
    const active = await directory.resolveAllowlistedPilotSubject(a.id, '20002');
    expect(active.pilotRevision).toBeGreaterThan(1);
    expect(await directory.revoke(a.id, ownerA, ownerB)).toBe(true);
    expect(await directory.resolveAllowlistedPilotSubject(a.id, '20002')).toBeNull();
    expect(await directory.allowlistPilotIdentity(a.id, ownerA, ownerB)).toBe(false);
    expect(await directory.grant(a.id, ownerA, ownerB, 'member')).toBe(true);
    const refreshed = await directory.resolveAllowlistedPilotSubject(a.id, '20002');
    expect(refreshed.membershipRevision).toBeGreaterThan(active.membershipRevision);
    expect(await directory.enrollVerifiedGithubSubject('20002')).toBe(ownerB);
    expect(await directory.resolveAllowlistedPilotSubject(b.id, '20001')).toBeNull();
  });
});
