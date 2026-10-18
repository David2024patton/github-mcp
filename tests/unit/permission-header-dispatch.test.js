import {describe,it,expect} from 'vitest';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
const headers={'x-accepted-github-permissions':'allows_permissionless_access=true','x-github-request-id':'fixture-permissionless-request'};
const refusal={message:'Resource not accessible by integration'};
const call=(w,name,args)=>createDispatch({credentials:w.credentials,fetch:w.gh.fetch,gates:[],now:w.ctx.now,sleep:w.ctx.sleep})({registry,name,args,connection:w.connection,db:w.db});
const check=out=>{
  expect(out.isError).toBe(true);
  const text=out.content.filter(x=>x.type==='text').map(x=>x.text).join(' ');
  expect(text).toContain('integration credential');expect(text).toContain('HTTP 403');
  expect(text).toContain('fixture-permissionless-request');
  expect(text).not.toMatch(/allows permissionless access|add .*permission|organization packages/);
};
describe('honest permission headers through actual dispatch',()=>{
  it('preserves a real U provider refusal without a phantom grant or token fallback',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when('GET /user').reply(403,refusal,headers);
    const out=await call(w,'github_api_read',{operation:'GET /user',cred:'U'});check(out);
    expect(w.gh.calls).toHaveLength(1);expect(w.gh.calls[0].headers.authorization).toBe('token ghu_FAKE0123456789abcdefghij');
    expect(w.gh.invalid).toEqual([]);
  });
  it('keeps failed write preflight non-mutating and sanitized',async()=>{
    const w=await makeWorld({mode:'production',profile:'full'});
    w.gh.when('GET /orgs/{org}/actions/runner-groups/{runner_group_id}').reply(403,refusal,headers);
    const out=await call(w,'github_api_write',{operation:'DELETE /orgs/{org}/actions/runner-groups/{runner_group_id}',params:{org:'example-org',runner_group_id:1},confirm:true});check(out);
    expect(parse(out)).toMatchObject({done:false,status:'refused_by_guard',refusedBy:'read'});
    expect(w.gh.calls).toHaveLength(1);expect(w.gh.calls.every(x=>x.method==='GET')).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
});
