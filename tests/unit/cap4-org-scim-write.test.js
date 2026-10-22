// CAP-4: exact provider shapes through the shared guarded write contract.
// Current GitHub SCIM routes are missing from the pinned OpenAPI snapshot;
// only these explicitly named routes bypass that fixture's outdated route list.
import {describe,it,expect} from 'vitest';
import {runWriteContract,makeWorld,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import * as writers from '../../src/tools/org-scim-write.js';

const R={
  list:'GET /scim/v2/organizations/{org}/Users',
  get:'GET /scim/v2/organizations/{org}/Users/{scim_user_id}',
  create:'POST /scim/v2/organizations/{org}/Users',
  patch:'PATCH /scim/v2/organizations/{org}/Users/{scim_user_id}',
  remove:'DELETE /scim/v2/organizations/{org}/Users/{scim_user_id}'
};
const externalRoutes=Object.values(R);
const USER='person@work.example';
const SCIM_ID='0000-test-scim';
const first={id:SCIM_ID,userName:USER,displayName:'Old Name',
  externalId:'identity-1',active:true,
  name:{givenName:'New',familyName:'Person'},
  emails:[{value:USER,primary:true},{value:'private@work.example'}],
  meta:{location:'https://private.example'}};
const def=name=>({tool:writers.tools.find(t=>t.name===name),handler:writers.handlers[name]});
const createArgs={userName:USER,primaryEmail:USER,givenName:'New',familyName:'Person',displayName:'New Person'};
const updateArgs={scimUserId:SCIM_ID,expectedUserName:USER,displayName:'New Name'};
const removeArgs={scimUserId:SCIM_ID,expectedUserName:USER};
const listOf=(person)=>({totalResults:person?1:0,startIndex:1,
  itemsPerPage:person?1:0,Resources:person?[person]:[]});
const readWrites=w=>w.gh.calls.filter(c=>['POST','PATCH','DELETE','PUT'].includes(c.method));
function arrangeCreate(gh,result){
  let person=null;
  gh.when(R.list).reply(200,()=>listOf(person));
  gh.when(R.create).reply(201,(req)=>{
    person={...first,displayName:result==='ok'?'New Person':'incorrect',
      userName:req.body.userName,emails:[{value:req.body.emails[0].value,primary:true},
        {value:'private@work.example'}]};
    return person;
  });
  gh.when(R.get).reply(200,()=>person);
}
function arrangeDisplay(gh,result){
  let person={...first};
  gh.when(R.get).reply(200,()=>person);
  gh.when(R.patch).reply(200,()=>{
    if(result==='ok')person={...person,displayName:'New Name'};
    return person;
  });
}
function arrangeDelete(gh,result){
  const removed=result==='ok';
  gh.when(R.get).replySequence([
    {status:200,body:{...first}},
    {status:removed?404:200,body:removed?{message:'Not Found'}:{...first}},
    {status:removed?404:200,body:removed?{message:'Not Found'}:{...first}}
  ]);
  gh.when(R.remove).reply(204,null);
  gh.when(R.list).reply(200,()=>listOf(removed?null:first));
}
for(const spec of [
  {name:'github_org_scim_provision',args:createArgs,arrange:arrangeCreate,
    accessWidening:true,notifies:[USER]},
  {name:'github_org_scim_set_display_name',args:updateArgs,arrange:arrangeDisplay},
  {name:'github_org_scim_deprovision',args:removeArgs,arrange:arrangeDelete}
]){
  runWriteContract({label:spec.name,definition:def(spec.name),
    args:spec.args,arrange:spec.arrange,needsConfirm:true,production:true,
    accessWidening:spec.accessWidening??false,notifies:spec.notifies??[],
    profile:'full',externalRoutes});
}
async function run(w,name,args={}){
  const result=await createDispatch({env:w.ctx.env,
    credentials:w.credentials,fetch:w.gh.fetch,now:w.ctx.now,
    sleep:w.ctx.sleep,gates:[]})({registry,name,args,
      connection:w.connection,db:w.db});
  let body;
  try{body=parse(result)}catch{
    body={status:result.isError?'refused':'unknown',
      error:result.content?.[0]?.text??'Malformed result'};
  }
  return {result,body};
}
describe('CAP-4 SCIM official request shape and negative authority',()=>{
  it('provisions only documented fields and requires independent exact identity',async()=>{
    const w=await makeWorld({profile:'full',mode:'production',externalRoutes});
    arrangeCreate(w.gh,'ok');
    const {body}=await run(w,'github_org_scim_provision',{
      ...createArgs,confirm:true});
    expect(body).toMatchObject({status:'applied',confirmed:true});
    const writes=readWrites(w);
    expect(writes).toHaveLength(1);
    const request=writes[0];
    expect(request.route).toBe(R.create);
    expect(request.path).toBe('/scim/v2/organizations/example-org/Users');
    expect(request.body).toMatchObject({
      userName:USER,displayName:'New Person',
      name:{givenName:'New',familyName:'Person'},
      emails:[{value:USER,primary:true}]});
    expect(Object.keys(request.body).sort()).toEqual(
      ['displayName','emails','name','userName']);
    expect(JSON.stringify(body)).not.toContain('private@work.example');
    expect(JSON.stringify(body)).not.toContain('https://private.example');
    expect(w.gh.invalid).toEqual([]);
  });
  it('supports provider SCIM username distinct from primary email without conflating identity',async()=>{
    const w=await makeWorld({profile:'full',mode:'production',externalRoutes});
    arrangeCreate(w.gh,'ok');
    const selected={...createArgs,userName:'scim.person-id',
      primaryEmail:'person+invite@work.example'};
    const {body}=await run(w,'github_org_scim_provision',
      {...selected,confirm:true});
    expect(body.status).toBe('applied');
    const sent=readWrites(w)[0].body;
    expect(sent.userName).toBe('scim.person-id');
    expect(sent.emails).toEqual([{value:'person+invite@work.example',primary:true}]);
    expect(w.gh.calls.filter(x=>x.route===R.list)[0].query.filter)
      .toBe('userName eq "scim.person-id"');
  });
  it('persists only projected SCIM fields in the change journal and replay',async()=>{
    const w=await makeWorld({profile:'full',mode:'production',externalRoutes});
    arrangeCreate(w.gh,'ok');
    const firstResult=await run(w,'github_org_scim_provision',{
      ...createArgs,confirm:true});
    expect(firstResult.body.status).toBe('applied');
    const persisted=await w.db.getChange(firstResult.body.logged.id);
    const recorded=JSON.stringify({before:persisted.before,after:persisted.after});
    expect(recorded).not.toMatch(/private@work\\.example|https:\\/\\/private\\.example/);
    expect(persisted.after).toMatchObject({
      id:SCIM_ID,userName:USER,primaryEmail:USER,
      givenName:'New',familyName:'Person'});
    expect(persisted.after.emails).toBeUndefined();
    const repeat=await run(w,'github_org_scim_provision',{
      ...createArgs,confirm:true});
    expect(repeat.body.status).toBe('replayed');
    expect(JSON.stringify(repeat.body)).not.toContain('private@work.example');
    expect(JSON.stringify(repeat.body)).not.toContain('https://private.example');
    expect(readWrites(w)).toHaveLength(1);
  });
  it('scoped PATCH only changes displayName; full PUT, active=false and arbitrary SCIM paths are unavailable',async()=>{
    const w=await makeWorld({profile:'full',mode:'production',externalRoutes});
    arrangeDisplay(w.gh,'ok');
    const {body}=await run(w,'github_org_scim_set_display_name',{
      ...updateArgs,confirm:true});
    expect(body.status).toBe('applied');
    const writes=readWrites(w);
    expect(writes.map(x=>x.route)).toEqual([R.patch]);
    expect(writes[0].body).toEqual({
      Operations:[{op:'replace',path:'displayName',value:'New Name'}]});
    expect(writes[0].headers.accept).toBe('application/scim+json');
    const forbidden=await run(w,'github_org_scim_set_display_name',{
      ...updateArgs,active:false,confirm:true});
    expect(forbidden.result.isError).toBe(true);
    expect(readWrites(w)).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
  it('delete verifies both identity gone and independently empty exact-name inventory',async()=>{
    const w=await makeWorld({profile:'full',mode:'production',externalRoutes});
    arrangeDelete(w.gh,'ok');
    const {body}=await run(w,'github_org_scim_deprovision',{
      ...removeArgs,confirm:true});
    expect(body).toMatchObject({status:'applied',confirmed:true});
    const writes=readWrites(w);
    expect(writes.map(x=>x.route)).toEqual([R.remove]);
    expect(w.gh.calls.filter(x=>x.route===R.list)[0].query.filter)
      .toBe('userName eq "'+USER+'"');
    expect(w.gh.invalid).toEqual([]);
  });
  it('rejects foreign organization before provider I/O and stale identity usernames without mutation',async()=>{
    const w=await makeWorld({profile:'full',mode:'production',externalRoutes});
    const foreign=await run(w,'github_org_scim_deprovision',{
      owner:'another-org',...removeArgs,confirm:true});
    expect(foreign.body.status).not.toBe('applied');
    expect(w.gh.calls).toHaveLength(0);
    arrangeDisplay(w.gh,'ok');
    const stale=await run(w,'github_org_scim_set_display_name',{
      ...updateArgs,expectedUserName:'other@work.example',confirm:true});
    expect(stale.body.status).not.toBe('applied');
    expect(readWrites(w)).toHaveLength(0);
  });
  it('refuses ambiguous SCIM inventory before provisioning and no token is exposed',async()=>{
    const w=await makeWorld({profile:'full',mode:'production',externalRoutes});
    w.gh.when(R.list).reply(200,{totalResults:2,startIndex:1,
      itemsPerPage:2,Resources:[first,{...first,id:'other-id'}]});
    const o=await run(w,'github_org_scim_provision',{...createArgs,confirm:true});
    expect(o.body.status).not.toBe('applied');
    expect(readWrites(w)).toHaveLength(0);
    expect(JSON.stringify(o.body)).not.toMatch(/ghp_FAKE|ghu_FAKE/);
  });
  it('denied provider permission never converts to plan-ineligibility or a successful write',async()=>{
    const w=await makeWorld({profile:'full',mode:'production',externalRoutes});
    w.gh.when(R.get).reply(403,{message:'Resource not accessible by integration'});
    const o=await run(w,'github_org_scim_deprovision',{...removeArgs,confirm:true});
    expect(o.body.status).not.toBe('applied');
    expect(JSON.stringify(o.body)).not.toMatch(/not_available_on_plan/);
    expect(readWrites(w)).toHaveLength(0);
  });
});
