// C-6 reproducible read-only scheduling benchmark: fake GitHub/MCP transport.
// Outputs synthetic critical-path timing, never measured production latency.
import { performance } from 'node:perf_hooks';
import { handlers as open } from '../src/tools/workflows-pr.js';
import { handlers as merge } from '../src/tools/workflows-merge.js';

const WAIT=25,COUNT=5,SHA='a'.repeat(40);
const pause=()=>new Promise(resolve=>setTimeout(resolve,WAIT));
const observe=async fn=>{const start=performance.now();await fn();return +(performance.now()-start).toFixed(2);};
const median=async fn=>{const times=[];for(let i=0;i<COUNT;i++)times.push(await observe(fn));return times.sort((a,b)=>a-b)[2];};
const ready=(number,merged=false)=>({number,state:merged?'closed':'open',merged,draft:false,head:'feat-'+number,head_sha:SHA,base:'main',mergeable:true,
  threads:{unresolved:0},review_decision:'APPROVED',checks:{green:true,items:[{state:'success'}]}});
const wrap=x=>({structuredContent:x});
const context=(allMerged=false)=>{
  let merged=allMerged;
  return {connection:{profile:'full',default_account:'example-org'},now:Date.now,
    async callTool(name,args){
      await pause();
      if(name==='github_repo_get')return wrap({default_branch:'main'});
      if(name==='github_pr_list')return wrap({items:[],count:0});
      if(name==='github_pr_get')return wrap(ready(args.number,merged));
      if(name==='github_pr_create')return wrap({done:true,status:'applied',result:{number:7,head_sha:SHA,base:'main'}});
      if(name==='github_pr_merge'){merged=true;return wrap({status:'applied'});}
      throw new Error('Unexpected synthetic ' + name);
    }
  };
};
const oldOpen=async()=>{const c=context();await c.callTool('github_repo_get');await c.callTool('github_pr_list');await c.callTool('github_pr_create');};
const newOpen=async()=>{const z=(await open.github_workflow_open_pr({repo:'r',head:'feat',title:'T'},context())).structuredContent;if(!z.done)throw new Error('PR not observed');};
const oldMerge=async()=>{const c=context();await c.callTool('github_pr_get',{number:4});await c.callTool('github_repo_get');await c.callTool('github_pr_merge');await c.callTool('github_pr_get',{number:4});};
const newMerge=async()=>{const z=(await merge.github_workflow_merge_when_green({repo:'r',number:4,expectedHeadSha:SHA},context())).structuredContent;if(!z.done)throw new Error('Merge not verified');};
const oldStack=async()=>{const c=context(true);await c.callTool('github_repo_get');for(let n=1;n<=6;n++)await c.callTool('github_pr_get',{number:n});};
const newStack=async()=>{const z=(await merge.github_workflow_merge_stack({repo:'r',prs:[1,2,3,4,5,6]},context(true))).structuredContent;if(!z.done)throw new Error('Stack not observed');};
const rows=[];
for(const [name,serial,optimized] of [['openPr',oldOpen,newOpen],['mergeOne',oldMerge,newMerge],['stackReadSix',oldStack,newStack]]){
  const serialControlMedianMs=await median(serial),optimizedMedianMs=await median(optimized);
  rows.push({name,serialControlMedianMs,optimizedMedianMs,reductionPercent:+((1-optimizedMedianMs/serialControlMedianMs)*100).toFixed(1)});
}
console.log(JSON.stringify({benchmark:'C-6 synthetic PR conveyor',fakeReadMs:WAIT,repetitions:COUNT,rows,
  caveat:'Fake delays and mocked guarded outcomes; measures workflow scheduling only, not live GitHub, actual credentials, network, or total developer time.'},null,2));
