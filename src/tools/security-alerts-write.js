// H-4: bounded, confirmed security-alert resolution and re-opening.
// Only allowlisted alert metadata enters the write journal. Secret-scanning
// provider response objects may contain live credentials and are never returned.
import {defineGithubWrite} from './define-github-write.js';
import {octo,ownerOf,refusal,slug} from './github-write.js';

const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const ID={type:'integer',minimum:1};
const TYPE={type:'string',enum:['dependabot','code','secret']};
const STATE={type:'string',enum:['open','dismissed','resolved']};
const REASONS={
  dependabot:['fix_started','inaccurate','no_bandwidth','not_used','tolerable_risk'],
  code:['false positive',"won't fix",'used in tests','mitigated'],
  secret:['false_positive','wont_fix','revoked','used_in_tests']
};
const PREFIX=k=>k==='dependabot'?'dependabot/alerts':k==='code'?'code-scanning/alerts':'secret-scanning/alerts';
const target=(a,c)=>({owner:ownerOf(a,c),repo:a.repo,scope:'repo'});
const safe=a=>({
  number:a.number,state:a.state,
  reason:a.resolution??a.dismissed_reason??null,
  updated_at:a.updated_at??null,created_at:a.created_at??null
});
const get=async(ctx,t,a)=>{
  const d=(await(await octo(ctx,t.owner)).request(
    `GET /repos/{owner}/{repo}/${PREFIX(a.kind)}/{alert_number}`,{
      owner:t.owner,repo:t.repo,alert_number:a.number,
      ...(a.kind==='secret'?{hide_secret:true}:{})})).data;
  if(!d||d.number!==a.number)throw refusal('Exact security alert number could not be verified.');
  return safe(d);
};
const checkArgs=a=>{
  const desired=a.kind==='secret'?(a.state==='resolved'?'resolved':a.state):
    a.state;
  if(!['open',a.kind==='secret'?'resolved':'dismissed'].includes(desired))
    throw new TypeError('This alert kind cannot be changed to that state.');
  if(a.state==='open'&&a.reason!==undefined)
    throw new TypeError('Reopening cannot include an old dismissal/resolution reason.');
  if(a.state!=='open'&&!REASONS[a.kind].includes(a.reason))
    throw new TypeError('A dismissal needs the exact provider-supported reason for this alert kind.');
};
export const securityUpdateAlert=defineGithubWrite({
  name:'github_security_update_alert',area:'security',audience:['B','O'],
  description:'Dismiss, resolve or reopen one exact security alert with a required reason and independent safe readback.',
  properties:{owner:OWNER,repo:REPO,kind:TYPE,number:ID,state:STATE,
    reason:{type:'string',minLength:3,maxLength:40}},
  required:['repo','kind','number','state'],
  declarations:{production:'always',confirm:'always',profiles:['everyday','full']},
  target:(a,c)=>{checkArgs(a);return target(a,c);},
  read:async(a,ctx,t)=>({current:await get(ctx,t,a)}),
  classify:()=>({production:'suppresses or reopens repository security vulnerability alerts'}),
  summarize:({args:a,before:b,target:t})=>
    `Change ${a.kind} alert #${a.number} in ${slug(t.owner,t.repo)} from ${b.current.state} to ${a.state}`+
    (a.state==='open'?'':` with reason ${a.reason}`)+
    '; the underlying issue may remain exploitable after dismissal.',
  apply:({args:a,ctx,target:t,before:b})=>{
    if(b.current.state===a.state&&
      (a.state==='open'||b.current.reason===a.reason))
      throw refusal('Alert already has the requested state/reason; no edit sent.');
    const key=a.kind==='secret'?'resolution':'dismissed_reason';
    return octo(ctx,t.owner).then(gh=>gh.request(
      `PATCH /repos/{owner}/{repo}/${PREFIX(a.kind)}/{alert_number}`,{
        owner:t.owner,repo:t.repo,alert_number:a.number,state:a.state,
        ...(a.state==='open'?{}:{[key]:a.reason})
      }));
  },
  readAfter:({args:a,ctx,target:t})=>get(ctx,t,a),
  verify:({args:a,after:x})=>!!x&&x.number===a.number&&x.state===a.state&&
    (a.state==='open'||x.reason===a.reason),
  inverse:()=>null,
  present:({args:a,after:x})=>({number:a.number,kind:a.kind,
    state:x?.state??null,reason:x?.reason??null,
    warning:a.state==='open'?'Alert reopened; review mitigation status.':
      'Alert dismissed/resolved; the underlying security issue may still need mitigation.'})
});
export const tools=[securityUpdateAlert.tool];
export const handlers={[securityUpdateAlert.tool.name]:securityUpdateAlert.handler};
