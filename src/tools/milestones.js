// F-2: repository milestone CRUD and progress. No implicit issue edits.
import { listAll } from '../github/client.js';
import { defineRead } from './define-read.js';
import { plain, readerFor } from './github-read.js';
import { defineGithubWrite } from './define-github-write.js';
import { missing,octo,ownerOf,refusal,slug } from './github-write.js';
const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const NUMBER={type:'integer',minimum:1},TITLE={type:'string',minLength:1,maxLength:256};
const DESCRIPTION={type:'string',maxLength:20000};
const DUE={type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$'};
const target=(a,c)=>({owner:ownerOf(a,c),repo:a.repo,scope:'repo'});
const p=t=>({owner:t.owner,repo:t.repo});
const get=(ctx,t,n)=>missing(async()=>(await(await octo(ctx,t.owner)).request(
  'GET /repos/{owner}/{repo}/milestones/{milestone_number}',{...p(t),milestone_number:n})).data);
const view=m=>({number:m.number,id:m.id,title:m.title,description:m.description??'',state:m.state,
  due_on:m.due_on??null,open_issues:m.open_issues,closed_issues:m.closed_issues,html_url:m.html_url});
export const milestoneList=defineRead({
  name:'github_milestone_list',area:'milestone',audience:['Op'],
  description:'List milestone progress with state filtering and bounded pagination.',
  properties:{owner:OWNER,repo:REPO,state:{type:'string',enum:['open','closed','all']},
    max:{type:'integer',minimum:1,maximum:1000}},required:['repo'],
  handler:(a,ctx)=>plain(async()=>{
    const {owner,octokit}=await readerFor(a,ctx);
    const {items,capped}=await listAll(octokit,'GET /repos/{owner}/{repo}/milestones',
      {owner,repo:a.repo,state:a.state??'open',per_page:100},{max:a.max??100});
    return {items:items.map(view),count:items.length,complete:!capped,...(capped?{scan_capped:true}:{})};
  })
});
export const milestoneSave=defineGithubWrite({
  name:'github_milestone_save',area:'milestone',audience:['Op'],
  description:'Create or update milestone title, description, due date or state; verify readback.',
  properties:{owner:OWNER,repo:REPO,number:NUMBER,title:TITLE,
    description:DESCRIPTION,state:{type:'string',enum:['open','closed']},
    dueOn:{...DUE}},required:['repo'],
  declarations:{production:'never'},target:(a,ctx)=>{
    if(a.number===undefined&&a.title===undefined)
      throw new TypeError('Creating a milestone requires a title.');
    if(a.number!==undefined&&!['title','description','state','dueOn'].some(k=>Object.hasOwn(a,k)))
      throw new TypeError('Specify a milestone field to update.');
    return target(a,ctx);
  },
  read:async(a,ctx,t)=>{
    const current=a.number===undefined?null:await get(ctx,t,a.number);
    if(a.number!==undefined&&!current)throw refusal('Milestone not found.');
    return {current};
  },
  classify:()=>({}),
  summarize:({args:a,target:t})=>`${a.number===undefined?'Create':'Update'} milestone "${a.title??a.number}" in ${slug(t.owner,t.repo)}`,
  apply:({args:a,ctx,target:t})=>octo(ctx,t.owner).then(o=>o.request(
    a.number===undefined?'POST /repos/{owner}/{repo}/milestones':'PATCH /repos/{owner}/{repo}/milestones/{milestone_number}',
    {...p(t),...(a.number!==undefined?{milestone_number:a.number}:{}),
      ...(a.title!==undefined?{title:a.title}:{}),
      ...(a.description!==undefined?{description:a.description}:{}),
      ...(a.state!==undefined?{state:a.state}:{}),
      ...(a.dueOn!==undefined?{due_on:a.dueOn}:{})}
  )),
  readAfter:({args:a,response:r,ctx,target:t})=>get(ctx,t,a.number??r?.data?.number),
  verify:({args:a,before:b,after:m,response:r})=>!!m&&
    m.number===(a.number??r?.data?.number)&&
    ['title','description','state'].every(k=>(
      a[k]===undefined||String(m[k]??'')===a[k]
    ))&&
    (a.dueOn===undefined||new Date(m.due_on).toISOString()===new Date(a.dueOn).toISOString())&&
    (a.number!==undefined||!b.current),
  inverse:()=>null,present:({after:m})=>view(m)
});
export const milestoneDelete=defineGithubWrite({
  name:'github_milestone_delete',area:'milestone',audience:['Op'],
  description:'Permanently delete a milestone, clearing issue milestone associations.',
  properties:{owner:OWNER,repo:REPO,number:NUMBER},required:['repo','number'],
  declarations:{production:'never',confirm:'always'},target,
  read:(a,ctx,t)=>get(ctx,t,a.number),classify:()=>({}),
  summarize:({args:a,target:t})=>`DELETE milestone #${a.number} in ${slug(t.owner,t.repo)} and remove it from linked issues; irreversible`,
  apply:({args:a,before:b,ctx,target:t})=>{
    if(!b)throw refusal('Milestone no longer exists.');
    return octo(ctx,t.owner).then(o=>o.request('DELETE /repos/{owner}/{repo}/milestones/{milestone_number}',
      {...p(t),milestone_number:a.number}));
  },
  readAfter:({args:a,ctx,target:t})=>get(ctx,t,a.number),
  verify:({after})=>after===null,inverse:()=>null,
  present:({args:a})=>({deleted_number:a.number,irreversible:true})
});
export const tools=[milestoneList.tool,milestoneSave.tool,milestoneDelete.tool];
export const handlers=Object.fromEntries([[milestoneList.tool,milestoneList.handler],[milestoneSave.tool,milestoneSave.handler],[milestoneDelete.tool,milestoneDelete.handler]].map(([t,h])=>[t.name,h]));
