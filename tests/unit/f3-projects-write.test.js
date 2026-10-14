import {describe,it,expect} from 'vitest';
import {runWriteContract,makeWorld,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import * as projects from '../../src/tools/projects-write.js';
import {registry} from '../../src/tools/index.js';

const p={id:1,node_id:'PVT_TEST',number:9,title:'Roadmap'};
const source={id:55,number:7,title:'Work'};
const item=()=>({id:23,node_id:'PVTI_TEST',content:{id:55},fields:[]});
const def=n=>({tool:projects.tools.find(t=>t.name===n),handler:projects.handlers[n]});
const routes={
  project:'GET /orgs/{org}/projectsV2/{project_number}',
  source:'GET /repos/{owner}/{repo}/issues/{issue_number}',
  list:'GET /orgs/{org}/projectsV2/{project_number}/items',
  item:'GET /orgs/{org}/projectsV2/{project_number}/items/{item_id}',
  fields:'GET /orgs/{org}/projectsV2/{project_number}/fields',
  add:'POST /orgs/{org}/projectsV2/{project_number}/items',
  patch:'PATCH /orgs/{org}/projectsV2/{project_number}/items/{item_id}',
  del:'DELETE /orgs/{org}/projectsV2/{project_number}/items/{item_id}'
};
function arrange(gh,outcome,kind){
  let created=false,removed=false,updated=false;
  gh.when(routes.project).reply(200,p);
  gh.when(routes.source).reply(200,source);
  gh.when(routes.list).reply(200,[]);
  gh.when(routes.fields).reply(200,[{id:3,name:'Status',data_type:'text'}]);
  gh.when(routes.item).reply(200,()=>{
    if(kind==='remove'&&removed)return {status:404,body:{message:'Not Found'}};
    const v=item();
    if(kind==='set'&&updated)v.fields=[{id:3,value:outcome==='ok'?'Doing':'Wrong'}];
    if(kind==='add'&&created&&outcome!=='ok')v.content={id:999};
    return v;
  });
  gh.when(routes.add).reply(201,()=>{created=true;return {value:item()}});
  gh.when(routes.patch).reply(200,()=>{updated=true;return item()});
  gh.when(routes.del).reply(204,()=>{removed=true;return null});
}
runWriteContract({
  label:'github_project_set_item add',definition:def('github_project_set_item'),
  args:{number:9,action:'add',repo:'hello',issueNumber:7,contentType:'Issue'},
  needsConfirm:true,arrange:(gh,o)=>arrange(gh,o,'add')
});
runWriteContract({
  label:'github_project_set_item fields',definition:def('github_project_set_item'),
  args:{number:9,action:'set_fields',itemId:23,fields:[{id:3,value:'Doing'}]},
  needsConfirm:true,arrange:(gh,o)=>arrange(gh,o,'set')
});
runWriteContract({
  label:'github_project_remove_item',definition:def('github_project_remove_item'),
  args:{number:9,itemId:23},needsConfirm:true,arrange:(gh,o)=>arrange(gh,o,'remove')
});
async function call(w,name,args){
 const dispatch=createDispatch({credentials:w.credentials,fetch:w.gh.fetch,now:w.ctx.now,
   sleep:w.ctx.sleep,gates:[]});
 const x=await dispatch({registry,name,args,connection:w.connection,db:w.db});
 return x.structuredContent??parse(x);
}
describe('F-3 Projects v2 write isolation and readback',()=>{
  it('rejects duplicate project items before POST',async()=>{
    const w=await makeWorld();arrange(w.gh,'ok','add');
    w.gh.when(routes.list).reply(200,[item()]);
    const r=await call(w,'github_project_set_item',{
      number:9,action:'add',repo:'hello',issueNumber:7,contentType:'Issue',confirm:true});
    expect(r.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.route===routes.add)).toHaveLength(0);
  });
  it('refuses unknown project field IDs before PATCH',async()=>{
    const w=await makeWorld();arrange(w.gh,'ok','set');
    const r=await call(w,'github_project_set_item',{
      number:9,action:'set_fields',itemId:23,fields:[{id:999,value:'No'}],confirm:true});
    expect(r.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.route===routes.patch)).toHaveLength(0);
  });
  it('refuses unsupported user-owned project accounts without write',async()=>{
    const w=await makeWorld();arrange(w.gh,'ok','remove');
    const r=await call(w,'github_project_remove_item',{
      owner:'outside',number:9,itemId:23,confirm:true});
    expect(r.done).toBe(false);
    expect(w.gh.calls.filter(x=>x.route===routes.del)).toHaveLength(0);
  });
});
