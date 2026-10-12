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
    default_account:'scratch-org',accounts:['scratch-org']});
  expect(await db.getAccessToken(pass)).toBeNull();
  expect(JSON.stringify(await rawQuery('SELECT * FROM oauth_tokens'))).not.toContain(pass);
  expect(await db.revokeRtcPass(passId)).toBe(true);
  expect((await db.getRtcPass(pass)).revoked_at).not.toBeNull();
  expect(await db.revokeRtcPass(passId)).toBe(false);
 });
 it('enforces a shared per-pass atomic request budget',async()=>{
  const pass=issue();
  const results=await Promise.all(Array.from({length:65},()=>db.consumeRtcPassRate(pass)));
  expect(results.filter(Boolean)).toHaveLength(60);
  expect(results.filter(x=>!x)).toHaveLength(5);
 });
});
