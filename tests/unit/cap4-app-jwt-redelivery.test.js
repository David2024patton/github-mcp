// CAP-4: App JWT webhook retry requires exact App owner/installation,
// production confirmation and a distinct observed provider retry receipt.
import {describe,it,expect} from 'vitest';
import {makeWorld,parse,runWriteContract,NOW} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import {appWebhookRedeliver} from '../../src/tools/app-jwt-write.js';

const R={
  app:'GET /app',config:'GET /app/hook/config',
  one:'GET /app/hook/deliveries/{delivery_id}',
  list:'GET /app/hook/deliveries',
  attempt:'POST /app/hook/deliveries/{delivery_id}/attempts'
};
const routes=Object.values(R);
const id=7021,installation=902,guid='33333333-aaaa-1111-aaaa-333333333333';
const first={id,guid,installation_id:installation,event:'issues',
  delivered_at:new Date(NOW-10000).toISOString(),status:'Failed',
  redelivery:false,request:{payload:{secret:'never-echo'}},
  response:{headers:{'set-cookie':'private'}}};
const receipt={...first,id:7022,redelivery:true,
  delivered_at:new Date(NOW+1000).toISOString(),
  request:{payload:{api_key:'sensitive'}},response:{payload:'secret'}};
const app={id:901,slug:'owner-app',name:'Owner App',
  owner:{login:'example-org',id:1011}};
function arrange(gh,mode='ok'){
  let accepted=false;
  gh.when(R.app).reply(200,app);
  gh.when(R.config).reply(200,{
    url:'https://alerts.example.test/hidden?k=secret',
    content_type:'json',insecure_ssl:'0',secret:'never-echo-signing-secret'});
  gh.when(R.one).reply(200,first);
  gh.when(R.list).reply(200,()=>{
    const other={...receipt,id:7777,installation_id:99999};
    return accepted&&mode==='ok'?[receipt,other,first]:[other,first];
  });
  gh.when(R.attempt).reply(202,request=>{
    if(request.params.delivery_id!==String(id))throw Error('Wrong webhook target');
    accepted=true;return {};
  });
}
async function prepare(w){
  await w.db.saveApp({id:901,slug:'owner-app',
    ownerLogin:'example-org',ownerType:'Organization',clientId:'fixture'});
  await w.db.upsertAccount({login:'example-org',accountId:1011,
    accountType:'Organization',label:'Owner',credentialKind:'app',appId:901});
  await w.db.setInstallation('example-org',{installationId:installation,
    repositorySelection:'all',status:'active',permissions:{metadata:'read'}});
  w.credentials={...w.credentials,appJwt:async()=> 'synthetic.jwt.not-real'};
  w.ctx.credentials=w.credentials;
}
async function run(w,args={}){
  const r=await createDispatch({env:w.ctx.env,credentials:w.credentials,
    fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:[]})({
    registry,name:'github_app_webhook_redeliver',args,connection:w.connection,db:w.db});
  return {r,body:parse(r)};
}
const writes=gh=>gh.calls.filter(x=>x.method==='POST');
runWriteContract({label:'CAP-4 JWT exact webhook redelivery',
  definition:appWebhookRedeliver,args:{deliveryId:id},arrange,prepare,
  needsConfirm:true,production:true,profile:'full',notifies:['alerts.example.test'],
  externalRoutes:routes});

describe('CAP-4 App webhook redelivery exact receipts and isolation',()=>{
  it('confirms only a new same-GUID same-installation provider redelivery and persists projected metadata',async()=>{
    const w=await makeWorld({profile:'full',mode:'production',externalRoutes:routes});
    arrange(w.gh);await prepare(w);
    const {body}=await run(w,{deliveryId:id,confirm:true});
    expect(body).toMatchObject({done:true,status:'applied',confirmed:true});
    expect(writes(w.gh)).toHaveLength(1);
    expect(writes(w.gh)[0].path).toBe('/app/hook/deliveries/7021/attempts');
    expect(w.gh.invalid).toEqual([]);
    expect(w.gh.unmatched).toEqual([]);
    const journal=await w.db.getChange(body.logged.id);
    expect(journal.before).toMatchObject({
      id,installation_id:installation,destination:'alerts.example.test'});
    expect(journal.after).toMatchObject({
      delivery_id:id,retryReceiptId:7022,independentlyObserved:true});
    expect(JSON.stringify({journal,body})).not.toMatch(/hidden|k=secret|never-echo|api_key|sensitive|set-cookie|https:\/\//);
    const again=await run(w,{deliveryId:id,confirm:true});
    expect(again.body.status).toBe('replayed');
    expect(writes(w.gh)).toHaveLength(1);
  });
  it('returns unconfirmed on 202 without a distinct new provider receipt',async()=>{
    const w=await makeWorld({profile:'full',mode:'production',externalRoutes:routes});
    arrange(w.gh,'mismatch');await prepare(w);
    const {body}=await run(w,{deliveryId:id,confirm:true});
    expect(body).toMatchObject({done:false,status:'unconfirmed',confirmed:false});
    expect(writes(w.gh)).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('never-echo');
    const again=await run(w,{deliveryId:id,confirm:true});
    expect(again.body.status).not.toBe('applied');
    expect(writes(w.gh)).toHaveLength(1);
  });
  it('refuses a foreign installation before sending the retry or revealing webhook request/response',async()=>{
    const w=await makeWorld({profile:'full',mode:'production',externalRoutes:routes});
    arrange(w.gh);await prepare(w);
    w.gh.when(R.one).reply(200,{...first,installation_id:999});
    const {body}=await run(w,{deliveryId:id,confirm:true});
    expect(body.status).not.toBe('applied');
    expect(writes(w.gh)).toHaveLength(0);
    expect(JSON.stringify(body)).not.toMatch(/never-echo|private|hidden/);
  });
  it('refuses external pass and non-owner App before send',async()=>{
    const w=await makeWorld({profile:'full',mode:'production',externalRoutes:routes});
    arrange(w.gh);await prepare(w);
    let out=await run({...w,connection:{...w.connection,pass:true}},
      {deliveryId:id,confirm:true});
    expect(out.body.status).not.toBe('applied');
    expect(w.gh.calls).toHaveLength(0);
    w.gh.when(R.app).reply(200,{...app,owner:{id:999,login:'other-org'}});
    out=await run(w,{deliveryId:id,confirm:true});
    expect(out.body.status).not.toBe('applied');
    expect(writes(w.gh)).toHaveLength(0);
  });
});
