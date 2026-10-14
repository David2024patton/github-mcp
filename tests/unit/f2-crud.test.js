import {describe,expect,it} from 'vitest';
import {runWriteContract,makeWorld,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import * as labels from '../../src/tools/labels.js';
import * as milestones from '../../src/tools/milestones.js';
const def=(module,name)=>({tool:module.tools.find(t=>t.name===name),handler:module.handlers[name]});
const L='GET /repos/{owner}/{repo}/labels/{name}';
const ML='GET /repos/{owner}/{repo}/milestones/{milestone_number}';
const lb=(extra={})=>({id:42,name:'bug',color:'d73a4a',description:'Bug',...extra});
const ms=(extra={})=>({id:72,number:8,title:'First',description:'One',state:'open',due_on:null,open_issues:2,closed_issues:1,...extra});
const seq=(gh,path,states)=>gh.when(path).replySequence(states.map(([status,body])=>({status,body})));
runWriteContract({label:'github_label_save create',definition:def(labels,'github_label_save'),
  args:{repo:'hello',name:'bug',color:'d73a4a',description:'Bug'},needsConfirm:false,
  arrange(gh,outcome){
    seq(gh,L,[[404,{message:'Not Found'}],[200,lb(outcome==='ok'?{}:{color:'ffffff'})]]);
    gh.when('POST /repos/{owner}/{repo}/labels').reply(201,lb());
  }
});
runWriteContract({label:'github_label_delete',definition:def(labels,'github_label_delete'),
  args:{repo:'hello',name:'bug'},needsConfirm:true,
  arrange(gh,outcome){
    seq(gh,L,[[200,lb()],[outcome==='ok'?404:200,outcome==='ok'?{message:'Not Found'}:lb()]]);
    gh.when('DELETE /repos/{owner}/{repo}/labels/{name}').reply(204,null);
  }
});
runWriteContract({label:'github_milestone_save create',definition:def(milestones,'github_milestone_save'),
  args:{repo:'hello',title:'First',description:'One'},needsConfirm:false,
  arrange(gh,outcome){
    gh.when('POST /repos/{owner}/{repo}/milestones').reply(201,ms());
    gh.when(ML).reply(200,ms(outcome==='ok'?{}:{title:'Wrong'}));
  }
});
runWriteContract({label:'github_milestone_delete',definition:def(milestones,'github_milestone_delete'),
  args:{repo:'hello',number:8},needsConfirm:true,
  arrange(gh,outcome){
    seq(gh,ML,[[200,ms()],[outcome==='ok'?404:200,outcome==='ok'?{message:'Not Found'}:ms()]]);
    gh.when('DELETE /repos/{owner}/{repo}/milestones/{milestone_number}').reply(204,null);
  }
});
async function call(world,name,args){
  const dispatch=createDispatch({credentials:world.credentials,gates:[],fetch:world.gh.fetch,now:world.ctx.now,sleep:world.ctx.sleep});
  const x=await dispatch({registry,name,args,connection:world.connection,db:world.db});
  return x.structuredContent??parse(x);
}
const writes=gh=>gh.calls.filter(x=>!['GET','HEAD'].includes(x.method));
describe('F-2 semantics and safety',()=>{
  it('updates an exact existing label without creating a duplicate',async()=>{
    const w=await makeWorld();
    seq(w.gh,L,[[200,lb()],[200,lb({color:'abcdef'})]]);
    w.gh.when('PATCH /repos/{owner}/{repo}/labels/{name}').reply(200,lb({color:'abcdef'}));
    const r=await call(w,'github_label_save',{repo:'hello',name:'bug',color:'abcdef',confirm:true});
    expect(r).toMatchObject({done:true,status:'applied'});
    expect(writes(w.gh)).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
  it('rejects a colliding rename before any mutation',async()=>{
    const w=await makeWorld();
    w.gh.when(L).reply(200,lb());
    const r=await call(w,'github_label_save',{repo:'hello',name:'bug',newName:'other',confirm:true});
    expect(r.done).toBe(false);
    expect(writes(w.gh)).toEqual([]);
  });
  it('rejects a missing color and invalid hex on create',async()=>{
    const w=await makeWorld();
    w.gh.when(L).reply(404,{message:'Not Found'});
    expect((await call(w,'github_label_save',{repo:'hello',name:'new',description:'Only',confirm:true})).done).toBe(false);
    const dispatch=createDispatch({credentials:w.credentials,gates:[],fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep});
    const rejected=await dispatch({registry,name:'github_label_save',
      args:{repo:'hello',name:'new',color:'xyz',confirm:true},connection:w.connection,db:w.db});
    expect(rejected.isError).toBe(true);
    expect(rejected.content[0].text).toMatch(/color/i);
    expect(writes(w.gh)).toEqual([]);
  });
  it('updates a milestone by number and leaves fields omitted from the patch',async()=>{
    const w=await makeWorld();
    seq(w.gh,ML,[[200,ms()],[200,ms({state:'closed'})]]);
    w.gh.when('PATCH /repos/{owner}/{repo}/milestones/{milestone_number}').reply(200,ms({state:'closed'}));
    const r=await call(w,'github_milestone_save',{repo:'hello',number:8,state:'closed',confirm:true});
    expect(r).toMatchObject({status:'applied',done:true});
    const changed=w.gh.calls.find(c=>c.method==='PATCH');
    expect(changed.body).toEqual({state:'closed'});
    expect(w.gh.invalid).toEqual([]);
  });
  it('returns bounded full label and milestone listings',async()=>{
    const w=await makeWorld();
    w.gh.when('GET /repos/{owner}/{repo}/labels').reply(200,[lb()]);
    w.gh.when('GET /repos/{owner}/{repo}/milestones').reply(200,[ms()]);
    expect((await call(w,'github_label_list',{repo:'hello'})).items).toHaveLength(1);
    expect((await call(w,'github_milestone_list',{repo:'hello'})).items).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
});
