// U-1: deterministic real pinned-schema request sample. Every request reaches the
// validating fake via the production client, without external GitHub credentials.
import {describe,it,expect} from 'vitest';
import {githubFor} from '../../src/github/client.js';
import {restOperations,restParameters,validateRest} from '../../src/github/openapi-index.js';
import {makeFakeGitHub} from '../../test/helpers/fake-github.js';
import {createFakeDb} from '../../test/helpers/fake-db.js';

const p={owner:'example-org',repo:'hello'};
const eligible=op=>{
  const required=restParameters(op).filter(x=>x.required);
  return op.path.includes('/repos/{owner}/{repo}') &&
    required.every(x=>x.in==='path'&&['owner','repo'].includes(x.name)) &&
    !op.operation.requestBody?.required;
};
async function client(){
  const gh=makeFakeGitHub(),db=createFakeDb();
  await db.initSchema();
  const ctx={db,connection:{client_id:'shape-fixture',default_account:p.owner,accounts:[p.owner],
    mode:'preview',profile:'full'},
    fetch:gh.fetch,now:()=>Date.UTC(2026,9,10,18),sleep:async()=>{},
    credentials:{token:async()=> 'ghs_FAKEinstallationtoken'},retryAfterBaseValue:1};
  return {gh,octokit:await githubFor(ctx,{owner:p.owner})};
}
describe('U-1 pinned GitHub request shape sample',()=>{
  it('25 different described GET routes survive actual Octokit and fake schema validation',async()=>{
    const ops=restOperations().filter(op=>op.method==='GET'&&eligible(op)).slice(0,25);
    expect(ops).toHaveLength(25);
    const {gh,octokit}=await client();
    for(const op of ops){
      const params={...p};
      validateRest(op,params);
      gh.when(op.route).reply(200,{});
      await octokit.request(op.route,params);
    }
    expect(gh.invalid).toEqual([]);
    expect(new Set(gh.calls.map(x=>x.route)).size).toBe(25);
  });
  it('10 distinct writes (9 DELETE and 1 PUT) pass real-client schema validation',async()=>{
    const deletes=restOperations().filter(op=>op.method==='DELETE'&&eligible(op)).slice(0,9);
    expect(deletes).toHaveLength(9);
    const topic=restOperations().find(op=>op.route==='PUT /repos/{owner}/{repo}/topics');
    expect(topic).toBeDefined();
    const {gh,octokit}=await client();
    for(const op of [...deletes,topic]){
      const body=op===topic?{names:['universal']}:undefined;
      validateRest(op,p,body);
      gh.when(op.route).reply(op===topic?200:204,null);
      await octokit.request(op.route,{...p,...(body??{})});
    }
    expect(gh.invalid).toEqual([]);
    expect(new Set(gh.calls.map(x=>x.route)).size).toBe(10);
  });
});
