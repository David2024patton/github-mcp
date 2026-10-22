import {describe,it,expect} from 'vitest';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';

const R={
  audit:'GET /orgs/{org}/audit-log',
  scim:'GET /scim/v2/organizations/{org}/Users',
  one:'GET /scim/v2/organizations/{org}/Users/{scim_user_id}'
};
// These three routes are documented in current GitHub REST but are absent
// from our pinned 2026-03-10 OpenAPI snapshot. Test fixtures explicitly name
// them and assert method, path, query and safe result projection.
const newWorld=(opts={})=>makeWorld({externalRoutes:Object.values(R),...opts});
const id={id:'1234-abcd',userName:'alice@example.org',externalId:'external-1',
  active:true,emails:[{value:'secret@example.org'}],meta:{lastModified:'now',
    location:'https://private.example.org'}};
async function run(w,name,args={}) {
  const res=await createDispatch({env:w.ctx.env,credentials:w.credentials,
    gates:[],fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep})({
    registry,name,args,connection:w.connection,db:w.db});
  let body;try{body=res.structuredContent??parse(res)}catch{
    body={message:res.content?.[0]?.text}};
  return {res,body};
}
describe('CAP-4 organization audit and SCIM governed reads',()=>{
  it('reads a bounded organization audit page without leaking arbitrary event fields or writing',async()=>{
    const w=await newWorld({profile:'read_only'});
    w.gh.when(R.audit).reply(200,[{action:'org.update',actor:'alice',
      org:'example-org',_document_id:'evt1',private_token:'ghp_FAKEsecret'}]);
    const {body,res}=await run(w,'github_org_audit_read',{owner:'example-org',max:5});
    expect(res.isError).not.toBe(true);
    expect(body.events).toEqual([{action:'org.update',actor:'alice',
      org:'example-org',_document_id:'evt1'}]);
    expect(body.complete).toBe(true);
    expect(JSON.stringify(body)).not.toContain('ghp_FAKEsecret');
    expect(w.gh.calls.map(x=>x.route)).toEqual([R.audit]);
    expect(w.gh.calls[0].method).toBe('GET');
    expect(w.gh.calls[0].path).toBe('/orgs/example-org/audit-log');
    expect(w.gh.calls[0].query).toMatchObject({per_page:'5',include:'web',order:'desc'});
    expect(w.gh.invalid).toEqual([]);
  });
  it('rejects foreign audit identity, raw oversized result and incompatible cursors',async()=>{
    for(const events of [
      [{action:'org.update',org:'elsewhere'}],
      Array.from({length:101},()=>({action:'org.update',org:'example-org'}))
    ]){
      const w=await newWorld({profile:'read_only'});
      w.gh.when(R.audit).reply(200,events);
      const out=await run(w,'github_org_audit_read',{max:1});
      expect(out.res.isError).toBe(true);
    }
    const w=await newWorld({profile:'read_only'});
    const denied=await run(w,'github_org_audit_read',{after:'cursorA',before:'cursorB'});
    expect(denied.res.isError).toBe(true);
    expect(w.gh.calls).toHaveLength(0);
  });
  it('returns SCIM partial-page cursor without raw emails, secrets or provider links',async()=>{
    const w=await newWorld({profile:'read_only'});
    w.gh.when(R.scim).reply(200,{totalResults:2,startIndex:1,
      Resources:[id]});
    const {body,res}=await run(w,'github_org_scim_list',{max:1});
    expect(res.isError).not.toBe(true);
    expect(body).toMatchObject({shown:1,complete:false,nextStartIndex:2,
      identities:[{id:'1234-abcd',userName:'alice@example.org'}]});
    expect(JSON.stringify(body)).not.toMatch(/secret@example.org|location/);
    expect(w.gh.invalid).toEqual([]);
    expect(w.gh.calls.map(x=>x.route)).toEqual([R.scim]);
    expect(w.gh.calls[0].method).toBe('GET');
    expect(w.gh.calls[0].path).toBe('/scim/v2/organizations/example-org/Users');
    expect(w.gh.calls[0].query).toMatchObject({count:'1',startIndex:'1'});
    expect(w.gh.calls[0].headers.accept).toBe('application/scim+json');
  });
  it('checks exact SCIM subject for single-user read and rejects mismatches',async()=>{
    const w=await newWorld({profile:'read_only'});
    w.gh.when(R.one).reply(200,id);
    expect((await run(w,'github_org_scim_get',{scimUserId:'1234-abcd'}))
      .body.identity.id).toBe('1234-abcd');
    const wrong=await run(w,'github_org_scim_get',{scimUserId:'1234-abce'});
    expect(wrong.res.isError).toBe(true);
    expect(w.gh.calls.filter(c=>c.method!=='GET')).toHaveLength(0);
  });
  it('denies missing or foreign tenant/account before provider I/O',async()=>{
    const w=await newWorld({profile:'read_only'});
    const out=await run(w,'github_org_scim_list',{owner:'foreign-org'});
    expect(out.res.isError).toBe(true);
    expect(w.gh.calls).toHaveLength(0);
  });
  it('does not equate a GitHub 403/404 with missing SCIM plan support',async()=>{
    for(const [status,message] of [[403,'Resource not accessible by integration'],
      [404,'Not Found']]){
      const w=await newWorld({profile:'read_only'});
      w.gh.when(R.scim).reply(status,{message});
      const {res,body}=await run(w,'github_org_scim_list');
      expect(res.isError).toBe(true);
      expect(JSON.stringify(body)).not.toMatch(/not_available_on_plan|unsupported enterprise/i);
      expect(w.gh.invalid).toEqual([]);
    }
  });
});
