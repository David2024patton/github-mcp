import {describe,it,expect} from 'vitest';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import {makeWorld,parse} from '../../test/helpers/write-contract.js';

const owner='example-org',repo='hello';
async function run(w,name,args){
  return createDispatch({credentials:w.credentials,fetch:w.gh.fetch,now:w.ctx.now,gates:w.ctx.gates,sleep:w.ctx.sleep})
    .call(null,{registry,name,args,connection:w.connection,db:w.db});
}
describe('U-2 pinned GraphQL request shapes through actual scoped Octokit + fake',()=>{
  it('checks twelve independent schema-valid repository selections, aliases, arguments and nested connection pages',async()=>{
    const fields=[
      'id nameWithOwner',
      'isPrivate isArchived',
      'owner { login }',
      'defaultBranchRef { name }',
      'stargazerCount forkCount',
      'issues(first:2) { nodes { id title } }',
      'pullRequests(first:2) { nodes { id title } }',
      'labels(first:2) { nodes { id name } }',
      'milestones(first:2) { nodes { id title } }',
      'refs(refPrefix:"refs/heads/",first:2) { nodes { id name } }',
      'releases(first:2) { nodes { id name } }',
      'issues(first:2) { nodes { comments(first:2) { nodes { id } } } }'
    ];
    for(const field of fields){
      const w=await makeWorld({profile:'read_only'});
      w.gh.when('POST /graphql').reply(200,{data:{repository:{id:'R_1',nameWithOwner:owner+'/'+repo}}});
      const query='query Shape($owner:String!,$name:String!){alias:repository(owner:$owner,name:$name){'+field+'}}';
      const result=await run(w,'github_graphql_read',{query,variables:{owner,name:repo}});
      expect(result.isError,'GraphQL shape '+field+': '+JSON.stringify(result.structuredContent??result.content)).not.toBe(true);
      expect(parse(result).account).toBe(owner);
      expect(w.gh.calls.map(x=>x.route)).toEqual(['POST /graphql']);
      expect(w.gh.invalid).toEqual([]);
    }
  });
  it('refuses a GraphQL alias/fragment pointing to a foreign owner before dispatch',async()=>{
    const w=await makeWorld({profile:'read_only'});
    const q='query { ...Part } fragment Part on Query { alias:repository(owner:"foreign-org",name:"hello"){id} }';
    const result=await run(w,'github_graphql_read',{query:q});
    expect(result.isError).toBe(true);
    expect(w.gh.calls).toEqual([]);
  });
  it('refuses a raw opaque node read without a verified repo instead of trusting an arbitrary ID',async()=>{
    const w=await makeWorld({profile:'read_only'});
    const q='query Scope($id: ID!) { node(id:$id) { id } }';
    const result=await run(w,'github_graphql_read',{query:q,variables:{id:'PR_not_scoped'}});
    expect(result.isError).toBe(true);
    expect(w.gh.calls).toEqual([]);
  });
  it('does not permit unrestricted GraphQL search outside explicit repository scope',async()=>{
    const w=await makeWorld({profile:'read_only'});
    const q='query Search($text:String!){search(query:$text,type:ISSUE,first:10){nodes{... on Issue{id}}}}';
    const result=await run(w,'github_graphql_read',{query:q,variables:{text:'repo:foreign/repo bug'},repo});
    expect(result.isError).toBe(true);
    expect(w.gh.calls).toEqual([]);
  });
});
