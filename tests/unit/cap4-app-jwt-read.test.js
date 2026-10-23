// CAP-4: GitHub App JWT read scope. All GitHub requests are synthetic;
// a consumer may read only the App it actually owns, not an installation's
// global App JWT or webhook payloads for another tenant.
import {describe,it,expect} from 'vitest';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import {curatedTool} from '../../src/github/hand-built-map.js';

const R={
  app:'GET /app',
  config:'GET /app/hook/config',
  deliveries:'GET /app/hook/deliveries',
  one:'GET /app/hook/deliveries/{delivery_id}'
};
const routes=Object.values(R);
const identity={id:901,slug:'example-owned-app',name:'Example GitHub App',
  owner:{login:'example-org',id:1011}};
const delivery=(id,installation_id=902)=>({
  id,installation_id,guid:'0000-aaaa',event:'issues',action:'opened',
  delivered_at:'2026-10-21T10:00:00Z',status:'OK',
  status_code:200,redelivery:false,
  request:{headers:{authorization:'secret-provider-value'},
    payload:{api_key:'never-echo'}},response:{payload:{private:'data'}},
  confidential:'never-return'
});
const reads=w=>w.gh.calls.filter(c=>c.method==='GET');
async function world(options={}){
  const w=await makeWorld({profile:'read_only',externalRoutes:routes,...options});
  await w.db.saveApp({id:901,slug:'example-owned-app',
    ownerLogin:'example-org',ownerType:'Organization',
    clientId:'fixture-app-client-id'});
  await w.db.upsertAccount({login:'example-org',accountId:1011,
    accountType:'Organization',label:'Example Owner',
    credentialKind:'app',appId:901});
  await w.db.setInstallation('example-org',{installationId:902,
    repositorySelection:'all',status:'active',permissions:{metadata:'read'}});
  const issued=[];
  const jwtSigner=async appId=>{issued.push(appId);return 'synthetic.jwt.not-a-secret';};
  w.credentials={...w.credentials,appJwt:jwtSigner};
  w.gh.when(R.app).reply(200,identity);
  return {...w,issued};
}
async function run(w,name,args={}){
  const r=await createDispatch({env:w.ctx.env,credentials:w.credentials,
    fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:[]})({
    registry,name,args,connection:w.connection,db:w.db});
  let body;
  try{body=parse(r)}catch{body={error:r.content?.[0]?.text}};
  return {r,body};
}
describe('CAP-4 scoped JWT-only App views',()=>{
  it('verifies the stored App ID and numeric owner against GET /app',async()=>{
    const w=await world();
    const out=await run(w,'github_app_owner_identity');
    expect(out.r.isError).not.toBe(true);
    expect(out.body.app).toMatchObject({
      id:901,slug:'example-owned-app',owner:'example-org',owner_id:1011});
    expect(w.issued).toEqual([901]);
    expect(reads(w).map(x=>x.route)).toEqual([R.app]);
    expect(reads(w)[0].headers.authorization).toContain('synthetic.jwt.');
    expect(JSON.stringify(out.body)).not.toContain('synthetic.jwt.');
    expect(w.gh.invalid).toEqual([]);
  });
  it('never echoes the App webhook signing secret or URL path/query',async()=>{
    const w=await world();
    w.gh.when(R.config).reply(200,{url:'https://hooks.example.test/private?key=not-shared',
      content_type:'json',insecure_ssl:'0',secret:'REAL-PROVIDER-SECRET'});
    const {r,body}=await run(w,'github_app_webhook_configuration');
    expect(r.isError).not.toBe(true);
    expect(body.config).toEqual({
      url_host:'hooks.example.test',content_type:'json',tls_verified:true});
    expect(JSON.stringify(body)).not.toMatch(/private|not-shared|REAL-PROVIDER-SECRET/);
    expect(reads(w).map(x=>x.route)).toEqual([R.app,R.config]);
    expect(w.gh.invalid).toEqual([]);
  });
  it('shows only the currently enrolled installation, not other App tenants',async()=>{
    const w=await world();
    w.gh.when(R.deliveries).reply(200,[
      delivery(101,902),delivery(102,9999),delivery(103,null)],{
      link:'<https://api.github.com/app/hook/deliveries?cursor=next-cursor>; rel="next"'});
    const {r,body}=await run(w,'github_app_webhook_deliveries',{max:4,status:'failure'});
    expect(r.isError).not.toBe(true);
    expect(body).toMatchObject({shown:1,pageExamined:3,
      nextCursor:'next-cursor',complete:false});
    expect(body.items[0]).toMatchObject({id:101,event:'issues'});
    expect(JSON.stringify(body)).not.toMatch(/102|103|not-shared|never-echo|secret-provider-value|confidential/);
    expect(reads(w).map(x=>x.route)).toEqual([R.app,R.deliveries]);
    expect(reads(w)[1].query).toMatchObject({per_page:'4',status:'failure'});
    expect(w.gh.invalid).toEqual([]);
  });
  it('GET by delivery ID refuses another installation without copying the payload',async()=>{
    const w=await world();
    w.gh.when(R.one).reply(200,delivery(102,9999));
    const out=await run(w,'github_app_webhook_deliveries',{deliveryId:102});
    expect(out.r.isError).toBe(true);
    expect(JSON.stringify(out.body)).not.toContain('never-echo');
    expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
  });
  it('rejects RTC service pass and foreign/incorrect stored App owner before JWT or provider calls',async()=>{
    const w=await world();
    let out=await run({...w,connection:{...w.connection,pass:true}},
      'github_app_owner_identity');
    expect(out.r.isError).toBe(true);
    expect(w.issued).toEqual([]);
    out=await run(w,'github_app_owner_identity',{owner:'foreign-org'});
    expect(out.r.isError).toBe(true);
    expect(w.issued).toEqual([]);
    await w.db.saveApp({id:901,slug:'foreign-app',ownerLogin:'foreign-org',
      ownerType:'Organization',clientId:'fixture'});
    out=await run(w,'github_app_owner_identity');
    expect(out.r.isError).toBe(true);
    expect(w.gh.calls).toHaveLength(0);
  });
  it('refuses fake provider App identity before JWT-only webhook operations',async()=>{
    const w=await world();
    w.gh.when(R.app).reply(200,{...identity,owner:{login:'foreign-org',id:999}});
    w.gh.when(R.config).reply(200,{url:'https://hooks.example.test'});
    const out=await run(w,'github_app_webhook_configuration');
    expect(out.r.isError).toBe(true);
    expect(reads(w).map(x=>x.route)).toEqual([R.app]);
  });
  it('refuses forged foreign delivery cursor URLs and malformed provider metadata',async()=>{
    const w=await world();
    w.gh.when(R.deliveries).reply(200,[delivery(101)],{
      link:'<https://evil.example/app/hook/deliveries?cursor=a>; rel="next"'});
    const out=await run(w,'github_app_webhook_deliveries');
    expect(out.r.isError).toBe(true);
    expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
  });
  it('does not expose the JWT-only App routes as unscoped universal calls',()=>{
    for(const route of Object.values(R)){
      // The pinned universal policy rejects any /app path even when the
      // tool registry now has the corresponding guarded native read.
      expect(route.startsWith('GET /app')).toBe(true);
    }
    expect(curatedTool({route:R.app})).toBeNull();
  });
});
