import {describe,it,expect} from 'vitest';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';

const R={
  list:'GET /orgs/{org}/projectsV2',
  get:'GET /orgs/{org}/projectsV2/{project_number}',
  fields:'GET /orgs/{org}/projectsV2/{project_number}/fields',
  items:'GET /orgs/{org}/projectsV2/{project_number}/items'
};
const project={id:8,node_id:'PVT_test',number:9,title:'Roadmap',public:false,
  short_description:'Delivery',state:'open',items_count:1};
const item={id:12,node_id:'PVTI_test',type:'ISSUE',content:{
  type:'Issue',number:22,title:'Fix',html_url:'https://github.com/example-org/repo/issues/22'},
  field_values:[{id:'x',field:{id:44,name:'Status'},value:'In progress'}]};
async function call(w,name,args){
  const dispatch=createDispatch({credentials:w.credentials,fetch:w.gh.fetch,now:w.ctx.now,
    gates:[],sleep:w.ctx.sleep});
  const r=await dispatch({registry,name,args,connection:w.connection,db:w.db});
  return r.isError?r:r.structuredContent??parse(r);
}
const expectNoInvalid=w=>expect(w.gh.invalid).toEqual([]);
describe('F-3 Projects v2 native REST reads',()=>{
  it('lists organization projects with verified bounds and no mutations',async()=>{
    const w=await makeWorld();
    w.gh.when(R.list).reply(200,[project]);
    const r=await call(w,'github_project_list',{max:30});
    expect(r).toMatchObject({count:1,complete:true});
    expect(r.items[0]).toMatchObject({number:9,title:'Roadmap',public:false});
    expect(w.gh.calls.some(x=>x.route===R.list)).toBe(true);
    expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
    expectNoInvalid(w);
  });
  it('gets a project and enumerates bounded custom fields',async()=>{
    const w=await makeWorld();
    w.gh.when(R.get).reply(200,project);
    w.gh.when(R.fields).reply(200,[{id:10,name:'Status',data_type:'single_select',
      options:[{id:'a',name:{raw:'Doing'},color:'BLUE'}]}]);
    const r=await call(w,'github_project_get',{number:9});
    expect(r).toMatchObject({node_id:'PVT_test',fields:{count:1}});
    expect(r.fields.items[0].options[0].name).toBe('Doing');
    expectNoInvalid(w);
  });
  it('reads project items with exact project identity and bounded field values',async()=>{
    const w=await makeWorld();
    w.gh.when(R.get).reply(200,project);
    w.gh.when(R.items).reply(200,[item]);
    const r=await call(w,'github_project_list_items',{number:9,max:25});
    expect(r).toMatchObject({project_node_id:'PVT_test',count:1});
    expect(r.items[0]).toMatchObject({type:'ISSUE',content:{number:22},
      field_values:[{name:'Status',value:'In progress'}]});
    expectNoInvalid(w);
  });
  it('refuses a mismatched project before reading items',async()=>{
    const w=await makeWorld();
    w.gh.when(R.get).reply(200,{...project,number:999});
    const r=await call(w,'github_project_list_items',{number:9});
    expect(r.isError).toBe(true);
    expect(w.gh.calls.filter(x=>x.route===R.items)).toHaveLength(0);
  });
  it('refuses an unenrolled owner before any provider call',async()=>{
    const w=await makeWorld();
    const r=await call(w,'github_project_list',{owner:'foreign-org'});
    expect(r.isError).toBe(true);
    expect(w.gh.calls).toHaveLength(0);
  });
});
