import {describe,expect,it} from 'vitest';
import {runWriteContract,makeWorld,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import * as sync from '../../src/tools/labels-sync.js';
const def={tool:sync.tools[0],handler:sync.handlers.github_label_sync};
const route='GET /repos/{owner}/{repo}/labels';
const get='GET /repos/{owner}/{repo}/labels/{name}';
const post='POST /repos/{owner}/{repo}/labels';
const label={id:11,name:'bug',color:'d73a4a',description:'Something is broken'};
const args={sourceRepo:'source',targets:[{owner:'example-org',repo:'hello'}]};
function arrange(gh,outcome,defaults={}){
  const state={source:[label],hello:[],...defaults};
  gh.when(route).reply(200,q=>state[q.params.repo]??[]);
  gh.when(get).replySequence([
    {status:404,body:{message:'Not Found'}},
    {status:200,body:label}
  ]);
  gh.when(post).reply(201,q=>{
    if(outcome==='ok')state[q.params.repo]=[...state[q.params.repo]??[],label];
    return label;
  });
  return state;
}
runWriteContract({label:'github_label_sync source-to-target',definition:def,args,needsConfirm:true,
  arrange,expectedWrites:1,profile:'full'});

async function call(w,args){
  const dispatch=createDispatch({credentials:w.credentials,gates:w.ctx.gates,fetch:w.gh.fetch,now:w.ctx.now,sleep:w.ctx.sleep});
  const v=await dispatch({registry,name:'github_label_sync',args,connection:w.connection,db:w.db});
  return v.structuredContent??parse(v);
}
const writes=gh=>gh.calls.filter(c=>!['GET','HEAD'].includes(c.method));
describe('F-2 cross-account label reconciliation',()=>{
  it('plans cross-account mutations without modifying either repository',async()=>{
    const w=await makeWorld({accounts:['example-org','other-org'],profile:'full'});
    arrange(w.gh,'ok',{destination:[]});
    const result=await call(w,{sourceOwner:'example-org',sourceRepo:'source',
      targets:[{owner:'other-org',repo:'destination'}],dryRun:true});
    expect(result).toMatchObject({status:'preview',done:false});
    expect(result.preview).toContain('other-org/destination');
    expect(writes(w.gh)).toEqual([]);
  });
  it('performs a cross-account change through the per-destination guarded write',async()=>{
    const w=await makeWorld({accounts:['example-org','other-org'],profile:'full'});
    arrange(w.gh,'ok',{destination:[]});
    const result=await call(w,{sourceOwner:'example-org',sourceRepo:'source',
      targets:[{owner:'other-org',repo:'destination'}],confirm:true});
    expect(result).toMatchObject({status:'applied',done:true});
    expect(result.result.outcomes[0]).toMatchObject({owner:'other-org',repo:'destination',complete:true});
    expect(writes(w.gh)).toHaveLength(1);
    expect(writes(w.gh)[0].params.owner).toBe('other-org');
    expect(w.gh.invalid).toEqual([]);
  });
  it('leaves unrequested destination-only labels untouched',async()=>{
    const w=await makeWorld({profile:'full'});
    arrange(w.gh,'ok',{hello:[{id:20,name:'local',color:'123456',description:'Keep'}]});
    const result=await call(w,{...args,confirm:true});
    expect(result).toMatchObject({status:'applied'});
    expect(writes(w.gh).some(c=>c.method==='DELETE')).toBe(false);
  });
  it('will not delete without explicit deleteOthers and confirmation',async()=>{
    const w=await makeWorld({profile:'full'});
    arrange(w.gh,'ok',{hello:[{id:20,name:'local',color:'123456',description:'Keep'}]});
    const result=await call(w,{...args,deleteOthers:true});
    expect(result).toMatchObject({status:'needs_confirmation',done:false});
    expect(result.preview).toContain('DELETE local');
    expect(writes(w.gh)).toEqual([]);
  });
  it('rejects unconnected destination accounts before any write',async()=>{
    const w=await makeWorld({profile:'full'});
    arrange(w.gh,'ok');
    const result=await call(w,{...args,targets:[{owner:'foreign-org',repo:'hello'}],confirm:true});
    expect(result.done).toBe(false);
    expect(writes(w.gh)).toEqual([]);
  });
  it('rejects locked destinations and duplicate targets before any provider mutation',async()=>{
    const w=await makeWorld({accounts:['example-org','robinson-ai-systems'],profile:'full'});
    arrange(w.gh,'ok');
    const result=await call(w,{...args,targets:[{owner:'robinson-ai-systems',repo:'robinsons-toolkit-relay'}],confirm:true});
    expect(result.done).toBe(false);
    expect(writes(w.gh)).toEqual([]);
    const duplicate=await call(w,{...args,targets:[{owner:'example-org',repo:'hello'},{owner:'example-org',repo:'hello'}],dryRun:true});
    expect(duplicate.done).toBe(false);
    expect(writes(w.gh)).toEqual([]);
  });
  it('keeps partial or mismatched target results unconfirmed',async()=>{
    const w=await makeWorld({profile:'full'});
    arrange(w.gh,'mismatch');
    const result=await call(w,{...args,confirm:true});
    expect(result).toMatchObject({status:'unconfirmed',done:false});
    expect(result.result.failed).toBe(true);
    expect(result.result.outcomes[0].operations[0].confirmed).toBe(false);
    expect(writes(w.gh)).toHaveLength(1);
  });
});
