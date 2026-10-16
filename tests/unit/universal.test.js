import {describe,it,expect} from 'vitest';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import {restOperations,restOperation,validateRest} from '../../src/github/openapi-index.js';
import {classifyUniversal,assertUniversalAuthority,universalPrice} from '../../src/github/operation-classes.js';
import {curatedTool} from '../../src/github/hand-built-map.js';
import * as u from '../../src/tools/universal.js';
import {makeWorld,parse,runWriteContract} from '../../test/helpers/write-contract.js';

const api=(operation,params={},body)=>({operation,params,...(body?{body}:{})});
const route='PUT /repos/{owner}/{repo}/interaction-limits';
const scope={owner:'example-org',repo:'hello'};
const payload={limit:'collaborators_only',expiry:'one_day'};
async function dispatch(world,name,args) {
  return createDispatch({credentials:world.credentials,fetch:world.gh.fetch,gates:world.ctx.gates,
    now:world.ctx.now,sleep:world.ctx.sleep})
    .call(null,{registry,name,args,connection:world.connection,db:world.db});
}
function setRead(world,route,body) { world.gh.when(route).reply(200,body); }
const noChange=(gh)=>gh.calls.every(c=>['GET','HEAD'].includes(c.method));

describe('U-1 pinned operation index and read boundary',()=>{
  it('indexes the 1232 official operations without changing the compact registry',()=>{
    const ops=restOperations();
    expect(ops).toHaveLength(1232);
    expect(ops.every(x=>x.category&&x.operationId)).toBe(true);
    expect(u.tools.map(x=>x.name)).toEqual(['github_api_search','github_api_describe','github_api_read','github_api_write']);
    for(const t of u.tools)expect(registry.tools.find(x=>x.name===t.name)).toBeTruthy();
    expect(u.tools[3].writeContract).toBe('defineWrite-v1');
    expect(u.tools[3].profiles).toEqual(['full']);
  });
  it('describes exact route, body and safety; searches safely without a provider credential',async()=>{
    const w=await makeWorld({profile:'read_only'});
    const search=parse(await dispatch(w,'github_api_search',{query:'interaction limit',max:20}));
    expect(search.count).toBeGreaterThan(0);
    const desc=parse(await dispatch(w,'github_api_describe',{operation:route}));
    expect(desc.safety.production).toBe(true);
    expect(desc.method).toBe('PUT');
    expect(desc.parameters).toEqual(expect.any(Array));
    expect(w.gh.calls).toEqual([]);
  });
  it('rejects unknown operation and misspelled path/query and JSON fields before a provider call',()=>{
    expect(()=>restOperation('GET /absolutely/not/real')).toThrow(/not available/);
    const op=restOperation('POST /repos/{owner}/{repo}/issues');
    expect(()=>validateRest(op,{...scope,foo:'bar'},{title:'test'})).toThrow(/Unknown path/);
    expect(()=>validateRest(op,scope,{title:'test',not_a_real_field:true})).toThrow(/Unknown JSON body/);
    expect(()=>validateRest(op,scope,{})).toThrow(/Pinned GitHub/);
  });
  it('rejects bypass, credential-looking values, secrets, enterprise and curated merge',async()=>{
    const merge=restOperation('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge');
    expect(curatedTool(merge)).toBe('github_pr_merge');
    expect(()=>assertUniversalAuthority(merge,{...scope,bypass_rules:true},{})).toThrow(/Rule bypass/);
    expect(()=>assertUniversalAuthority(merge,scope,{key:'github_pat_ABC012345678901234567890'})).toThrow(/Credential/);
    const w=await makeWorld({mode:'production',profile:'full'});
    const refused=parse(await dispatch(w,'github_api_write',api(merge.route,{...scope,pull_number:7},{})));
    expect(refused.status).toBe('refused');
    expect(w.gh.calls).toEqual([]);
    expect(()=>universalPrice({method:'POST',path:'/orgs/{org}/copilot/billing/selected_users',summary:'Buy Copilot seats'})).toThrow(/Cost/);
    expect(classifyUniversal({method:'POST',path:'/orgs/{org}/mystery',summary:'Unknown'}).accessWidening).toBe(true);
  });
  it('enforces connected scope and explicitly U credential for /user endpoints',async()=>{
    const w=await makeWorld({profile:'read_only'});
    const foreign=await dispatch(w,'github_api_read',api('GET /repos/{owner}/{repo}',{owner:'outsider',repo:'hello'}));
    expect(foreign.isError).toBe(true);
    expect(w.gh.calls).toEqual([]);
    const personal=await dispatch(w,'github_api_read',api('GET /user',{}));
    expect(personal.isError).toBe(true);
    expect(w.gh.calls).toEqual([]);
  });
  it('uses pinned client, ordinary dispatcher shaping and safe per-connection pagination',async()=>{
    const w=await makeWorld({profile:'read_only'});
    setRead(w,'GET /repos/{owner}/{repo}',{full_name:'example-org/hello',description:'a repo'});
    const result=await dispatch(w,'github_api_read',api('GET /repos/{owner}/{repo}',scope));
    expect(result.isError).not.toBe(true);
    expect(parse(result).data.full_name).toBe('example-org/hello');
    expect(w.gh.calls[0].route).toBe('GET /repos/{owner}/{repo}');
    expect(w.gh.invalid).toEqual([]);
  });
});

