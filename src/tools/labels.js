// F-2: repository label inventory, guarded create/edit/rename and destructive delete.
import { listAll } from '../github/client.js';
import { defineRead } from './define-read.js';
import { plain, readerFor } from './github-read.js';
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const NAME={type:'string',minLength:1,maxLength:100},COLOR={type:'string',pattern:'^[0-9A-Fa-f]{6}$'};
const TEXT={type:'string',maxLength:1000};
const target=(a,c)=>({owner:ownerOf(a,c),repo:a.repo,scope:'repo'});
const p=t=>({owner:t.owner,repo:t.repo});
const get=(ctx,t,name)=>missing(async()=>(await (await octo(ctx,t.owner)).request(
  'GET /repos/{owner}/{repo}/labels/{name}',{...p(t),name})).data);
const view=x=>({id:x.id,name:x.name,color:x.color,description:x.description??null,default:x.default??false});
export const labelList=defineRead({
  name:'github_label_list',area:'label',audience:['B','Op'],description:'List repository labels with exact pagination and complete-scan disclosure.',
  properties:{owner:OWNER,repo:REPO,max:{type:'integer',minimum:1,maximum:1000}},required:['repo'],
  handler:(a,ctx)=>plain(async()=>{
    const {owner,octokit}=await readerFor(a,ctx);
    const max=a.max??100;
    const {items,capped}=await listAll(octokit,'GET /repos/{owner}/{repo}/labels',
      {owner,repo:a.repo,per_page:100},{max});
    return {items:items.map(view),count:items.length,complete:!capped,...(capped?{scan_capped:true}: {})};
  })
});
export const labelSave=defineGithubWrite({
  name:'github_label_save',area:'label',audience:['B','Op'],
  description:'Create, rename or update a repository label with verified GitHub readback.',
  properties:{owner:OWNER,repo:REPO,name:NAME,newName:NAME,color:COLOR,description:TEXT},
  required:['repo','name'],declarations:{production:'never'},target:(a,ctx)=>{
    if(a.newName===undefined && a.color===undefined && a.description===undefined)
      throw new TypeError('Supply newName, color or description to save a label.');
    return target(a,ctx);
  },
  read:async(a,ctx,t)=>{
    const current=await get(ctx,t,a.name);
    if(!current && a.newName!==undefined)throw refusal('Cannot rename a label that does not exist.');
    if(!current && a.color===undefined)throw refusal('New labels require a six-digit hex color.');
    if(current&&a.newName!==undefined&&a.newName.toLowerCase()!==a.name.toLowerCase()){
      const collision=await get(ctx,t,a.newName);
      if(collision)throw refusal('A label already has that destination name; refusing an overwrite.');
    }
    return {current};
  },
  classify:()=>({}),
  summarize:({args:a,before:b,target:t})=>`${b.current?'Update':'Create'} label "${a.name}" in ${slug(t.owner,t.repo)}${a.newName?` as "${a.newName}"`:''}`,
  apply:({args:a,before:b,ctx,target:t})=>octo(ctx,t.owner).then(o=>o.request(
    b.current?'PATCH /repos/{owner}/{repo}/labels/{name}':'POST /repos/{owner}/{repo}/labels',
    {...p(t),...(b.current?{name:a.name,new_name:a.newName??a.name}:{name:a.name}),
      ...(a.color!==undefined?{color:a.color.toLowerCase()}:{}),
      ...(a.description!==undefined?{description:a.description}:{})}
  )),
  readAfter:async({args:a,ctx,target:t})=>{
    const result=await get(ctx,t,a.newName??a.name);
    const old=a.newName!==undefined&&a.newName.toLowerCase()!==a.name.toLowerCase()
      ? await get(ctx,t,a.name):null;
    return {result,old};
  },
  verify:({args:a,after:b})=>!!b?.result&&b.old===null&&
    b.result.name.toLowerCase()===(a.newName??a.name).toLowerCase()&&
    (a.color===undefined||b.result.color.toLowerCase()===a.color.toLowerCase())&&
    (a.description===undefined||(b.result.description??'')===a.description),
  inverse:()=>null,
  present:({after:b})=>view(b.result)
});
export const labelDelete=defineGithubWrite({
  name:'github_label_delete',area:'label',audience:['Op'],
  description:'Permanently delete a repository label from every issue, after explicit confirmation.',
  properties:{owner:OWNER,repo:REPO,name:NAME},required:['repo','name'],
  declarations:{production:'never',confirm:'always'},target,
  read:(a,ctx,t)=>get(ctx,t,a.name),
  classify:()=>({}),
  summarize:({args:a,target:t})=>`DELETE label "${a.name}" in ${slug(t.owner,t.repo)}: removes it from every issue and PR; irreversible`,
  apply:({args:a,before:b,ctx,target:t})=>{
    if(!b)throw refusal('Label no longer exists. Nothing was deleted.');
    return octo(ctx,t.owner).then(o=>o.request('DELETE /repos/{owner}/{repo}/labels/{name}',{...p(t),name:a.name}));
  },
  readAfter:({args:a,ctx,target:t})=>get(ctx,t,a.name),
  verify:({after})=>after===null,inverse:()=>null,
  present:({args:a})=>({deleted:a.name,removed_from_issues:true,irreversible:true})
});
export const tools=[labelList.tool,labelSave.tool,labelDelete.tool];
export const handlers=Object.fromEntries([[labelList.tool,labelList.handler],[labelSave.tool,labelSave.handler],[labelDelete.tool,labelDelete.handler]].map(([t,h])=>[t.name,h]));
