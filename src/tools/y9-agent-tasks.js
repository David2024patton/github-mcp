// Y-9d Copilot cloud-agent tasks. Starting a task is metered and has no guaranteed
// maximum token/premium-request spend; expose honest read and prepared guidance.
import { defineRead } from './define-read.js';
import { plain } from './github-read.js';
import { githubFor } from '../github/client.js';
import { ownerOf, refusal } from './github-write.js';

const OWNER={type:'string',minLength:1,maxLength:39};
const REPO={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9_.-]+$'};
const TASK={type:'string',minLength:8,maxLength:100};
const PROMPT={type:'string',minLength:1,maxLength:4000};
async function actor(a,c){
  const owner=ownerOf(a,c);
  const gh=await githubFor(c,{owner,cred:'U',scope:{repositories:[a.repo]}});
  const me=(await gh.request('GET /user')).data;
  if(!me?.id||!me?.login)throw refusal('GitHub Copilot agent tasks require an enrolled user credential.');
  const repo=(await gh.request('GET /repos/{owner}/{repo}',{owner,repo:a.repo})).data;
  if(!repo||repo.full_name?.toLowerCase()!==(owner+'/'+a.repo).toLowerCase())
    throw refusal('Repository not proved to be in the selected enrolled account.');
  return {gh,owner,repository:repo.full_name};
}
const safe=x=>({id:x?.id,state:x?.state,name:x?.name,
  created_at:x?.created_at,updated_at:x?.updated_at,
  html_url:x?.html_url??null,session_count:x?.session_count??null});
const agentTasks=defineRead({
  name:'github_copilot_agent_tasks',area:'copilot',audience:['O','B','Op'],
  description:'List or inspect GitHub Copilot cloud-agent tasks using the authorized user credential; no task starts.',
  properties:{owner:OWNER,repo:REPO,taskId:TASK},
  required:['repo'],
  handler:(a,c)=>plain(async()=>{
    const {gh,owner,repository}=await actor(a,c);
    if(a.taskId){
      const data=(await gh.request('GET /agents/repos/{owner}/{repo}/tasks/{task_id}',
        {owner,repo:a.repo,task_id:a.taskId})).data;
      if(data?.id!==a.taskId)throw refusal('GitHub task identity did not match.');
      return {repository,task:safe(data)};
    }
    const response=(await gh.request('GET /agents/repos/{owner}/{repo}/tasks',
      {owner,repo:a.repo,per_page:100,page:1})).data;
    const items=Array.isArray(response)?response:response?.tasks;
    if(!Array.isArray(items))throw refusal('Task inventory unreadable.');
    return {repository,tasks:items.slice(0,100).map(safe),complete:items.length<100,
      note:items.length>=100?'Additional pages not included; do not infer a complete task inventory.':null};
  })
});
const agentTaskPlan=defineRead({
  name:'github_copilot_agent_task_plan',area:'copilot',audience:['O','B'],
  description:'Prepare a Copilot coding-agent task with exact repository scope, but refuse an unbounded AI-usage spend.',
  properties:{owner:OWNER,repo:REPO,prompt:PROMPT,baseRef:REPO,createPullRequest:{type:'boolean'}},
  required:['repo','prompt'],
  handler:(a,c)=>plain(async()=>{
    const {gh,owner,repository}=await actor(a,c);
    const d=(await gh.request('GET /repos/{owner}/{repo}',{owner,repo:a.repo})).data;
    if(a.baseRef){
      const branch=(await gh.request('GET /repos/{owner}/{repo}/branches/{branch}',
        {owner,repo:a.repo,branch:a.baseRef})).data;
      if(!branch?.commit?.sha)throw refusal('Requested task base branch not independently verified.');
    }
    if(d.archived||d.disabled)throw refusal('Task repository is archived or disabled.');
    return {status:'guided',completed:false,repository,prompt_summary:a.prompt.slice(0,100),
      base_ref:a.baseRef??d.default_branch,create_pull_request:a.createPullRequest===true,
      reason:'GitHub premium AI usage and task duration have no finite provable ceiling for the existing account-level spend guard. An AI task was NOT created.',
      url:'https://github.com/'+encodeURIComponent(owner)+'/'+encodeURIComponent(a.repo)+'/issues',
      steps:['Review Copilot premium-request pricing and the account billing budget.','Authorize the exact task and base branch in GitHub after confirming usage limits.','Use github_copilot_agent_tasks to inspect the created task and results.']};
  })
});
export const tools=[agentTasks.tool,agentTaskPlan.tool];
export const handlers={
  [agentTasks.tool.name]:agentTasks.handler,[agentTaskPlan.tool.name]:agentTaskPlan.handler
};
