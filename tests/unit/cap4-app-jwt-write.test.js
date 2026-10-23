// CAP-4: GitHub App JWT webhook PATCH, through all guarded write doors.
// The fake provider returns a signing secret and URL metadata that must never
// be persisted, leaked or treated as a credential fallback.
import {describe,it,expect} from 'vitest';
import {makeWorld,parse,runWriteContract} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import {appWebhookSet} from '../../src/tools/app-jwt-write.js';

const R={
  app:'GET /app',read:'GET /app/hook/config',patch:'PATCH /app/hook/config'
};
const opts={externalRoutes:Object.values(R)};
const old='https://hooks.old.example/private/path';
const next='https://hooks.new.example/v2';
const args={url:next,contentType:'json'};
const fixture={
  id:901,slug:'example-owned-app',name:'Example',
  owner:{login:'example-org',id:1011}
};
function arrange(gh,result='ok'){
  let config={url:old,content_type:'form',insecure_ssl:'0',
    secret:'provider-secret-NEVERRETURN'};
  gh.when(R.app).reply(200,fixture);
  gh.when(R.read).reply(200,()=>config);
  gh.when(R.patch).reply(200,request=>{
    if(result==='ok')config={...config,...request.body};
    return config;
  });
}
async function prepare(w){
  await w.db.saveApp({id:901,slug:'example-owned-app',
    ownerLogin:'example-org',ownerType:'Organization',
    clientId:'app-client'});
  await w.db.upsertAccount({login:'example-org',accountId:1011,
    accountType:'Organization',label:'App Owner',
    credentialKind:'app',appId:901});
  w.credentials={...w.credentials,appJwt:async()=> 'synthetic.jwt.test-only'};
  w.ctx.credentials=w.credentials;
}
runWriteContract({label:'CAP-4 JWT owned webhook HTTPS configuration',
  definition:appWebhookSet,args,arrange,prepare,
  needsConfirm:true,production:true,profile:'full',externalRoutes:opts.externalRoutes,
  accessWidening:true,notifies:['hooks.new.example']
});
async function run(w,name,input={}){
  const r=await createDispatch({env:w.ctx.env,credentials:w.credentials,
    fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:[]})({
    registry,name,args:input,connection:w.connection,db:w.db});
  let body;
  try{body=parse(r)}catch{body={error:r.content?.[0]?.text}};
  return {r,body};
}
describe('CAP-4 exact App webhook change safety',()=>{
  it('sends one URL+content-only JWT PATCH and persists only URL digest/hostname',async()=>{
    const w=await makeWorld({mode:'production',profile:'full',...opts});
    arrange(w.gh);await prepare(w);
    const out=await run(w,'github_app_webhook_configuration_set',
      {...args,confirm:true});
    expect(out.body).toMatchObject({done:true,status:'applied',confirmed:true});
    const writes=w.gh.calls.filter(x=>x.method!=='GET');
    expect(writes).toHaveLength(1);
    expect(writes[0].route).toBe(R.patch);
    expect(writes[0].body).toEqual({url:next,content_type:'json'});
    const persisted=await w.db.getChange(out.body.logged.id);
    expect(persisted.before).toMatchObject({
      url_host:'hooks.old.example',content_type:'form',tls_verified:true});
    expect(persisted.after).toMatchObject({
      url_host:'hooks.new.example',content_type:'json',tls_verified:true});
    expect(persisted.before.url_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(persisted)).not.toMatch(/private\/path|provider-secret|https:\/\//);
    expect(JSON.stringify(out.body)).not.toMatch(/private\/path|provider-secret|https:\/\//);
    expect(w.gh.invalid).toEqual([]);
    expect(w.gh.unmatched).toEqual([]);
    expect(w.gh.calls.filter(x=>x.method==='PATCH').map(x=>x.path))
      .toEqual(['/app/hook/config']);
  });
  it('refuses unsafe URL or missing fields before provider calls',async()=>{
    const w=await makeWorld({mode:'production',profile:'full',...opts});
    arrange(w.gh);await prepare(w);
    for(const url of [
      'http://hooks.example.test/bad',
      'https://user:password@hooks.example.test/',
      'https://hooks.example.test/?secret=abc',
      'https://hooks.example.test/#frag'
    ]){
      const out=await run(w,'github_app_webhook_configuration_set',
        {url,confirm:true});
      expect(out.body.status).not.toBe('applied');
    }
    const empty=await run(w,'github_app_webhook_configuration_set',
      {confirm:true});
    expect(empty.body.status).not.toBe('applied');
    expect(w.gh.calls.every(c=>c.method==='GET')).toBe(true);
  });
  it('supports content-type-only change while preserving the full private original URL hash',async()=>{
    const w=await makeWorld({mode:'production',profile:'full',...opts});
    arrange(w.gh);await prepare(w);
    const out=await run(w,'github_app_webhook_configuration_set',
      {contentType:'json',confirm:true});
    expect(out.body.status).toBe('applied');
    const patch=w.gh.calls.find(x=>x.method==='PATCH');
    expect(patch.body).toEqual({content_type:'json'});
    expect(JSON.stringify(out.body)).not.toContain('private/path');
  });
  it('records a secondary-limit cooldown from a failed JWT mutation and sends nothing more',async()=>{
    const w=await makeWorld({profile:'full',mode:'production',...opts});
    await prepare(w);
    arrange(w.gh);
    w.gh.when(R.patch).reply(403,{message:'You have exceeded a secondary rate limit'},
      {'retry-after':'120'});
    const first=await run(w,'github_app_webhook_configuration_set',{...args,confirm:true});
    expect(first.r.isError||first.body.status!=='applied').toBe(true);
    const patches=()=>w.gh.calls.filter(c=>c.route===R.patch).length;
    expect(patches()).toBe(1);
    const second=await run(w,'github_app_webhook_configuration_set',{...args,confirm:true});
    expect(second.body.status).not.toBe('applied');
    expect(patches()).toBe(1);
  });
  it('rejects wrong App owner before JWT webhook mutation',async()=>{
    const w=await makeWorld({mode:'production',profile:'full',...opts});
    arrange(w.gh);await prepare(w);
    w.gh.when(R.app).reply(200,{...fixture,owner:{id:999,login:'foreign'}});
    const out=await run(w,'github_app_webhook_configuration_set',
      {...args,confirm:true});
    expect(out.body.status).not.toBe('applied');
    expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
  });
});
