// CAP-4: App JWT self-authentication against a real disposable PostgreSQL
// tenant database. Provider replies are in-memory; no GitHub credentials, live
// webhook configuration or production account is accessed by these tests.
import crypto from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {createDb} from '../../src/db.js';
import {createCredentials} from '../../src/github/credentials.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import {makeFakeGitHub} from '../../test/helpers/fake-github.js';
import {openIsolatedSchema,closeIsolatedSchema,neonShapedQuery}
  from '../../test/helpers/pg-neon-adapter.js';

const env={TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64url')};
const appId=911201,org='example-org',accountId=901101;
const routes=['GET /app','GET /app/hook/config','PATCH /app/hook/config',
  'GET /app/hook/deliveries/{delivery_id}',
  'GET /app/hook/deliveries',
  'POST /app/hook/deliveries/{delivery_id}/attempts',
  'GET /app/installations/{installation_id}',
  'GET /app/installation-requests'];
const owner={client_id:'real-db-jwt-owner',accounts:[org],
  default_account:org,profile:'read_only',mode:'preview',listing:'catalog'};
let db,gh,credentials,publicKey;
async function run(conn,name,args={}){
  const result=await createDispatch({env,credentials,fetch:gh.fetch,
    gates:[],sleep:async()=>{},now:()=>Date.UTC(2026,9,22,17,0)})({
    registry,name,args,connection:conn,db});
  return result;
}
beforeAll(async()=>{
  const url=process.env.TEST_DATABASE_URL;
  if(!url||!['localhost','127.0.0.1','[::1]','::1'].includes(new URL(url).hostname))
    throw Error('CAP-4 JWT integration tests require disposable localhost PostgreSQL.');
  await openIsolatedSchema(url);
  db=createDb(neonShapedQuery());await db.initSchema();
  const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048,
    privateKeyEncoding:{type:'pkcs8',format:'pem'},
    publicKeyEncoding:{type:'spki',format:'pem'}});
  publicKey=pair.publicKey;
  gh=makeFakeGitHub({routes});
  credentials=createCredentials({db,env,fetch:gh.fetch,
    now:()=>Date.UTC(2026,9,22,17,0)});
  await credentials.storeApp({
    id:appId,slug:'owner-app',client_id:'app-owner-client-id',
    client_secret:'a-fixture-app-client-secret',
    pem:pair.privateKey,webhook_secret:'a-fixture-webhook-secret'
  },{ownerLogin:org,ownerType:'Organization'});
  await db.upsertAccount({login:org,accountId,accountType:'Organization',
    label:'Owned App',credentialKind:'app',appId});
  await db.setInstallation(org,{installationId:911202,repositorySelection:'all',
    permissions:{metadata:'read'},status:'active'});
});
afterAll(async()=>{await closeIsolatedSchema()});
describe('App JWT owner isolation and sealed signing on real PostgreSQL',()=>{
  it('signs a real RS256 JWT from sealed App key, confirms provider owner and redacts webhook secret',async()=>{
    gh.when(routes[0]).reply(200,{
      id:appId,slug:'owner-app',owner:{login:org,id:accountId},
      name:'Owner App'});
    gh.when(routes[1]).reply(200,{
      url:'https://hooks.example.test/private?credential=hidden',
      content_type:'json',insecure_ssl:'0',
      secret:'this-webhook-secret-must-not-be-shown'});
    const out=await run(owner,'github_app_webhook_configuration');
    expect(out.isError).not.toBe(true);
    expect(out.structuredContent.config).toEqual({
      url_host:'hooks.example.test',content_type:'json',tls_verified:true});
    const payload=JSON.stringify(out.structuredContent);
    expect(payload).not.toMatch(/credential|hidden|webhook-secret|private/);
    const token=gh.calls[0].headers.authorization.split(' ')[1];
    const segments=token.split('.');
    expect(segments).toHaveLength(3);
    const jwtHeader=JSON.parse(Buffer.from(segments[0],'base64url').toString('utf8'));
    const jwtPayload=JSON.parse(Buffer.from(segments[1],'base64url').toString('utf8'));
    expect(jwtHeader.alg).toBe('RS256');
    expect(jwtPayload.iss).toBe(String(appId));
    expect(crypto.verify('RSA-SHA256',Buffer.from(segments[0]+'.'+segments[1]),
      publicKey,Buffer.from(segments[2],'base64url'))).toBe(true);
    expect(gh.calls.map(x=>x.route)).toEqual(routes.slice(0,2));
    expect(gh.invalid).toEqual([]);
  });
  it('journals one exact HTTPS PATCH on two real-PostgreSQL concurrent requests with sealed App JWT',async()=>{
    let current={url:'https://hooks.example.test/private/value',
      content_type:'form',insecure_ssl:'0',
      secret:'another-fake-provider-secret-not-for-history'};
    gh.when(routes[0]).reply(200,{
      id:appId,slug:'owner-app',owner:{login:org,id:accountId},
      name:'Owner App'});
    gh.when(routes[1]).reply(200,()=>current);
    gh.when(routes[2]).reply(200,request=>{
      current={...current,...request.body};return current;
    });
    const connection={...owner,profile:'full',mode:'production'};
    const args={url:'https://hooks.new.example/events',contentType:'json',confirm:true};
    const baseCount=gh.calls.length;
    const [a,b]=await Promise.all([
      run(connection,'github_app_webhook_configuration_set',args),
      run(connection,'github_app_webhook_configuration_set',args)
    ]);
    const pair=[a.structuredContent?.status,b.structuredContent?.status].sort();
    expect(pair).toEqual(['applied','replayed']);
    const sent=gh.calls.slice(baseCount).filter(x=>x.method==='PATCH');
    expect(sent).toHaveLength(1);
    expect(sent[0].route).toBe(routes[2]);
    expect(sent[0].body).toEqual({
      url:'https://hooks.new.example/events',content_type:'json'});
    const applied=a.structuredContent.status==='applied'?a.structuredContent:b.structuredContent;
    const journal=await db.getChange(applied.logged.id);
    expect(journal.before.url_host).toBe('hooks.example.test');
    expect(journal.after.url_host).toBe('hooks.new.example');
    expect(journal.after.url_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(journal)).not.toMatch(/private\/value|another-fake-provider-secret|https:\/\//);
    const wrong=await run({...owner,accounts:['foreign'],default_account:'foreign'},
      'github_app_webhook_configuration_set',args);
    expect(wrong.isError).toBe(true);
    expect(gh.calls.slice(baseCount).filter(x=>x.method==='PATCH')).toHaveLength(1);
    expect(gh.invalid).toEqual([]);
    expect(gh.unmatched).toEqual([]);
    expect(gh.calls.slice(baseCount).every(x=>
      x.path==='/app'||x.path.startsWith('/app/'))).toBe(true);
  });
  it('uses one real PostgreSQL replay claim for concurrent exact App webhook redelivery',async()=>{
    gh.calls.length=0;
    const id=8842,guid='0000-1234-5678-aaaa';
    const original={id,guid,installation_id:911202,event:'issues',
      delivered_at:'2026-10-22T16:30:00Z',status:'Failed',
      redelivery:false,request:{payload:{token:'never-echo'}}};
    const other={...original,id:9992,installation_id:99999,redelivery:true};
    const retry={...original,id:8843,redelivery:true,
      delivered_at:'2026-10-22T17:00:02Z'};
    let accepted=false;
    gh.when(routes[0]).reply(200,{id:appId,slug:'owner-app',
      owner:{login:org,id:accountId},name:'Owner App'});
    gh.when(routes[1]).reply(200,{url:'https://alerts.example.test/private-token',
      content_type:'json',insecure_ssl:'0',secret:'fake-only-signing-secret'});
    gh.when(routes[3]).reply(200,original);
    gh.when(routes[4]).reply(200,()=>accepted?[retry,other,original]:[other,original]);
    gh.when(routes[5]).reply(202,()=>{accepted=true;return {}});
    const conn={...owner,profile:'full',mode:'production'};
    const args={deliveryId:id,confirm:true};
    const [first,second]=await Promise.all([
      run(conn,'github_app_webhook_redeliver',args),
      run(conn,'github_app_webhook_redeliver',args)
    ]);
    expect([first.structuredContent?.status,second.structuredContent?.status].sort())
      .toEqual(['applied','replayed']);
    const applied=first.structuredContent.status==='applied'?first:second;
    const post=gh.calls.filter(c=>c.method==='POST');
    expect(post).toHaveLength(1);
    expect(post[0].route).toBe(routes[5]);
    expect(post[0].path).toBe('/app/hook/deliveries/8842/attempts');
    const change=await db.getChange(applied.structuredContent.logged.id);
    expect(change.before).toMatchObject({
      id,installation_id:911202,destination:'alerts.example.test'});
    expect(change.after).toMatchObject({
      delivery_id:id,independentlyObserved:true,retryReceiptId:8843});
    expect(JSON.stringify({change,result:applied.structuredContent}))
      .not.toMatch(/private-token|fake-only-signing-secret|never-echo/);
    expect(gh.unmatched).toEqual([]);
    expect(gh.invalid).toEqual([]);
    const repeat=await run(conn,'github_app_webhook_redeliver',args);
    expect(repeat.structuredContent.status).toBe('replayed');
    expect(gh.calls.filter(c=>c.method==='POST')).toHaveLength(1);
  });
  it('verifies JWT-only enrolled installation permissions and filters other App request tenants with real PostgreSQL',async()=>{
    const start=gh.calls.length;
    gh.when(routes[0]).reply(200,{id:appId,slug:'owner-app',
      name:'Owner App',owner:{login:org,id:accountId}});
    gh.when(routes[6]).reply(200,{
      id:911202,app_id:appId,
      account:{id:accountId,login:org,
        private:{access_token:'PROVIDER-CONFIDENTIAL'}},
      target_id:accountId,target_type:'Organization',
      permissions:{metadata:'read',issues:'write'},
      events:['issues'],repository_selection:'selected',
      suspended_at:null,credentials:{jwt:'PROVIDER-CONFIDENTIAL'}});
    gh.when(routes[7]).reply(200,[
      {id:832,account:{id:999,login:'another-org'},
        requester:{id:812,login:'foreign-requester'},
        created_at:'2026-10-22T13:00:00Z',secret:'NOT-OURS'},
      {id:833,account:{id:accountId,login:org},
        requester:{id:913,login:'owner-member',
          secret:'NEVER-REVEAL'},
        created_at:'2026-10-22T13:05:00Z',
        secret:'NEVER-REVEAL'}
    ]);
    const grant=await run(owner,'github_app_owner_installation_grants');
    expect(grant.isError).not.toBe(true);
    expect(grant.structuredContent).toMatchObject({
      app_id:appId,installation_id:911202,org,
      permissions:{metadata:'read',issues:'write'},
      events:['issues'],cached_permissions_match:false});
    const pending=await run(owner,'github_app_owner_installation_requests',
      {max:8,page:1});
    expect(pending.isError).not.toBe(true);
    expect(pending.structuredContent.requests).toEqual([
      {id:833,requester_login:'owner-member',
        created_at:'2026-10-22T13:05:00Z',
        created_at_local:'Oct 22, 2026, 7:05 AM MDT'}]);
    expect(JSON.stringify({grant:grant.structuredContent,
      pending:pending.structuredContent}))
      .not.toMatch(/NEVER-REVEAL|PROVIDER-CONFIDENTIAL|NOT-OURS|foreign-requester/);
    const calls=gh.calls.slice(start);
    expect(calls.map(c=>c.route)).toEqual([
      routes[0],routes[6],routes[0],routes[7]]);
    expect(calls.every(c=>c.method==='GET'&&
      (c.path==='/app'||c.path.startsWith('/app/')))).toBe(true);
    expect(gh.invalid).toEqual([]);
    expect(gh.unmatched).toEqual([]);
  });
  it('refuses an unrelated connection or delegated pass before JWT issuance or provider call',async()=>{
    gh.calls.length=0;
    const other=await run({...owner,accounts:['other-org'],
      default_account:'other-org'},'github_app_owner_identity',{owner:org});
    expect(other.isError).toBe(true);
    const pass=await run({...owner,pass:true},'github_app_owner_identity');
    expect(pass.isError).toBe(true);
    expect(gh.calls).toHaveLength(0);
  });
});
