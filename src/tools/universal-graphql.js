// U-2 universal GraphQL: pinned schema, AST-aware read/mutation separation,
// explicit scoped node preflight and the existing journaled GitHub write lifecycle.
import {defineRead} from './define-read.js';
import {defineGithubWrite} from './define-github-write.js';
import {githubFor,graphql} from '../github/client.js';
import {plain} from './github-read.js';
import {inspectGraphql,graphqlSelectionFields,graphqlRootSelections} from '../github/graphql-schema.js';
import {valueFromASTUntyped} from 'graphql';
import {classifyGraphqlMutation,relevantGraphqlNodeId} from '../github/mutation-classes.js';

const DOCUMENT={type:'string',minLength:5,maxLength:24000,description:'One validated GraphQL document, including typed variable definitions'};
const VARIABLES={type:'object',additionalProperties:true,maxProperties:48,description:'Typed GraphQL input variables; no credentials'};
const OWNER={type:'string',minLength:1,maxLength:39,description:'Already-enrolled account; defaults to this connection'};
const REPO={type:'string',minLength:1,maxLength:100,description:'Explicit repository for guarded GraphQL mutations'};
const CRED={type:'string',enum:['I','U'],description:'I installation or explicitly enrolled U user credential'};
const common={variables:VARIABLES,owner:OWNER,cred:CRED};

