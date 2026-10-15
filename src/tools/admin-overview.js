// O-1: honest owner account overview and security review from live GitHub.
// Each signal has its own provenance and status; a denied/partial provider read
// cannot silently become "all clear". No account mutation, spend or credential echo.
import {listAll} from '../github/client.js';
import {defineRead} from './define-read.js';
import {plain,readerFor} from './github-read.js';

const OWNER={type:'string',maxLength:39};
const MAX={type:'integer',minimum:1,maximum:20};
const ok=(id,area,value,detail)=>({id,area,status:'ok',value,...(detail?{detail}:{})});
const attention=(id,area,detail,value=null)=>({id,area,status:'needs_attention',detail,value});
const unreadable=(id,area,reason='GitHub did not grant access to this exact status')=>({
  id,area,status:'not_readable',reason});
const unavailable=(id,area,plan,detail)=>({
  id,area,status:'not_available_on_plan',plan:plan??'unknown',detail});
const providerError=e=>Number.isInteger(e?.status)?'GitHub returned HTTP '+e.status:
  'GitHub did not return a readable result';
const push=(items,item)=>{items.push(item);return item;};
const areaName='owner';
const summarize=(items)=>Object.fromEntries(
  ['ok','needs_attention','not_readable','not_available_on_plan'].map(status=>[
    status,items.filter(x=>x.status===status).length]));
const canAct=(ctx,owner)=>ctx.connection.accounts.some(x=>
  String(x).toLowerCase()===String(owner).toLowerCase());
