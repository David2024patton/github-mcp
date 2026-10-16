import {beforeAll,afterAll,describe,expect,it} from 'vitest';
import {randomBytes} from 'node:crypto';
import {createDb} from '../../src/db.js';
import {openIsolatedSchema,closeIsolatedSchema,neonShapedQuery,rawQuery} from '../../test/helpers/pg-neon-adapter.js';
let db;
const issue=()=> 'rtc_pass_'+randomBytes(32).toString('base64url');
beforeAll(async()=>{
 if(!process.env.TEST_DATABASE_URL||!['localhost','127.0.0.1','::1','[::1]'].includes(new URL(process.env.TEST_DATABASE_URL).hostname))
   throw new Error('Refusing non-local Postgres for RTC pass test');
 await openIsolatedSchema(process.env.TEST_DATABASE_URL);
 db=createDb(neonShapedQuery());await db.initSchema();
});
afterAll(async()=>closeIsolatedSchema());
describe('RTC pass-only credentials in isolated Postgres',()=>{
 it('refuses non-scratch account and only issues exact preview/read_only scope',async()=>{
  await rawQuery(`INSERT INTO gh_accounts
    (login,account_id,account_type,label,installation_status,repository_selection,is_scratch,production_enabled)
    VALUES ('scratch-org',111,'Organization','Fixture','active','all',TRUE,FALSE),
    ('normal-org',112,'Organization','Other','active','all',FALSE,FALSE)`);
  const pass=issue(),passId=randomBytes(12).toString('hex');
  const expiresAt=new Date(Date.now()+3600000);
  expect(await db.createRtcPass({pass,account:'normal-org',passId,expiresAt})).toBeNull();
  expect(await db.createRtcPass({pass,account:'scratch-org',passId,expiresAt})).toBe('rtc-'+passId);
  const stored=await db.getRtcPass(pass);
  expect(stored).toMatchObject({profile:'read_only',mode:'preview',listing:'compact',
    default_account:'scratch-org',accounts:['scratch-org'],areas:['server','meta'],
    allow_writes:false,production_access:false});
  expect(Number(stored.money_limit_cents)).toBe(0);
  const scoped=await rawQuery('SELECT areas,allow_writes,production_access,money_limit_cents FROM rtc_pass_scopes');
  expect(scoped[0].areas).toEqual(['server','meta']);
  await expect(rawQuery("UPDATE rtc_pass_scopes SET allow_writes=TRUE")).rejects.toThrow();
  expect(await db.getAccessToken(pass)).toBeNull();
  expect(JSON.stringify(await rawQuery('SELECT * FROM oauth_tokens'))).not.toContain(pass);
  expect(await db.revokeRtcPass(passId)).toBe(true);
  expect((await db.getRtcPass(pass)).revoked_at).not.toBeNull();
  expect(await db.revokeRtcPass(passId)).toBe(false);
 });
 it('enforces a shared per-pass atomic request budget',async()=>{
  const pass=issue();
  const results=await Promise.all(Array.from({length:125},()=>db.consumeRtcPassRate(pass)));
  expect(results.filter(Boolean)).toHaveLength(120);
  expect(results.filter(x=>!x)).toHaveLength(5);
 });

 it('reads each pass\'s own stored limit: limit 5 refuses the sixth call, and a second instance shares the count',async()=>{
  await rawQuery(`INSERT INTO gh_accounts
    (login,account_id,account_type,label,installation_status,repository_selection,is_scratch,production_enabled)
    VALUES ('rate-org',113,'Organization','Fixture','active','all',TRUE,FALSE)`);
  const pass=issue(),passId=randomBytes(12).toString('hex');
  expect(await db.createRtcPass({pass,account:'rate-org',passId,expiresAt:new Date(Date.now()+3600000),rateLimitPerMinute:5})).toBe('rtc-'+passId);
  expect(await db.getRtcPass(pass)).toMatchObject({rate_limit_per_minute:5});
  const other=createDb(neonShapedQuery());
  const results=await Promise.all(Array.from({length:12},(_,i)=>(i%2?other:db).consumeRtcPassRate(pass)));
  expect(results.filter(Boolean)).toHaveLength(5);
  expect(results.filter(x=>!x)).toHaveLength(7);
 });
 it('refuses an out-of-range limit and defaults an ordinary pass to 120 per minute',async()=>{
  const expiresAt=new Date(Date.now()+3600000);
  for(const bad of [0,601,1.5,'60',null])
    await expect(db.createRtcPass({pass:issue(),account:'rate-org',passId:randomBytes(12).toString('hex'),expiresAt,rateLimitPerMinute:bad})).rejects.toThrow('1 to 600');
  const pass=issue(),passId=randomBytes(12).toString('hex');
  await db.createRtcPass({pass,account:'rate-org',passId,expiresAt});
  expect(await db.getRtcPass(pass)).toMatchObject({rate_limit_per_minute:120});
  await expect(rawQuery('UPDATE rtc_pass_scopes SET rate_limit_per_minute=601')).rejects.toThrow();
 });
 it('lists a live pass with its scope and request limit but never a token, and one revoke call switches it off',async()=>{
  const pass=issue(),passId=randomBytes(12).toString('hex');
  await db.createRtcPass({pass,account:'rate-org',passId,expiresAt:new Date(Date.now()+3600000),rateLimitPerMinute:30});
  const listed=(await db.listConnections()).find(c=>c.client_id==='rtc-'+passId);
  expect(listed).toMatchObject({kind:'pass',default_account:'rate-org',pass:{areas:['server','meta'],allow_writes:false,production_access:false,rate_limit_per_minute:30}});
  expect(JSON.stringify(listed)).not.toContain(pass);
  expect(await db.revokeConnection('rtc-'+passId)).toBe(1);
  expect((await db.listConnections()).some(c=>c.client_id==='rtc-'+passId)).toBe(false);
  expect((await db.getRtcPass(pass)).revoked_at).not.toBeNull();
 });

 it('R-1: issues a scoped pass with its grant, enforces the database CHECKs, and ties production to a production-enabled account',async()=>{
  await rawQuery(`INSERT INTO gh_accounts
    (login,account_id,account_type,label,installation_status,repository_selection,is_scratch,production_enabled)
    VALUES ('grant-org',211,'Organization','Fixture','active','all',FALSE,FALSE),
    ('prod-org',212,'Organization','Prod','active','all',FALSE,TRUE),
    ('idle-org',213,'Organization','Idle','pending','all',FALSE,FALSE)`);
  const grant={profile:'everyday',mode:'preview',areas:['issue','pr'],repos:['grant-org/app'],allowWrites:true,allowAccessChanges:false,
    moneyLimitCents:0,forHub:false,ratePerMinute:7};
  const pass=issue(),passId=randomBytes(12).toString('hex');
  const expiresAt=new Date(Date.now()+3600000);
  expect(await db.createRtcPassGrant({pass,passId,account:'grant-org',expiresAt,grant})).toBe('rtc-'+passId);
  const stored=await db.getRtcPass(pass);
  expect(stored).toMatchObject({profile:'everyday',mode:'preview',default_account:'grant-org',
    grant:{areas:['issue','pr'],repos:['grant-org/app'],allow_writes:true,allow_access_changes:false,for_hub:false}});
  expect(Number(stored.grant.money_limit_cents)).toBe(0);
  // the shared request budget reads the grant's own limit
  const results=[];for(let i=0;i<9;i++)results.push(await db.consumeRtcPassRate(pass));
  expect(results.filter(Boolean)).toHaveLength(7);
  // account not active, or production without a production-enabled account: no pass is made
  expect(await db.createRtcPassGrant({pass:issue(),passId:randomBytes(12).toString('hex'),account:'idle-org',expiresAt,grant})).toBeNull();
  expect(await db.createRtcPassGrant({pass:issue(),passId:randomBytes(12).toString('hex'),account:'grant-org',expiresAt,grant:{...grant,mode:'production'}})).toBeNull();
  expect(await db.createRtcPassGrant({pass:issue(),passId:randomBytes(12).toString('hex'),account:'prod-org',expiresAt,grant:{...grant,mode:'production',repos:null}})).toMatch(/^rtc-/);
  // a year only for the Hub
  const year=new Date(Date.now()+200*86400000);
  await expect(db.createRtcPassGrant({pass:issue(),passId:randomBytes(12).toString('hex'),account:'grant-org',expiresAt:year,grant})).rejects.toThrow(TypeError);
  expect(await db.createRtcPassGrant({pass:issue(),passId:randomBytes(12).toString('hex'),account:'grant-org',expiresAt:year,grant:{...grant,forHub:true}})).toMatch(/^rtc-/);
  // the database itself refuses contradictory grants
  await expect(rawQuery(`UPDATE rtc_pass_grants SET profile='read_only' WHERE allow_writes`)).rejects.toThrow();
  await expect(rawQuery(`UPDATE rtc_pass_grants SET allow_writes=FALSE,allow_access_changes=TRUE`)).rejects.toThrow();
  await expect(rawQuery(`UPDATE rtc_pass_grants SET allow_writes=FALSE,money_limit_cents=100`)).rejects.toThrow();
  // revoking switches the scoped pass off like any other
  expect(await db.revokeRtcPass(passId)).toBe(true);
  expect((await db.getRtcPass(pass)).revoked_at).toBeTruthy();
 });
});
