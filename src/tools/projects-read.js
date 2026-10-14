// F-3: organization Projects v2 inventory, detail and field-valued item reads.
// User-owned REST Projects reject installation and App user tokens; fail closed.
import { listAll } from '../github/client.js';
import { defineRead } from './define-read.js';
import { plain, readerFor } from './github-read.js';

const OWNER={type:'string',maxLength:39};
const NUMBER={type:'integer',minimum:1};
const MAX={type:'integer',minimum:1,maximum:100};
const projectView=x=>({
  id:x.id,node_id:x.node_id,number:x.number,title:x.title,
  description:x.short_description??x.description??null,public:x.public??null,
  state:x.state??null,items_count:x.items_count??null,
  url:x.html_url??null,updated_at:x.updated_at??null
});
const fieldView=x=>({
  id:x.id,node_id:x.node_id,name:x.name,data_type:x.data_type,
  options:Array.isArray(x.options)?x.options.slice(0,30).map(o=>({
    id:o.id,name:typeof o.name==='object'?o.name?.raw:o.name,
    color:o.color??null})):undefined
});
const itemView=x=>({
  id:x.id,node_id:x.node_id,type:x.type??null,is_archived:x.is_archived??false,
  content:x.content?{type:x.content.type??null,number:x.content.number??null,
    title:x.content.title??null,url:x.content.html_url??null}:null,
  field_values:Array.isArray(x.field_values)?x.field_values.slice(0,30).map(v=>({
    id:v.id,field_id:v.field_id??v.field?.id??null,
    name:v.field?.name??null,value:v.value??null})):[],
  updated_at:x.updated_at??null
});

async function projectClient(a,ctx){
  const {owner,octokit}=await readerFor(a,ctx);
  const row=await ctx.db.getAccount(owner);
  if(!row)throw new TypeError('The project owner is not enrolled in this connection.');
  if(row.account_type!=='Organization')
    throw new TypeError('User-owned Projects v2 REST does not accept GitHub App installation or App user tokens. Use an explicitly authorized classic-token GraphQL path (IN-11) when available; this tool will not try a different account.');
  return {org:owner,octokit};
}
const shapeList=(items,capped)=>({
  count:items.length,items,complete:!capped,
  ...(capped?{more_may_exist:true,warning:'The maximum was reached; this is not a complete inventory.'}:{})
});
const list=(octokit,route,p,max)=>listAll(octokit,route,{...p,per_page:100},{max});

export const projectList=defineRead({
  name:'github_project_list',area:'project',audience:['Op'],
  description:'List organization Projects v2 with bounded, truthful pagination.',
  properties:{owner:OWNER,max:MAX},
  handler:(a,ctx)=>plain(async()=>{
    const {org,octokit}=await projectClient(a,ctx);
    const {items,capped}=await list(octokit,'GET /orgs/{org}/projectsV2',{org},a.max??100);
    return {owner:org,...shapeList(items.map(projectView),capped)};
  })
});
export const projectGet=defineRead({
  name:'github_project_get',area:'project',audience:['Op'],
  description:'Get one organization Project v2 and its bounded custom field definitions.',
  properties:{owner:OWNER,number:NUMBER,max:MAX},required:['number'],
  handler:(a,ctx)=>plain(async()=>{
    const {org,octokit}=await projectClient(a,ctx),project_number=a.number;
    const project=(await octokit.request('GET /orgs/{org}/projectsV2/{project_number}',{org,project_number})).data;
    if(!project||project.number!==project_number||!project.node_id)
      throw new TypeError('GitHub did not verify the requested project identity.');
    const max=a.max??100;
    const fields=await list(octokit,'GET /orgs/{org}/projectsV2/{project_number}/fields',
      {org,project_number},max);
    return {...projectView(project),owner:org,
      fields:shapeList(fields.items.map(fieldView),fields.capped)};
  })
});
export const projectListItems=defineRead({
  name:'github_project_list_items',area:'project',audience:['Op'],
  description:'List organization Project v2 items with bounded field values.',
  properties:{owner:OWNER,number:NUMBER,max:MAX,query:{type:'string',minLength:1,maxLength:200}},
  required:['number'],
  handler:(a,ctx)=>plain(async()=>{
    const {org,octokit}=await projectClient(a,ctx),project_number=a.number;
    // Verify project identity before accepting content from an items endpoint.
    const project=(await octokit.request('GET /orgs/{org}/projectsV2/{project_number}',
      {org,project_number})).data;
    if(!project||project.number!==project_number||!project.node_id)
      throw new TypeError('GitHub did not verify the requested project identity.');
    const {items,capped}=await list(octokit,'GET /orgs/{org}/projectsV2/{project_number}/items',
      {org,project_number,...(a.query?{q:a.query}:{})},a.max??100);
    return {owner:org,project_number,project_node_id:project.node_id,
      ...shapeList(items.map(itemView),capped)};
  })
});
export const tools=[projectList.tool,projectGet.tool,projectListItems.tool];
export const handlers=Object.fromEntries([
  [projectList.tool,projectList.handler],[projectGet.tool,projectGet.handler],
  [projectListItems.tool,projectListItems.handler]
].map(([t,h])=>[t.name,h]));