const getAccount=async(ctx,owner)=>{
  if(!canAct(ctx,owner))throw new TypeError('This account is not enrolled in the connection.');
  return await ctx.db.getAccount(owner);
};
const attempt=async(items,id,area,task,interpret)=>{
  try{push(items,interpret(await task()));}
  catch(e){push(items,unreadable(id,area,providerError(e)));}
};
async function overview(a,ctx){
  const owner=a.owner??ctx.connection.default_account;
  const row=await getAccount(ctx,owner);
  if(!row)throw new TypeError('This GitHub account is not enrolled on the server.');
  const items=[];
  const local=Object.freeze({
    account:row.login,credential_kind:row.credential_kind,
    installation_status:row.installation_status??null,
    production_enabled:row.production_enabled===true,
    spend_limit_cents:Number(row.spend_limit_cents) || 0,
    is_scratch:row.is_scratch===true
  });
  push(items,local.production_enabled?
    attention('server-production',areaName,'Production is enabled for this account',true):
    ok('server-production',areaName,false,'Production stays off'));
  push(items,ok('server-spend',areaName,{
    limit_cents:local.spend_limit_cents,spend_enabled:local.spend_limit_cents>0
  },local.spend_limit_cents?'Spending ceiling has been configured':'Autonomous spending is $0'));
  if(row.account_type!=='Organization'){
    push(items,unreadable('organization-profile','org',
      'This enrolled account is a user, not an organization; use personal-account tools for its profile.'));
    push(items,unreadable('personal-status','personal',
      'Personal settings require a separately authorized user credential, not an App installation.'));
    return {owner,account_type:row.account_type,server:local,
      status:'partial',checks:items,summary:summarize(items)};
  }
  const {octokit:gh}=await readerFor({owner},ctx),org={org:owner};
  let plan=null;
  await attempt(items,'organization-profile','org',
    ()=>gh.request('GET /orgs/{org}',org).then(x=>x.data),data=>{
      plan=data?.plan?.name??null;
      if(!data?.login||data.login.toLowerCase()!==owner.toLowerCase())
        throw new TypeError('Organization identity did not match enrolled account.');
      return data.name&&data.description?
        ok('organization-profile','org',{name:data.name,description:data.description}):
        attention('organization-profile','org',
          'Organization name or description is incomplete');
    });
  if(plan)push(items,ok('organization-plan','org',plan));
  else push(items,unreadable('organization-plan','org','GitHub did not expose a readable organization plan.'));
  const orgData=await gh.request('GET /orgs/{org}',org).then(x=>x.data,()=>null);
  if(typeof orgData?.two_factor_requirement_enabled==='boolean'){
    push(items,orgData.two_factor_requirement_enabled?ok('require-2fa','security',true):
      attention('require-2fa','security','Organization does not require two-factor authentication',false));
  }else push(items,unreadable('require-2fa','security','2FA requirement was not included in the authorized org response.'));
  if(typeof orgData?.default_repository_permission==='string'){
    const v=orgData.default_repository_permission;
    push(items,['admin','write'].includes(v)?
      attention('default-repo-permission','access',
        'Default repository permission may be broader than necessary',v):
      ok('default-repo-permission','access',v));
  }else push(items,unreadable('default-repo-permission','access'));
  if(/enterprise/i.test(plan??'')){
    push(items,unreadable('sso','security','Enterprise SSO configuration needs its separately scoped API.'));
    push(items,unreadable('audit-log','security','Audit log requires separately authorized administration read.'));
  }else{
    push(items,unavailable('sso','security',plan,'SAML SSO requires eligible GitHub plan.'));
    push(items,unavailable('audit-log','security',plan,
      'Enterprise audit log endpoint may not be supported on this plan.'));
  }
  const bounded=(route,params,max=100)=>listAll(gh,'GET '+route,
    {...params,per_page:100},{max});
  await attempt(items,'owners','access',
    ()=>bounded('/orgs/{org}/members',{...org,role:'admin'}),
    r=>r.capped?unreadable('owners','access','Owner list was truncated'):
      r.items.length?ok('owners','access',{count:r.items.length,
        logins:r.items.map(x=>x.login).slice(0,10)}):
        attention('owners','access','No organization owners were returned; verify owner authorization'));
  await attempt(items,'members-without-2fa','security',
    ()=>bounded('/orgs/{org}/members',{...org,filter:'2fa_disabled'}),
    r=>r.capped?unreadable('members-without-2fa','security','2FA enrollment inventory capped'):
      r.items.length?attention('members-without-2fa','security',
        'Some members do not have two-factor authentication enabled',r.items.length):
        ok('members-without-2fa','security',0));
  await attempt(items,'outside-collaborators','access',
    ()=>bounded('/orgs/{org}/outside_collaborators',org),
    r=>r.capped?unreadable('outside-collaborators','access','Outside collaborator inventory capped'):
      r.items.length?attention('outside-collaborators','access',
        'Review outside collaborators and their repository grants',r.items.length):
        ok('outside-collaborators','access',0));
  await attempt(items,'pending-invitations','access',
    ()=>bounded('/orgs/{org}/invitations',org),
    r=>r.capped?unreadable('pending-invitations','access','Invitations inventory capped'):
      r.items.length?attention('pending-invitations','access',
        'Review pending invitations',r.items.length):ok('pending-invitations','access',0));
  const cap=a.maxRepositories??10;
  let repos=null;
  try{repos=await bounded('/orgs/{org}/repos',{...org,type:'all'},cap);}
  catch(e){push(items,unreadable('repo-inventory','security',providerError(e)));}
  if(repos){
    push(items,repos.capped?unreadable('repo-inventory','security',
      'Repository sample is capped; no all-repository safety claim is possible'):
      ok('repo-inventory','security',{count:repos.items.length,complete:true}));
    const security=[],actions=[],writeKeys=[];
    for(const r of repos.items){
      const target={owner:owner,repo:r.name};
      try{
        const d=(await gh.request('GET /repos/{owner}/{repo}',target)).data;
        security.push({repo:r.name,
          secret_scanning:d.security_and_analysis?.secret_scanning?.status??null,
          push_protection:d.security_and_analysis?.secret_scanning_push_protection?.status??null,
          dependabot:d.security_and_analysis?.dependabot_security_updates?.status??null});
      }catch{security.push({repo:r.name,unreadable:true});}
      try{
        const d=(await gh.request('GET /repos/{owner}/{repo}/actions/permissions/workflow',target)).data;
        actions.push({repo:r.name,default_token:d.default_workflow_permissions??null,
          can_approve_pr:d.can_approve_pull_request_reviews??null});
      }catch{actions.push({repo:r.name,unreadable:true});}
      try{
        const ks=await bounded('/repos/{owner}/{repo}/keys',target,100);
        writeKeys.push({repo:r.name,unreadable:ks.capped,
          write:ks.items.filter(k=>k.read_only===false).length});
      }catch{writeKeys.push({repo:r.name,unreadable:true});}
    }
    const complete=!repos.capped&&security.every(x=>!x.unreadable&&
      x.secret_scanning!==null&&x.push_protection!==null&&x.dependabot!==null);
    if(!complete)push(items,unreadable('security-feature-coverage','security',
      'One or more repository security flags were unreadable or inventory incomplete'));
    else{
      const unsafe=security.filter(x=>x.secret_scanning!=='enabled'||
        x.push_protection!=='enabled'||x.dependabot!=='enabled');
      push(items,unsafe.length?attention('security-feature-coverage','security',
        'Some repositories lack one or more security protections',
        unsafe.slice(0,15)):ok('security-feature-coverage','security',
          {checked:security.length}));
    }
    const actionsComplete=!repos.capped&&actions.every(x=>!x.unreadable&&
      x.default_token!==null);
    if(!actionsComplete)push(items,unreadable('actions-token-rights','security',
      'Actions permission reads were incomplete'));
    else{
      const broad=actions.filter(x=>x.default_token==='write'||x.can_approve_pr===true);
      push(items,broad.length?attention('actions-token-rights','security',
        'Some workflows have write or pull-request approval privileges',broad):
        ok('actions-token-rights','security',{checked:actions.length}));
    }
    const keysComplete=!repos.capped&&writeKeys.every(x=>!x.unreadable);
    if(!keysComplete)push(items,unreadable('write-capable-deploy-keys','security',
      'Deploy key inventory incomplete'));
    else{
      const unsafe=writeKeys.filter(x=>x.write>0);
      push(items,unsafe.length?attention('write-capable-deploy-keys','security',
        'Write-capable SSH deploy keys need periodic access review',unsafe):
        ok('write-capable-deploy-keys','security',{checked:writeKeys.length}));
    }
  }
  await attempt(items,'installed-apps','access',
    ()=>gh.request('GET /orgs/{org}/installations',org).then(x=>x.data),
    r=>Number.isInteger(r?.total_count)?
      ok('installed-apps','access',{count:r.total_count}):
      unreadable('installed-apps','access','App installation inventory incomplete'));
  await attempt(items,'token-requests','access',
    ()=>bounded('/orgs/{org}/personal-access-token-requests',org),
    r=>r.capped?unreadable('token-requests','access','Token requests capped'):
      r.items.length?attention('token-requests','access',
        'Fine-grained token requests need approval',r.items.length):
        ok('token-requests','access',0));
  push(items,unreadable('billing-usage','money',
    'A billing-scoped organization permission is needed; no $ amount is inferred.'));
  push(items,unreadable('personal-account','personal',
    'Personal account requires a separate user-authorized token, not this organization installation.'));
  return {owner,account_type:'Organization',plan,
    checked_repositories:repos?.items.length??0,
    repo_inventory_complete:repos?!repos.capped:false,
    server:local,summary:summarize(items),checks:items,
    note:'Unreadable and plan-limited checks are never counted as passing. Owner review is required before changing settings.'};
}
const PROPS={owner:OWNER,maxRepositories:MAX};
export const adminOverview=defineRead({
  name:'github_admin_overview',area:'admin',audience:['O'],
  description:'Report organization security, access, plan and server ownership checks with explicit missing and plan-limited statuses.',
  properties:PROPS,
  handler:(a,ctx)=>plain(()=>overview(a,ctx))
});
export const securityReview=defineRead({
  name:'github_admin_review_security',area:'admin',audience:['O'],
  description:'Review checked organization security risks without calling unreadable or plan-restricted settings safe.',
  properties:PROPS,
  handler:(a,ctx)=>plain(async()=>{
    const result=await overview(a,ctx);
    const wanted=new Set(['security','access']);
    const checks=result.checks.filter(x=>wanted.has(x.area));
    return {owner:result.owner,plan:result.plan??null,
      checked_repositories:result.checked_repositories??0,
      repo_inventory_complete:result.repo_inventory_complete??false,
      summary:summarize(checks),checks,
      priority_actions:checks.filter(x=>x.status==='needs_attention')
        .slice(0,10).map(x=>({check:x.id,reason:x.detail})),
      note:'These are findings, not changes. Unreadable settings require separate investigation.'};
  })
});
export const tools=[adminOverview.tool,securityReview.tool];
export const handlers=Object.fromEntries([
  [adminOverview.tool,adminOverview.handler],
  [securityReview.tool,securityReview.handler]
].map(([t,h])=>[t.name,h]));
