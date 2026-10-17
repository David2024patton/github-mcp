// Y-9d: selected-repository Copilot cloud-agent administration via provider REST.
// A metered exposure notice applies to enabling; disabling is free and remains possible under $0 caps.
import {defineRead} from './define-read.js';
import {defineGithubWrite} from './define-github-write.js';
import {octo,ownerOf,refusal} from './github-write.js';
import {plain} from './github-read.js';

const OWNER={type:'string',minLength:1,maxLength:39};
const REPO={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9_.-]+$'};
const base='/orgs/{org}/copilot/coding-agent/permissions';
const target=(a,c)=>({owner:ownerOf(a,c),scope:'org',kind:'copilot-agent-settings'});
const ghFor=(c,t)=>octo(c,t.owner,'I');
async function org(c,t){
  const row=await c.db.getAccount(t.owner);
  if(row?.account_type!=='Organization')throw refusal('Selected agent repositories require an enrolled organization.');
  return ghFor(c,t);
}
async function policy(gh,t){
  const x=(await gh.request('GET '+base,{org:t.owner})).data;
  if(!['selected','all','none'].includes(x?.enabled_repositories))
    throw refusal('Copilot agent organization policy is unavailable.');
  return x.enabled_repositories;
}
async function selected(gh,t){
  const ids=[],names=[];
  for(let page=1;page<=11;page++){
    const data=(await gh.request('GET '+base+'/repositories',{org:t.owner,per_page:100,page})).data;
    if(!Array.isArray(data?.repositories)||!Number.isInteger(data.total_count))
      throw refusal('GitHub did not return a complete verifiable selected-repository list.');
    for(const item of data.repositories){
      if(!Number.isSafeInteger(item.id)||item.id<1||item.owner?.login?.toLowerCase()!==t.owner.toLowerCase())
        throw refusal('Copilot selected-repository inventory contained an unverified repository.');
      ids.push(item.id);names.push(item.full_name);
    }
    if(ids.length===data.total_count)return {ids,names};
    if(!data.repositories.length||ids.length>1000)
      throw refusal('Selected repositories exceed a safe verified readback; no final success will be claimed.');
  }
  throw refusal('Copilot selected-repository list exceeds safe pagination.');
}
const list=defineRead({
  name:'github_copilot_agent_repos_list',area:'copilot',audience:['O','Op'],
  description:'Read verified selected repositories enabled for organization Copilot cloud agent.',
  properties:{owner:OWNER},
  handler:(a,c)=>plain(async()=>{const t=target(a,c),client=await org(c,t);
    const state=await policy(client,t);
    return state==='selected'?{owner:t.owner,policy:state,...await selected(client,t)}:
      {owner:t.owner,policy:state,ids:[],names:[],note:'Selected-repository list does not apply until policy is selected.'};
  })
});
const set=defineGithubWrite({
  name:'github_copilot_agent_repo_set',area:'copilot',audience:['O'],
  description:'Enable or disable an owned repository for Copilot cloud agent with real GitHub readback and metered-cost notice.',
  properties:{owner:OWNER,repo:REPO,enable:{type:'boolean'}},
  required:['repo','enable'],
  declarations:{production:'always',confirm:'always',accessWidening:true,profiles:['full']},
  target,
  read:async(a,c,t)=>{
    const client=await org(c,t);
    if(await policy(client,t)!=='selected')
      throw refusal('Choose the selected-repositories Copilot agent policy before changing membership.');
    const repo=(await client.request('GET /repos/{owner}/{repo}',{
      owner:t.owner,repo:a.repo})).data;
    if(!Number.isSafeInteger(repo?.id)||repo.full_name?.toLowerCase()!==(t.owner+'/'+a.repo).toLowerCase()||
      repo.owner?.login?.toLowerCase()!==t.owner.toLowerCase())
      throw refusal('Repository ID was not proven to belong to the selected organization.');
    const previous=await selected(client,t);
    return {repo_id:repo.id,full_name:repo.full_name,included:previous.ids.includes(repo.id)};
  },
  classify:({args:a,before:b})=>a.enable&&!b.included
    ?{production:'enables Copilot agent in a repository',
      accessWidening:'Copilot cloud agent receives repository execution access',
      spendUnknown:true}
    :{production:'disables Copilot agent or preserves existing permission'},
  summarize:({args:a,before:b})=>(a.enable?'Enable':'Disable')+
    ' Copilot cloud agent in '+b.full_name+' (today '+(b.included?'enabled':'disabled')+')'+
    (a.enable?'; metered cloud-agent usage may incur charges with no guaranteed maximum':''),
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(a.enable===b.included)throw refusal('Repository policy already matches.');
    return (await ghFor(ctx,t)).request((a.enable?'PUT ':'DELETE ')+
      base+'/repositories/{repository_id}',{org:t.owner,repository_id:b.repo_id});
  },
  readAfter:async({ctx,target:t})=>selected(await ghFor(ctx,t),t),
  verify:({args:a,before:b,after:x})=>!!x&&x.ids.includes(b.repo_id)===a.enable,
  inverse:()=>null,
  present:({args:a,before:b})=>({repository:b.full_name,enabled:a.enable,
    metered_warning:a.enable?'GitHub can charge for future cloud-agent usage; no total guarantee':null})
});
export const tools=[list.tool,set.tool];
export const handlers={ [list.tool.name]:list.handler,[set.tool.name]:set.handler };
};
const base='/orgs/{org}/copilot/coding-agent/permissions';
const target=(a,c)=>({owner:ownerOf(a,c),scope:'org',kind:'copilot-agent-settings'});
const ghFor=(c,t)=>octo(c,t.owner,'I');
async function org(c,t){
  const row=await c.db.getAccount(t.owner);
  if(row?.account_type!=='Organization')throw refusal('Selected agent repositories require an enrolled organization.');
  return ghFor(c,t);
}
async function policy(gh,t){
  const x=(await gh.request('GET '+base,{org:t.owner})).data;
  if(!['selected','all','none'].includes(x?.enabled_repositories))
    throw refusal('Copilot agent organization policy is unavailable.');
  return x.enabled_repositories;
}
async function selected(gh,t){
  const ids=[],names=[];
  for(let page=1;page<=11;page++){
    const data=(await gh.request('GET '+base+'/repositories',{org:t.owner,per_page:100,page})).data;
    if(!Array.isArray(data?.repositories)||!Number.isInteger(data.total_count))
      throw refusal('GitHub did not return a complete verifiable selected-repository list.');
    for(const item of data.repositories){
      if(!Number.isSafeInteger(item.id)||item.id<1||item.owner?.login?.toLowerCase()!==t.owner.toLowerCase())
        throw refusal('Copilot selected-repository inventory contained an unverified repository.');
      ids.push(item.id);names.push(item.full_name);
    }
    if(ids.length===data.total_count)return {ids,names};
    if(!data.repositories.length||ids.length>1000)
      throw refusal('Selected repositories exceed a safe verified readback; no final success will be claimed.');
  }
  throw refusal('Copilot selected-repository list exceeds safe pagination.');
}
const list=defineRead({
  name:'github_copilot_agent_repos_list',area:'copilot',audience:['O','Op'],
  description:'Read verified selected repositories enabled for organization Copilot cloud agent.',
  properties:{owner:OWNER},
  handler:(a,c)=>plain(async()=>{const t=target(a,c),client=await org(c,t);
    const state=await policy(client,t);
    return state==='selected'?{owner:t.owner,policy:state,...await selected(client,t)}:
      {owner:t.owner,policy:state,ids:[],names:[],note:'Selected-repository list does not apply until policy is selected.'};
  })
});
const set=defineGithubWrite({
  name:'github_copilot_agent_repo_set',area:'copilot',audience:['O'],
  description:'Enable or disable an owned repository for Copilot cloud agent with real GitHub readback and metered-cost notice.',
  properties:{owner:OWNER,repositoryId:REPOID,enable:{type:'boolean'}},
  required:['repositoryId','enable'],
  declarations:{production:'always',confirm:'always',accessWidening:true,profiles:['full']},
  target,
  read:async(a,c,t)=>{
    const client=await org(c,t);
    if(await policy(client,t)!=='selected')
      throw refusal('Choose the selected-repositories Copilot agent policy before changing membership.');
    const repo=(await client.request('GET /repositories/{repository_id}',{
      repository_id:a.repositoryId})).data;
    if(repo?.id!==a.repositoryId||repo.owner?.login?.toLowerCase()!==t.owner.toLowerCase())
      throw refusal('Repository ID was not proven to belong to the selected organization.');
    const previous=await selected(client,t);
    return {repo_id:repo.id,full_name:repo.full_name,included:previous.ids.includes(repo.id)};
  },
  classify:({args:a,before:b})=>a.enable&&!b.included
    ?{production:'enables Copilot agent in a repository',
      accessWidening:'Copilot cloud agent receives repository execution access',
      spendUnknown:true}
    :{production:'disables Copilot agent or preserves existing permission'},
  summarize:({args:a,before:b})=>(a.enable?'Enable':'Disable')+
    ' Copilot cloud agent in '+b.full_name+' (today '+(b.included?'enabled':'disabled')+')'+
    (a.enable?'; metered cloud-agent usage may incur charges with no guaranteed maximum':''),
  apply:async({args:a,ctx,target:t,before:b})=>{
    if(a.enable===b.included)throw refusal('Repository policy already matches.');
    return (await ghFor(ctx,t)).request((a.enable?'PUT ':'DELETE ')+
      base+'/repositories/{repository_id}',{org:t.owner,repository_id:a.repositoryId});
  },
  readAfter:async({ctx,target:t})=>selected(await ghFor(ctx,t),t),
  verify:({args:a,after:x})=>!!x&&x.ids.includes(a.repositoryId)===a.enable,
  inverse:()=>null,
  present:({args:a,before:b})=>({repository:b.full_name,enabled:a.enable,
    metered_warning:a.enable?'GitHub can charge for future cloud-agent usage; no total guarantee':null})
});
export const tools=[list.tool,set.tool];
export const handlers={ [list.tool.name]:list.handler,[set.tool.name]:set.handler };