export const SCOPE_QUERY='query UniversalResourceScope($id: ID!) { node(id: $id) { __typename id ... on Repository { nameWithOwner } ... on Issue { title repository { nameWithOwner } } ... on PullRequest { title repository { nameWithOwner } } ... on Discussion { title repository { nameWithOwner } } ... on Release { name repository { nameWithOwner } } ... on Milestone { title repository { nameWithOwner } } ... on Label { name repository { nameWithOwner } } ... on Commit { repository { nameWithOwner } } ... on DiscussionComment { discussion { repository { nameWithOwner } } } ... on IssueComment { issue { repository { nameWithOwner } } } } }';
function ownerFor(a,c){
  const requested=a.owner??c.connection?.default_account;
  if(typeof requested!=='string'||!c.connection?.accounts?.some(x=>x.toLowerCase()===requested.toLowerCase()))
    throw new TypeError('GraphQL account is not enrolled in this connection.');
  return c.connection.accounts.find(x=>x.toLowerCase()===requested.toLowerCase());
}
function credFor(a){
  const cred=a.cred??'I';
  if(!['I','U'].includes(cred))throw new TypeError('GraphQL credential must be an enrolled I or U credential.');
  return cred;
}
async function accountGraphql(ctx,owner,cred,repo){
  const account=await ctx.db.getAccount(owner);
  const client=await githubFor(ctx,{owner,cred,
    ...(repo&&cred==='I'&&account?.credential_kind==='app'?{scope:{repositories:[repo]}}:{})});
  return (document,variables)=>graphql(client,document,variables);
}
async function readScope(entry,owner,repo,ctx,cred){
  // Do not allow a query that explicitly names an unrelated account through
  // the single-account GraphQL endpoint. Variable and literal arguments both count.
  const named=entry.variables;
  for(const field of graphqlRootSelections(entry)){
    const operation=field.name.value;
    if(['organization','repository','enterprise'].includes(operation)){
      const arg=field.arguments?.find(x=>x.name.value===(operation==='repository'?'owner':'login'));
      const value=valueFromASTUntyped(arg?.value,named);
      if(typeof value!=='string'||value.toLowerCase()!==owner.toLowerCase())
        throw new TypeError('GraphQL query names an account outside the enrolled connection.');
    }
    if(['node','nodes'].includes(operation)){
      if(typeof repo!=='string'||!/^[A-Za-z0-9_.-]{1,100}$/.test(repo))
        throw new TypeError('Opaque node reads need an explicit scoped repository for independent ID validation.');
      const idArg=field.arguments?.find(x=>x.name.value===(operation==='node'?'id':'ids'));
      const ids=valueFromASTUntyped(idArg?.value,named);
      const list=operation==='node'?[ids]:ids;
      if(!Array.isArray(list)||list.length>10||list.length<1||list.some(x=>typeof x!=='string'||!x))
        throw new TypeError('Opaque node reads require one to ten valid explicit IDs.');
      const call=await accountGraphql(ctx,owner,cred,repo);
      for(const id of list){
        const response=await call(SCOPE_QUERY,{id});
        const node=response?.node;
        const scope=node?.nameWithOwner??node?.repository?.nameWithOwner??node?.discussion?.repository?.nameWithOwner??node?.issue?.repository?.nameWithOwner;
        if(!node||scope?.toLowerCase()!==(owner+'/'+repo).toLowerCase())
          throw new TypeError('Opaque GraphQL node ID is not proven to belong to the requested repository.');
      }
    }
    if(operation==='search'){
      if(typeof repo!=='string'||!/^[A-Za-z0-9_.-]{1,100}$/.test(repo))
        throw new TypeError('GraphQL search requires an explicit repository scope.');
      const query=field.arguments?.find(x=>x.name.value==='query');
      const value=valueFromASTUntyped(query?.value,named);
      if(typeof value!=='string'||!value.split(/\s+/).some(x=>x.toLowerCase()==='repo:'+(owner+'/'+repo).toLowerCase()))
        throw new TypeError('GraphQL search needs the exact repo:owner/repo filter.');
    }
  }
}
function resolveRead(a,c){
  const owner=ownerFor(a,c),cred=credFor(a);
  const entry=inspectGraphql(a.query,a.variables??{},'query');
  return {owner,cred,repo:a.repo??null,entry};
}
function targetWrite(a,c){
  const owner=ownerFor(a,c),repo=a.repo;
  if(typeof repo!=='string'||!/^[A-Za-z0-9_.-]{1,100}$/.test(repo))
    throw new TypeError('GraphQL mutation requires an explicitly named, valid repository.');
  if(JSON.stringify(a.variables??{}).length>24_000)
    throw new TypeError('GraphQL variables exceed the safe request budget.');
  const entry=inspectGraphql(a.mutation,a.variables??{},'mutation');
  const classification=classifyGraphqlMutation(entry.mutation,entry.input);
  const node=relevantGraphqlNodeId(entry.input);
  return {owner,repo,scope:'repo',kind:'graphql-repo',ref:null,cred:credFor(a),entry,classification,node};
}
// No provider write is attempted unless this exact node can be independently
// resolved to the caller's enrolled account AND requested repository.
async function baseline(a,c,target){
  const call=await accountGraphql(c,target.owner,target.cred,target.repo);
  const value=await call(SCOPE_QUERY,{id:target.node.value});
  const node=value?.node;
  if(!node||node.id!==target.node.value)
    throw new TypeError('GraphQL resource ID could not be independently resolved.');
  const name=node.nameWithOwner??node.repository?.nameWithOwner??node.discussion?.repository?.nameWithOwner??node.issue?.repository?.nameWithOwner;
  if(typeof name!=='string'||name.toLowerCase()!==(target.owner+'/'+target.repo).toLowerCase())
    throw new TypeError('GraphQL resource is not proven to belong to the requested repository.');
  return {verified:true,id:node.id,type:node.__typename,repo:name,node};
}
function changesMatch(changes,node){
  const entries=Object.entries(changes).filter(([key])=>['title','body','name'].includes(key));
  return entries.length>0&&entries.every(([key,value])=>Object.hasOwn(node??{},key)&&JSON.stringify(node[key])===JSON.stringify(value));
}
const gqlRead=defineRead({
  name:'github_graphql_read',area:'universal',audience:['B','O','Op'],
  description:'Read a single pinned-schema GitHub GraphQL query after validating variables, connection bounds, points and account scope.',
  properties:{query:DOCUMENT,...common,repo:REPO},required:['query'],
  handler:(a,c)=>plain(async()=>{
    const chosen=resolveRead(a,c);
    await readScope(chosen.entry,chosen.owner,chosen.repo,c,chosen.cred);
    const call=await accountGraphql(c,chosen.owner,chosen.cred,chosen.repo);
    const data=await call(chosen.entry.source,chosen.entry.variables);
    return {account:chosen.owner,pointsEstimate:chosen.entry.points,
      maximumNodes:chosen.entry.nodes,connections:chosen.entry.connections,
      rootFields:graphqlSelectionFields(chosen.entry),data};
  })
});
const gqlWrite=defineGithubWrite({
  name:'github_graphql_write',area:'universal',audience:['B','O','Op'],
  description:'PRODUCTION: Confirm one schema-valid non-curated GraphQL mutation under full resource, access and replay guards.',
  properties:{mutation:DOCUMENT,...common,repo:REPO},required:['mutation','repo'],
  declarations:{production:'always',accessWidening:true,notifies:true,spend:false,confirm:'always',cred:'I,U',profiles:['full']},
  target:(a,c)=>targetWrite(a,c),
  read:async(a,c,t)=>baseline(a,c,t),
  price:({before})=>{
    if(before?.verified!==true)throw new TypeError('A verified scoped GraphQL baseline is required before any write.');
    return 0;
  },
  classify:({target:t,before})=>({
    production:'GraphQL '+t.entry.mutation+' may change '+t.owner+'/'+t.repo,
    accessWidening:'Unreviewed GraphQL mutations are access-sensitive until independently classified.',
    notifies:[t.owner+' (GraphQL recipients are not independently known)'],
    ...(before?.verified!==true?{production:'Unverified GraphQL resource ownership'}:{})
  }),
  summarize:({target:t,before})=>'Single GraphQL '+t.entry.mutation+' on '+t.owner+'/'+t.repo+
    ', verified '+(before?.type??'unknown')+' node; fields '+Object.keys(t.node.changes).join(',').slice(0,180),
  apply:async({args:a,ctx:c,target:t})=>{
    // The same parser and curated classifier must still accept the request at
    // dispatch, not just the preview; the write contract enforces one send.
    const checked=targetWrite(a,c);
    if(checked.node.value!==t.node.value||checked.entry.mutation!==t.entry.mutation)
      throw new TypeError('GraphQL mutation intent changed after its preview.');
    const call=await accountGraphql(c,t.owner,t.cred,t.repo);
    const data=await call(checked.entry.source,checked.entry.variables);
    return {data,headers:{}};
  },
  readAfter:async({args:a,ctx:c,target:t,before,response})=>{
    const after=await baseline(a,c,t);
    return {verified:after.verified,node:after.node,mutation:t.entry.mutation,
      receipt:response?.data?.[t.entry.mutation]??null,before:before?.node??null};
  },
  verify:({target:t,before,after})=>
    before?.verified===true&&after?.verified===true&&
    changesMatch(t.node.changes,after.node)&&
    JSON.stringify(after.node)!==JSON.stringify(before.node),
  present:({target:t,after,response})=>({
    mutation:t.entry.mutation,account:t.owner,repository:t.repo,
    independentlyRead:after?.verified===true,
    observed:after?.verified?after.node:null,
    providerReceipt:response?.data?.[t.entry.mutation]??null
  }),
  inverse:()=>null
});
export const tools=[gqlRead.tool,gqlWrite.tool];
export const handlers={github_graphql_read:gqlRead.handler,github_graphql_write:gqlWrite.handler};
