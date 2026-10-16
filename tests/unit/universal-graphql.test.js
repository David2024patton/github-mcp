import {describe,it,expect} from 'vitest';
import {createDispatch} from '../../src/tools/dispatch.js';
import {registry} from '../../src/tools/index.js';
import * as g from '../../src/tools/universal-graphql.js';
import {inspectGraphql,githubGraphqlSchema} from '../../src/github/graphql-schema.js';
import {classifyGraphqlMutation} from '../../src/github/mutation-classes.js';
import {makeWorld,parse,runWriteContract} from '../../test/helpers/write-contract.js';

const query='query OwnerRepo($owner: String!, $name: String!) { repository(owner:$owner, name:$name) { nameWithOwner } }';
const queryArgs={query,variables:{owner:'example-org',name:'hello'}};
const doc='mutation UpdateDiscussion($input: UpdateDiscussionInput!) { updateDiscussion(input:$input) { discussion { id title } } }';
const changes={discussionId:'D_kgDO12345',title:'New approved title'};
const writeArgs={mutation:doc,variables:{input:changes},owner:'example-org',repo:'hello'};
const node=(title)=>({__typename:'Discussion',id:changes.discussionId,title,repository:{nameWithOwner:'example-org/hello'}});
const reply=(body)=>({status:200,body:{data:body}});
async function dispatch(w,name,args) {
  return createDispatch({credentials:w.credentials,fetch:w.gh.fetch,gates:w.ctx.gates,now:w.ctx.now,sleep:w.ctx.sleep})
    .call(null,{registry,name,args,connection:w.connection,db:w.db});
}
function stubMutation(gh,outcome) {
  gh.when('POST /graphql').replySequence([
    reply({node:node('Earlier title')}),
    reply({updateDiscussion:{discussion:{id:changes.discussionId,title:changes.title}}}),
    reply({node:node(outcome==='mismatch'?'Earlier title':changes.title)})
  ]);
}
describe('U-2 pinned GraphQL schema, AST and cost',()=>{
  it('registers exactly two connected tools with their original read/full-only contracts',()=>{
    expect(g.tools.map(x=>x.name)).toEqual(['github_graphql_read','github_graphql_write']);
    expect(g.tools[1].writeContract).toBe('defineWrite-v1');
    expect(g.tools[1].profiles).toEqual(['full']);
    for(const tool of g.tools)expect(registry.tools.find(x=>x.name===tool.name)).toBeTruthy();
    expect(githubGraphqlSchema().getMutationType().getFields().mergePullRequest).toBeTruthy();
    expect(inspectGraphql(g.SCOPE_QUERY,{id:'D_kgDO12345'},'query').operation.operation).toBe('query');
  });
  it('validates names, variables and parsed document using real pinned GraphQL schema',()=>{
    expect(inspectGraphql(query,queryArgs.variables).points).toBeGreaterThanOrEqual(1);
    expect(()=>inspectGraphql('query{repository(owner:"example-org",name:"hello"){fieldThatDoesNotExist}}')).toThrow(/Cannot query field/);
    expect(()=>inspectGraphql('query {',{})).toThrow(/syntax/);
    expect(()=>inspectGraphql(query,{...queryArgs.variables,extra:9})).toThrow(/undeclared/);
    expect(()=>inspectGraphql(query,{owner:'example-org'})).toThrow(/name/);
    expect(()=>inspectGraphql(query,{owner:42,name:'hello'})).toThrow(/String/);
    expect(()=>inspectGraphql('query A{viewer{login}} query B{viewer{login}}')).toThrow(/exactly one operation/);
  });
  it('refuses a mutation on the read path including aliases, fragments and unused operations',()=>{
    const mutation='mutation Mutate($input: MergePullRequestInput!){renamed:mergePullRequest(input:$input){pullRequest{id}}}';
    const vals={input:{pullRequestId:'PR_123'}};
    expect(()=>inspectGraphql(mutation,vals,'query')).toThrow(/cannot contain another operation type/);
    const viaFragment='mutation M($input: MergePullRequestInput!){...Parts} fragment Parts on Mutation { alias:mergePullRequest(input:$input){pullRequest{id}} }';
    const p=inspectGraphql(viaFragment,vals,'mutation');
    expect(p.mutation).toBe('mergePullRequest');
    expect(()=>classifyGraphqlMutation(p.mutation,p.input)).toThrow(/github_pr_merge/);
    expect(()=>inspectGraphql('query A{viewer{login}} mutation B($input: MergePullRequestInput!){mergePullRequest(input:$input){pullRequest{id}}}',vals,'query')).toThrow();
    expect(()=>inspectGraphql('mutation M($input:MergePullRequestInput!){x:mergePullRequest(input:$input){pullRequest{id}} y:mergePullRequest(input:$input){pullRequest{id}}}',vals,'mutation')).toThrow(/exactly one root mutation/);
  });
  it('estimates nested first/last connection cost including variable and fragment expansion',()=>{
    const depth='query Cost($n: Int!) { viewer { repositories(first:$n) { nodes { issues(first:$n) { nodes { comments(first:$n) { nodes { id } } } } } } } }';
    expect(()=>inspectGraphql(depth,{n:100})).toThrow(/500 points|500,000 nodes/);
    const unbounded='query {viewer { repositories { nodes {id} } } }';
    expect(()=>inspectGraphql(unbounded)).toThrow(/first or last/);
    const excessive='query($n:Int!){viewer{repositories(first:$n){nodes{id}}}}';
    expect(()=>inspectGraphql(excessive,{n:101})).toThrow(/1 to 100/);
  });
  it('refuses nested secrets, bypass, future priced operations and enqueues as production/access',()=>{
    expect(()=>classifyGraphqlMutation('updateDiscussion',{input:{discussionId:'D_ID',payload:{access_token:'notallowed'}}})).toThrow(/Secrets/);
    expect(()=>classifyGraphqlMutation('updateDiscussion',{input:{discussionId:'D_ID',bypassRules:true}})).toThrow(/bypass/);
    expect(()=>classifyGraphqlMutation('createCodespace',{input:{id:'R_ID'}})).toThrow(/price/);
    expect(classifyGraphqlMutation('enqueuePullRequest',{input:{id:'PR_ID'}})).toMatchObject({production:true,accessWidening:true});
    expect(classifyGraphqlMutation('updateDiscussion',{input:changes})).toMatchObject({production:true,accessWidening:true});
  });
  it('runs a valid read through scoped pinned client and bounded result shaping',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when('POST /graphql').reply(200,{data:{repository:{nameWithOwner:'example-org/hello'}}});
    const result=await dispatch(w,'github_graphql_read',queryArgs);
    expect(result.isError).not.toBe(true);
    expect(parse(result).data.repository.nameWithOwner).toBe('example-org/hello');
    expect(w.gh.calls).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses an explicitly foreign GraphQL account before any provider request',async()=>{
    const w=await makeWorld({profile:'read_only'});
    const other=await dispatch(w,'github_graphql_read',{...queryArgs,variables:{...queryArgs.variables,owner:'another-org'}});
    expect(other.isError).toBe(true);
    expect(w.gh.calls).toEqual([]);
  });
  it('denies unknown node ownership and missing confirmation without a mutation',async()=>{
    const w=await makeWorld({profile:'full',mode:'production'});
    w.gh.when('POST /graphql').reply(200,{data:{node:{...node('Prior'),repository:{nameWithOwner:'other-org/hello'}}}});
    const res=parse(await dispatch(w,'github_graphql_write',{...writeArgs,confirm:true}));
    expect(res.status).not.toBe('applied');
    expect(w.gh.calls.filter(x=>/^mutation/.test(x.body?.query??''))).toEqual([]);
    const p=await makeWorld({profile:'full',mode:'production'});
    stubMutation(p.gh,'ok');
    const preview=parse(await dispatch(p,'github_graphql_write',writeArgs));
    expect(preview.status,'Verified GraphQL write preflight: '+JSON.stringify(preview)+'; fake invalid: '+JSON.stringify(p.gh.invalid.map(x=>x.invalid))+'; calls: '+JSON.stringify(p.gh.calls.map(x=>({route:x.route,query:x.body?.query})))).toBe('needs_confirmation');
    expect(p.gh.calls.filter(x=>/^mutation/.test(x.body?.query??''))).toEqual([]);
  });
});
runWriteContract({
  label:'U-2 updateDiscussion verified scoped GraphQL mutation',
  definition:{tool:g.tools[1],handler:g.handlers.github_graphql_write},
  args:writeArgs,profile:'full',production:true,needsConfirm:true,accessWidening:true,
  notifies:['example-org'],advanceClockOnSleep:true,
  arrange:(gh,outcome)=>stubMutation(gh,outcome)
});
