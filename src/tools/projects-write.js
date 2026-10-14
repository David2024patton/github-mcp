// F-3: guarded Projects v2 item membership and field editing, scoped to enrolled organizations.
import {listAll} from '../github/client.js';
import {defineGithubWrite} from './define-github-write.js';
import {missing,octo,ownerOf,refusal} from './github-write.js';

const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const NUMBER={type:'integer',minimum:1};
const FIELD={type:'object',properties:{id:NUMBER,value:{type:['string','number','null']}},
  required:['id','value'],additionalProperties:false};
const target=(a,c)=>{
  if(a.action==='add'){
    if(!a.repo||!a.issueNumber||!a.contentType||a.itemId!==undefined||a.fields!==undefined)
      throw new TypeError('Add requires repo, issueNumber and contentType without itemId or fields.');
  }else if(a.action==='set_fields'){
    if(!a.itemId||!Array.isArray(a.fields)||!a.fields.length||a.fields.length>20||
      a.issueNumber!==undefined||a.contentType!==undefined||a.repo!==undefined)
      throw new TypeError('Set fields requires itemId and 1–20 fields, without repository content arguments.');
    if(new Set(a.fields.map(f=>f.id)).size!==a.fields.length)
      throw new TypeError('Each project field ID must occur only once.');
  }else throw new TypeError('Choose add or set_fields.');
  return {owner:ownerOf(a,c),...(a.repo?{repo:a.repo}:{}),scope:a.repo?'repo':'org'};
};
const p=(t,a)=>({org:t.owner,project_number:a.number});
const getProject=async(ctx,t,a)=>{
  const row=await ctx.db.getAccount(t.owner);
  if(row?.account_type!=='Organization')
    throw refusal('Only connected organization Projects v2 are supported with App credentials.');
  const gh=await octo(ctx,t.owner);
  const d=(await gh.request('GET /orgs/{org}/projectsV2/{project_number}',p(t,a))).data;
  if(!d||d.number!==a.number||!d.node_id)
    throw refusal('Exact organization project identity was not verified.');
  return d;
};
const getItem=(ctx,t,a,itemId)=>missing(async()=>
  (await(await octo(ctx,t.owner)).request(
    'GET /orgs/{org}/projectsV2/{project_number}/items/{item_id}',
    {...p(t,a),item_id:itemId})).data);
