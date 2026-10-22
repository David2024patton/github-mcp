import {describe,it,expect} from 'vitest';
import {makeWorld,parse,runWriteContract} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import {samlRevoke} from '../../src/tools/org-saml-authorizations.js';

const R={
  list:'GET /orgs/{org}/credential-authorizations',
  remove:'DELETE /orgs/{org}/credential-authorizations/{credential_id}'
};
const routes=Object.values(R);
const alice={credential_id:24680,login:'alice',credential_type:'OAuth app token',
  credential_authorized_at:'2026-10-20T10:00:00Z',
  token_last_eight:'PASSWORD',fingerprint:'private-ssh-fingerprint',
  scopes:['repo'],authorized_credential_title:'private key',secret:'never'};
const bob={...alice,credential_id:24681,login:'bob'};
const createWorld=opts=>makeWorld({profile:'full',externalRoutes:routes,...opts});
const writes=w=>w.gh.calls.filter(x=>x.method!=='GET');

function arrange(gh,mode='ok'){
  let active=true;
  gh.when(R.list).reply(200,req=>{
    const filter=req.query.login;
    const items=active?[alice]:[];
    return items.filter(x=>!filter||x.login===filter);
  });
  gh.when(R.remove).reply(204,()=>{
    if(mode==='ok')active=false;
    return null;
  });
}
async function run(w,name,args={}){
  const result=await createDispatch({env:w.ctx.env,credentials:w.credentials,
    fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep,gates:[]})({
    registry,name,args,connection:w.connection,db:w.db});
  let body;
  try{body=parse(result)}catch{body={error:result.content?.[0]?.text}};
  return {result,body};
}

runWriteContract({label:'CAP-4 SAML exact credential revocation',
  definition:samlRevoke,args:{credentialId:24680,login:'alice'},
  arrange,needsConfirm:true,production:true,profile:'full',
  externalRoutes:routes});

describe('CAP-4 SAML authorization inventory and revocation shapes',()=>{
  it('returns one bounded projected page, never provider token suffix, fingerprint or scopes',async()=>{
    const w=await createWorld({profile:'read_only'});
    w.gh.when(R.list).reply(200,[alice]);
    const {result,body}=await run(w,'github_org_saml_authorizations',{
      owner:'example-org',login:'alice',max:5,page:2});
    expect(result.isError).not.toBe(true);
    expect(body.authorizations).toHaveLength(1);
    expect(body.authorizations[0]).toMatchObject({
      org:'example-org',credential_id:24680,login:'alice',
      credential_type:'OAuth app token',
      credential_authorized_at:'2026-10-20T10:00:00Z'});
    expect(Object.keys(body.authorizations[0]).sort()).toEqual([
      'credential_authorized_at','credential_authorized_at_local',
      'credential_id','credential_type','login','org']);
    expect(JSON.stringify(body)).not.toMatch(/PASSWORD|private-ssh-fingerprint|private key|scopes/);
    expect(w.gh.calls).toHaveLength(1);
    expect(w.gh.calls[0].route).toBe(R.list);
    expect(w.gh.calls[0].path).toBe('/orgs/example-org/credential-authorizations');
    expect(w.gh.calls[0].query).toMatchObject({
      per_page:'5',page:'2',login:'alice'});
    expect(w.gh.invalid).toEqual([]);
  });
  it('accurately marks a full page incomplete and offers provider next page',async()=>{
    const w=await createWorld({profile:'read_only'});
    w.gh.when(R.list).reply(200,[alice],{
      link:'<https://api.github.com/orgs/example-org/credential-authorizations?page=2>; rel="next"'});
    const {body}=await run(w,'github_org_saml_authorizations',{max:1});
    expect(body).toMatchObject({complete:false,nextPage:2,shown:1});
    expect(JSON.stringify(body)).not.toContain('https://api.github.com');
  });
  it('refuses unexpected member, duplicate IDs or private provider object fields',async()=>{
    for(const page of [[bob],[alice,alice],
      [{...alice,credential_type:{token:'unexpected'}}]]){
      const w=await createWorld({profile:'read_only'});
      w.gh.when(R.list).reply(200,page);
      const {result}=await run(w,'github_org_saml_authorizations',{
        login:'alice',max:3});
      expect(result.isError).toBe(true);
      expect(writes(w)).toHaveLength(0);
    }
  });
  it('applies exact DELETE with journal metadata minimized and readback confirmed',async()=>{
    const w=await createWorld({mode:'production'});arrange(w.gh);
    const {body}=await run(w,'github_org_saml_revoke_authorization',{
      credentialId:24680,login:'alice',confirm:true});
    expect(body).toMatchObject({status:'applied',confirmed:true});
    expect(writes(w)).toHaveLength(1);
    expect(writes(w)[0].route).toBe(R.remove);
    expect(writes(w)[0].path).toBe(
      '/orgs/example-org/credential-authorizations/24680');
    const history=await w.db.getChange(body.logged.id);
    expect(JSON.stringify(history)).not.toMatch(/PASSWORD|private-ssh-fingerprint|private key|scopes/);
    expect(history.before).toMatchObject({credential_id:24680,login:'alice'});
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses incomplete provider pagination before write',async()=>{
    const w=await createWorld({mode:'production'});
    w.gh.when(R.list).reply(200,Array.from({length:100},(_,i)=>({
      ...alice,credential_id:i+1})),{
      link:'<https://api.github.com/orgs/example-org/credential-authorizations?page=2>; rel="next"'});
    const {body}=await run(w,'github_org_saml_revoke_authorization',{
      credentialId:24680,login:'alice',confirm:true});
    expect(body.status).not.toBe('applied');
    expect(writes(w)).toHaveLength(0);
  });
  it('denies foreign org and revoked read grant before provider effect',async()=>{
    const w=await createWorld({mode:'production'});
    const foreign=await run(w,'github_org_saml_revoke_authorization',{
      credentialId:24680,login:'alice',owner:'foreign-org',confirm:true});
    expect(foreign.body.status).not.toBe('applied');
    expect(w.gh.calls).toHaveLength(0);
    w.gh.when(R.list).reply(403,{
      message:'Resource not accessible by integration'});
    const denied=await run(w,'github_org_saml_revoke_authorization',{
      credentialId:24680,login:'alice',confirm:true});
    expect(denied.body.status).not.toBe('applied');
    expect(writes(w)).toHaveLength(0);
    expect(JSON.stringify(denied.body)).not.toMatch(/not_available_on_plan/);
  });
});