runWriteContract({
  label:'universal interaction-limit write',definition:{tool:u.tools[3],handler:u.handlers.github_api_write},
  args:api(route,scope,payload),profile:'full',production:true,needsConfirm:true,accessWidening:true,
  arrange(gh,result){
    gh.when('GET /repos/{owner}/{repo}/interaction-limits').replySequence([
      {status:200,body:{limit:'existing',expiry:'one_day'}},
      {status:200,body:{limit:result==='ok'?'collaborators_only':'existing',expiry:'one_day'}}
    ]);
    gh.when(route).reply(200,{limit:'collaborators_only',expiry:'one_day'});
  }
});

describe('U-1 refusal and effect uncertainty',()=>{
  it('does not write on preview or when confirmation is absent',async()=>{
    const w=await makeWorld({profile:'full',mode:'preview'});
    setRead(w,'GET /repos/{owner}/{repo}/interaction-limits',{limit:'existing',expiry:'one_day'});
    const r=parse(await dispatch(w,'github_api_write',api(route,scope,payload)));
    expect(['refused_by_guard','needs_confirmation']).toContain(r.status);
    expect(noChange(w.gh)).toBe(true);
  });
  it('rejected exact-baseline reads do not create an authorization bypass',async()=>{
    const w=await makeWorld({profile:'full',mode:'production'});
    w.gh.when('GET /repos/{owner}/{repo}/interaction-limits').reply(403,{message:'Forbidden'});
    const r=parse(await dispatch(w,'github_api_write',{...api(route,scope,payload),confirm:true}));
    expect(r.status).not.toBe('applied');
    expect(noChange(w.gh)).toBe(true);
  });
  it('same-key retries do not resend after uncertain provider result',async()=>{
    const w=await makeWorld({profile:'full',mode:'production',advanceClockOnSleep:true});
    setRead(w,'GET /repos/{owner}/{repo}/interaction-limits',{limit:'existing',expiry:'one_day'});
    w.gh.when(route).reply(502,{message:'Temporarily unavailable'});
    const a=api(route,scope,payload);
    const r=parse(await dispatch(w,'github_api_write',{...a,confirm:true}));
    expect(r.status).not.toBe('applied');
    const second=parse(await dispatch(w,'github_api_write',{...a,confirm:true}));
    expect(second.status).toBe('replayed');
    expect(w.gh.calls.filter(c=>c.method==='PUT')).toHaveLength(1);
  });
});
