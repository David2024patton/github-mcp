// H-3: bounded, scoped collaborator/invitation and deploy-key inspection.
import {createHash} from 'node:crypto';
import {listAll} from '../github/client.js';
import {defineRead} from './define-read.js';
import {readerFor,plain} from './github-read.js';

const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const MAX={type:'integer',minimum:1,maximum:200};
const base={owner:OWNER,repo:REPO,max:MAX};
const repoParams=(owner,repo)=>({owner,repo,per_page:100});
const collaborator=x=>({login:x.login,id:x.id,
  role_name:x.role_name??null,permissions:x.permissions??null,
  site_admin:x.site_admin===true});
const invitation=x=>({id:x.id,login:x.invitee?.login??null,
  permission:x.permissions??x.permission??null,
  created_at:x.created_at??null,inviter:x.inviter?.login??null,
  expired:x.expired===true});
const fingerprint=value=>typeof value==='string'
  ?createHash('sha256').update(value.trim()).digest('hex').slice(0,20):null;
const key=x=>({id:x.id,title:x.title??null,read_only:x.read_only===true,
  verified:x.verified??null,added_at:x.created_at??null,
  last_used:x.last_used??null,fingerprint:fingerprint(x.key)});
export const collabList=defineRead({
  name:'github_collab_list',area:'collaborator',audience:['O','Op'],
  description:'List repository collaborators and pending invitations, including effective roles and permissions.',
  properties:base,required:['repo'],
  handler:(a,ctx)=>plain(async()=>{
    const {owner,octokit:gh}=await readerFor(a,ctx);
    const p=repoParams(owner,a.repo);
    const people=await listAll(gh,'GET /repos/{owner}/{repo}/collaborators',
      {...p,affiliation:'all'},{max:a.max??100});
    const pending=await listAll(gh,'GET /repos/{owner}/{repo}/invitations',
      p,{max:a.max??100});
    return {owner,repo:a.repo,collaborators:people.items.map(collaborator),
      pending_invitations:pending.items.map(invitation),
      complete:!people.capped&&!pending.capped,
      warning:people.capped||pending.capped?'Inventory truncated; use a higher cap before changing access.':null};
  })
});
export const deploykeyList=defineRead({
  name:'github_deploykey_list',area:'deploykey',audience:['O'],
  description:'List repository deploy keys with their access flags and last-use metadata; omit raw key bodies.',
  properties:base,required:['repo'],
  handler:(a,ctx)=>plain(async()=>{
    const {owner,octokit:gh}=await readerFor(a,ctx);
    const results=await listAll(gh,'GET /repos/{owner}/{repo}/keys',
      repoParams(owner,a.repo),{max:a.max??100});
    return {owner,repo:a.repo,keys:results.items.map(key),count:results.items.length,
      complete:!results.capped,
      ...(results.capped?{warning:'Deploy key inventory is incomplete.'}:{})};
  })
});
export const tools=[collabList.tool,deploykeyList.tool];
export const handlers=Object.fromEntries([
  [collabList.tool,collabList.handler],[deploykeyList.tool,deploykeyList.handler]
].map(([t,h])=>[t.name,h]));
