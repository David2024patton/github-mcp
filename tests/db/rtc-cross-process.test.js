import {beforeAll,afterAll,it,expect} from 'vitest';
import {fork} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createDb} from '../../src/db.js';
import {openIsolatedSchema,closeIsolatedSchema,neonShapedQuery,rawQuery} from '../../test/helpers/pg-neon-adapter.js';
let db,schema;const workers=[];
beforeAll(async()=>{
  const url=process.env.TEST_DATABASE_URL;
  if(!url||!['localhost','127.0.0.1','::1','[::1]'].includes(new URL(url).hostname))
    throw new Error('Only disposable localhost Postgres is allowed.');
  schema=await openIsolatedSchema(url);db=createDb(neonShapedQuery());await db.initSchema();
  await rawQuery(`INSERT INTO gh_accounts
    (login,account_id,account_type,label,installation_status,repository_selection,is_scratch,production_enabled)
    VALUES ('rate-scratch',991,'Organization','Fixture','active','all',TRUE,FALSE)`);
});
afterAll(async()=>{
  await Promise.all(workers.map(worker=>new Promise(resolve=>{
    if(worker.child.exitCode!==null)return resolve();
    const timer=setTimeout(()=>{worker.child.kill('SIGKILL');},3000);
    worker.child.once('exit',()=>{clearTimeout(timer);resolve();});
    if(worker.child.connected)worker.child.send('close');else worker.child.kill();
  })));
  await closeIsolatedSchema();
});
async function startWorker(){
  const child=fork(fileURLToPath(new URL('../../test/helpers/rtc-rate-worker.mjs',import.meta.url)),[],{
    execArgv:[],env:{TEST_DATABASE_URL:process.env.TEST_DATABASE_URL,RTC_RATE_TEST_SCHEMA:schema},
    stdio:['ignore','pipe','pipe','ipc']
  });
  const worker={child,output:''};workers.push(worker);
  child.stdout.on('data',part=>{worker.output+=part;});child.stderr.on('data',part=>{worker.output+=part;});
  const ready=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('RTC worker startup timed out'));},10000);
    const failed=()=>{clearTimeout(timer);reject(new Error('RTC worker exited before startup'));};
    child.once('error',failed);child.once('exit',failed);
    child.once('message',message=>{clearTimeout(timer);child.off('exit',failed);resolve(message);});
  });
  return {...worker,...ready};
}
async function issue(){
  const pass='rtc_pass_'+randomBytes(32).toString('base64url'),passId=randomBytes(12).toString('hex');
  await db.createRtcPass({pass,passId,account:'rate-scratch',expiresAt:new Date(Date.now()+600000)});
  return {pass,passId};
}
const call=(url,pass)=>fetch(url,{headers:{authorization:'Bearer '+pass},signal:AbortSignal.timeout(10000)});
it('enforces exactly sixty shared HTTP reads across two separate server processes and connections',async()=>{
  const [a,b]=await Promise.all([startWorker(),startWorker()]);
  expect(a.pid).not.toBe(b.pid);expect(a.pid).not.toBe(process.pid);
  const {pass,passId}=await issue();
  const responses=await Promise.all(Array.from({length:64},(_,i)=>call(i%2?a.url:b.url,pass)));
  expect(responses.filter(r=>r.status===200)).toHaveLength(60);
  expect(responses.filter(r=>r.status===429)).toHaveLength(4);
  for(const r of responses){
    const data=await r.json();expect(JSON.stringify(data)).not.toContain(pass);
    if(r.status===429){expect(data.error.code).toBe('rate_limited');expect(r.headers.get('retry-after')).toBe('60');}
    else expect(data).toMatchObject({ok:true,result:{profile:'read_only',mode:'preview',allow_writes:false}});
  }
  expect(await db.revokeRtcPass(passId)).toBe(true);
  for(const worker of [a,b]){
    const response=await call(worker.url,pass);expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('pass_revoked');
  }
  const other=await issue();
  expect((await call(a.url,other.pass)).status).toBe(200);
  await rawQuery("UPDATE gh_accounts SET is_scratch=FALSE WHERE login='rate-scratch'");
  for(const worker of [a,b])expect((await call(worker.url,other.pass)).status).toBe(403);
  expect(workers.every(w=>!w.output.includes(pass)&&!w.output.includes(other.pass))).toBe(true);
});
