// CAP-4: the GitHub App JWT (not user U / installation I) owns these
// permission and request endpoints. Synthetic provider fixtures never issue
// a real GitHub write, grant, token or installation request.
import {describe,it,expect} from 'vitest';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';

const R={
  app:'GET /app',
  one:'GET /app/installations/{installation_id}',
  requests:'GET /app/installation-requests'
};
const routes=Object.values(R);
const app={id:901,slug:'owner-app',name:'Owner App',
  owner:{login:'example-org',id:1011}};
const permissions={metadata:'read',issues:'write'};
const baseInstallation={
  id:902,app_id:901,account:{login:'example-org',id:1011,
    authorization:'a different tenant secret'},
  target_id:1011,target_type:'Organization',
  permissions,events:['issues','push'],repository_selection:'selected',
  suspended_at:null,
  access_tokens_url:'https://api.github.com/secret-token-request',
  private_details:{key:'NEVER-ECHO'}
};
const request=(id,account='example-org',accountId=1011)=>({
  id,account:{id:accountId,login:account,
    private_metadata:'DO-NOT-RETURN'},
  requester:{id:918,login:'someone',email:'PRIVATE@EXAMPLE',
    token:'a-private-request-token'},
  created_at:'2026-10-22T10:00:00Z',
  secret:'DO-NOT-RETURN'
});
async function world(){
  const w=await makeWorld({profile:'read_only',externalRoutes:routes});
  await w.db.saveApp({id:901,slug:'owner-app',
    ownerLogin:'example-org',ownerType:'Organization',clientId:'fake'});
  await w.db.upsertAccount({login:'example-org',accountId:1011,
    accountType:'Organization',credentialKind:'app',appId:901,
    label:'Owner'});
  await w.db.setInstallation('example-org',{installationId:902,
    repositorySelection:'selected',permissions:{...permissions},status:'active'});
  const issued=[];
  w.credentials={...w.credentials,appJwt:async id=>{
    issued.push(id);return 'synthetic.jwt.only';
  }};
  w.gh.when(R.app).reply(200,app);
  return {...w,issued};
}
async function call(w,name,args={}){
  const r=await createDispatch({env:w.ctx.env,
    fetch:w.gh.fetch,credentials:w.credentials,
    now:w.ctx.now,sleep:w.ctx.sleep,gates:[]})({
    registry,name,args,connection:w.connection,db:w.db});
  let data;
  try{data=parse(r)}catch{data={error:r.content?.[0]?.text}};
  return {r,data};
}
describe('CAP-4 App owner JWT installation grants and requests',()=>{
  it('verifies one exact enrolled installation and projects permission/event metadata',async()=>{
    const w=await world();
    w.gh.when(R.one).reply(200,baseInstallation);
    const {r,data}=await call(w,'github_app_owner_installation_grants');
    expect(r.isError).not.toBe(true);
    expect(data).toMatchObject({
      org:'example-org',app_id:901,installation_id:902,
      permissions:{issues:'write',metadata:'read'},events:['issues','push'],
      repository_selection:'selected',cached_permissions_match:true});
    expect(Object.keys(data.permissions).sort()).toEqual(['issues','metadata']);
    expect(JSON.stringify(data)).not.toMatch(/NEVER-ECHO|private_details|authorization|secret-token-request/);
    expect(w.issued).toEqual([901]);
    expect(w.gh.calls.map(x=>x.route)).toEqual([R.app,R.one]);
    expect(w.gh.calls[1].path).toBe('/app/installations/902');
    expect(w.gh.invalid).toEqual([]);
    expect(w.gh.unmatched).toEqual([]);
  });
  it('does not accept the same installation ID for a foreign account, owner number or App',async()=>{
    for(const changed of [
      {account:{login:'foreign-org',id:999}},
      {account:{login:'example-org',id:888}},
      {target_id:999},
      {target_type:'User'},
      {app_id:999}
    ]){
      const w=await world();
      w.gh.when(R.one).reply(200,{...baseInstallation,...changed});
      const out=await call(w,'github_app_owner_installation_grants');
      expect(out.r.isError).toBe(true);
      expect(JSON.stringify(out.data)).not.toContain('NEVER-ECHO');
      expect(w.gh.calls.every(c=>c.method==='GET')).toBe(true);
    }
  });
  it('refuses unbounded or nested permissions and event metadata',async()=>{
    for(const edited of [
      {permissions:{issues:{secret:'NEVER-ECHO'}}},
      {permissions:Object.fromEntries(Array.from({length:65},
        (_,i)=>['fake_'+i,'read']))},
      {events:['issues','issues']},
      {events:Array.from({length:101},(_,i)=>'event_'+i)}
    ]){
      const w=await world();
      w.gh.when(R.one).reply(200,{...baseInstallation,...edited});
      const out=await call(w,'github_app_owner_installation_grants');
      expect(out.r.isError).toBe(true);
      expect(JSON.stringify(out.data)).not.toContain('NEVER-ECHO');
    }
  });
  it('filters App-global installation requests to the exact enrolled account',async()=>{
    const w=await world();
    w.gh.when(R.requests).reply(200,[
      request(88,'foreign-org',999),
      request(89),
      request(90,'example-org',888)
    ]);
    const out=await call(w,'github_app_owner_installation_requests',
      {max:4,page:2});
    expect(out.r.isError).not.toBe(true);
    expect(out.data).toMatchObject({
      org:'example-org',app_id:901,page:2,shown:1,complete:true,
      requests:[{id:89,requester_login:'someone',
        created_at:'2026-10-22T10:00:00Z'}]});
    expect(JSON.stringify(out.data)).not.toMatch(/88|90|foreign-org|DO-NOT-RETURN|PRIVATE@EXAMPLE|a-private-request-token/);
    expect(w.gh.calls.map(x=>x.route)).toEqual([R.app,R.requests]);
    expect(w.gh.calls[1].query).toMatchObject({per_page:'4',page:'2'});
    expect(w.gh.invalid).toEqual([]);
  });
  it('never reports App-global inventory complete after a full provider page',async()=>{
    const w=await world();
    w.gh.when(R.requests).reply(200,[request(89)]);
    const {data}=await call(w,'github_app_owner_installation_requests',
      {max:1});
    expect(data.complete).toBe(false);
    expect(data.next_page_possible).toBe(2);
  });
  it('rejects malformed exact-account request identities without displaying them',async()=>{
    const w=await world();
    w.gh.when(R.requests).reply(200,[{...request(89),requester:{
      login:'someone',id:null,token:'PRIVATE'}}]);
    const r=await call(w,'github_app_owner_installation_requests');
    expect(r.r.isError).toBe(true);
    expect(JSON.stringify(r.data)).not.toContain('PRIVATE');
  });
  it('refuses delegated service passes and foreign owner before JWT or metadata access',async()=>{
    const w=await world();
    let r=await call({...w,connection:{...w.connection,pass:true}},
      'github_app_owner_installation_requests');
    expect(r.r.isError).toBe(true);
    r=await call(w,'github_app_owner_installation_grants',{owner:'other'});
    expect(r.r.isError).toBe(true);
    expect(w.issued).toHaveLength(0);
    expect(w.gh.calls).toHaveLength(0);
  });
});