const readFull=(ctx,t,route,params,max)=>{
  return octo(ctx,t.owner).then(gh=>listAll(gh,route,{...params,per_page:100},{max}));
};
const containsContent=(item,src)=>item?.content?.id===src.id;
const wantedValue=(row,v)=>Object.hasOwn(row,'value')&&row.value===v;
export const projectSetItem=defineGithubWrite({
  name:'github_project_set_item',area:'project',audience:['Op'],
  description:'Add a verified own-repository issue/PR to an organization project, or edit verified project item fields.',
  properties:{owner:OWNER,number:NUMBER,action:{type:'string',enum:['add','set_fields']},
    repo:REPO,issueNumber:NUMBER,contentType:{type:'string',enum:['Issue','PullRequest']},
    itemId:NUMBER,fields:{type:'array',minItems:1,maxItems:20,items:FIELD}},
  required:['number','action'],
  declarations:{production:'never',confirm:'always'},target,
  read:async(a,ctx,t)=>{
    const project=await getProject(ctx,t,a);
    if(a.action==='add'){
      const gh=await octo(ctx,t.owner);
      const route=a.contentType==='PullRequest'
        ?'GET /repos/{owner}/{repo}/pulls/{pull_number}'
        :'GET /repos/{owner}/{repo}/issues/{issue_number}';
      const params={owner:t.owner,repo:a.repo,
        ...(a.contentType==='PullRequest'?{pull_number:a.issueNumber}:{issue_number:a.issueNumber})};
      const source=(await gh.request(route,params)).data;
      if(!Number.isSafeInteger(source?.id)||source.id<1||
        (a.contentType==='Issue'&&source.pull_request))
        throw refusal('The requested issue/PR content identity is not verified.');
      const {items,capped}=await readFull(ctx,t,
        'GET /orgs/{org}/projectsV2/{project_number}/items',p(t,a),500);
      if(capped)throw refusal('Cannot rule out duplicate project membership in a truncated inventory.');
      if(items.some(item=>containsContent(item,source)))
        throw refusal('That issue or pull request is already in the project.');
      return {projectId:project.node_id,source};
    }
    const current=await getItem(ctx,t,a,a.itemId);
    if(!current||current.id!==a.itemId)throw refusal('The exact project item was not verified.');
    const {items:fields,capped}=await readFull(ctx,t,
      'GET /orgs/{org}/projectsV2/{project_number}/fields',p(t,a),200);
    if(capped)throw refusal('Project fields are truncated, so field IDs cannot be verified.');
    for(const f of a.fields)if(!fields.some(v=>v.id===f.id))
      throw refusal('Requested project field ID is not in this project.');
    return {projectId:project.node_id,current};
  },
  classify:()=>({}),
  summarize:({args:a,target:t})=>a.action==='add'
    ?`Add verified ${a.contentType} #${a.issueNumber} from ${t.owner}/${a.repo} to project #${a.number} (approval required)`
    :`Update ${a.fields.length} field(s) of project #${a.number} item #${a.itemId} in ${t.owner} (approval required)`,
  apply:async({args:a,ctx,target:t,before:b})=>{
    const gh=await octo(ctx,t.owner);
    if(a.action==='add')return gh.request('POST /orgs/{org}/projectsV2/{project_number}/items',
      {...p(t,a),type:a.contentType,id:b.source.id});
    return gh.request('PATCH /orgs/{org}/projectsV2/{project_number}/items/{item_id}',
      {...p(t,a),item_id:a.itemId,fields:a.fields});
  },
  readAfter:({args:a,ctx,target:t,response:r})=>
    getItem(ctx,t,a,a.action==='add'?r?.data?.value?.id:a.itemId),
  verify:({args:a,before:b,after:item,response:r})=>{
    if(!item||!Number.isSafeInteger(item.id))return false;
    if(a.action==='add')return item.id===r?.data?.value?.id&&
      containsContent(item,b.source)&&item.node_id===r?.data?.value?.node_id;
    return item.id===a.itemId&&a.fields.every(f=>
      (item.fields??[]).some(v=>v.id===f.id&&wantedValue(v,f.value)));
  },
  inverse:()=>null,
  present:({after:item})=>({id:item.id,node_id:item.node_id,content_id:item.content?.id??null,
    fields:(item.fields??[]).slice(0,20)})
});
export const projectRemoveItem=defineGithubWrite({
  name:'github_project_remove_item',area:'project',audience:['Op'],
  description:'Remove a verified organization project item, confirmed and independently read back as absent.',
  properties:{owner:OWNER,number:NUMBER,itemId:NUMBER},
  required:['number','itemId'],declarations:{production:'never',confirm:'always'},
  target:(a,c)=>({owner:ownerOf(a,c),scope:'org'}),
  read:async(a,ctx,t)=>{
    const project=await getProject(ctx,t,a);
    const current=await getItem(ctx,t,a,a.itemId);
    if(!current||current.id!==a.itemId)throw refusal('Project item not found.');
    return {projectId:project.node_id,current};
  },
  classify:()=>({}),
  summarize:({args:a,target:t})=>`REMOVE organization project #${a.number} item #${a.itemId} from ${t.owner}; stored field values may be lost`,
  apply:({args:a,ctx,target:t})=>octo(ctx,t.owner).then(gh=>gh.request(
    'DELETE /orgs/{org}/projectsV2/{project_number}/items/{item_id}',
    {...p(t,a),item_id:a.itemId})),
  readAfter:({args:a,ctx,target:t})=>getItem(ctx,t,a,a.itemId),
  verify:({after})=>after===null,inverse:()=>null,
  present:({args:a})=>({removed_item_id:a.itemId,field_values_lost:true})
});
export const tools=[projectSetItem.tool,projectRemoveItem.tool];
export const handlers={
  [projectSetItem.tool.name]:projectSetItem.handler,
  [projectRemoveItem.tool.name]:projectRemoveItem.handler
};
