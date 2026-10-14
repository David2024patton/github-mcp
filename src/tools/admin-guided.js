// O-1: trustworthy owner-facing guide discovery and exact provider readback.
// Browsing a settings page is not evidence a setting changed. Where GitHub has no
// readable API, completion requires independent owner/browser confirmation.
import {SETTINGS,MAP_STATUS,fill,findSettings} from '../data/dashboard-map.js';
import {defineRead} from './define-read.js';
import {plain,readerFor} from './github-read.js';

const OWNER={type:'string',maxLength:39},REPO={type:'string',minLength:1,maxLength:100};
const SCOPE={type:'string',enum:['repo','org','user']};
const MAX={type:'integer',minimum:1,maximum:100};
const NUM={type:'integer',minimum:0,maximum:1000};
const allowed=(ctx,owner)=>{
  const chosen=owner??ctx.connection.default_account;
  if(!ctx.connection.accounts.some(x=>x.toLowerCase()===String(chosen).toLowerCase()))
    throw new TypeError('This account is not enrolled in the active connection.');
  return chosen;
};
const guide=(s,a,owner)=>fill({
  id:s.id,setting:s.title,page:s.page,scope:s.scope,url:s.url,
  steps:s.steps.map((x,i)=>({n:i+1,...x})),expected:s.expected,
  verification:s.verifyWith??null,
  status:s.verifyWith?'can_check_with_provider':'manual_confirmation_required'
},{org:owner,user:owner,repo:a.repo});
export const listGuided=defineRead({
  name:'github_admin_list_guided_settings',area:'admin',audience:['O'],
  description:'List structured guides for GitHub owner, organization or repository dashboard settings with confirmation status.',
  properties:{owner:OWNER,repo:REPO,scope:SCOPE,max:MAX,offset:NUM,
    query:{type:'string',minLength:2,maxLength:120}},
  handler:(a,ctx)=>plain(async()=>{
    const owner=allowed(ctx,a.owner);
    if(a.repo&&!/^[a-zA-Z0-9._-]{1,100}$/.test(a.repo))
      throw new TypeError('Repository name is not valid.');
    const matches=a.query?findSettings(a.query,{max:100,scope:a.scope}):
      SETTINGS.filter(x=>!a.scope||x.scope===a.scope);
    const offset=a.offset??0,max=a.max??50;
    const page=matches.slice(offset,offset+max);
    return {owner,map:MAP_STATUS,total:matches.length,offset,
      count:page.length,complete:offset+max>=matches.length,
      settings:page.map(s=>guide(s,a,owner)),
      note:'Navigation links and manual checks are not proof of a changed setting.'};
  })
});
export const checkSetting=defineRead({
  name:'github_admin_check_setting',area:'admin',audience:['O'],
  description:'Independently read one supported organization setting from GitHub; require an observed match, never a guessed pass.',
  properties:{owner:OWNER,repo:REPO,settingId:{type:'string',minLength:3,maxLength:100},
    expectedBoolean:{type:'boolean'},expectedText:{type:'string',maxLength:120}},
  required:['settingId'],
  handler:(a,ctx)=>plain(async()=>{
    const owner=allowed(ctx,a.owner),row=SETTINGS.find(x=>x.id===a.settingId);
    if(!row)throw new TypeError('Unknown guided setting identifier.');
    if(row.scope==='repo'&&!a.repo)throw new TypeError('Repository-specific setting needs repo.');
    if(row.scope==='user')return {setting_id:a.settingId,owner,
      status:'not_readable',verified:false,
      reason:'A user-authorized credential and a current native readback are required; this setting is not proven.'};
    if(a.expectedBoolean!==undefined&&a.expectedText!==undefined)
      throw new TypeError('Choose one expected value type.');
    const {octokit:gh}=await readerFor({owner},ctx);
    let observed=null,field=null,source=null;
    if(row.id==='org-require-2fa'){
      const d=(await gh.request('GET /orgs/{org}',{org:owner})).data;
      source='GET /orgs/{org}';field='two_factor_requirement_enabled';
      if(typeof d?.two_factor_requirement_enabled==='boolean')
        observed=d.two_factor_requirement_enabled;
    }else if(row.scope==='repo'&&['repo-page-general','repo-page-topics'].includes(row.id)){
      const d=(await gh.request('GET /repos/{owner}/{repo}',{owner,repo:a.repo})).data;
      source='GET /repos/{owner}/{repo}';
      // The overview metadata is readable, but no generic page-edit completion
      // can be inferred without an exact named field and expected value.
      return {setting_id:a.settingId,owner,repo:a.repo,
        status:'manual_confirmation_required',verified:false,source,
        visible_fields:{default_branch:d.default_branch??null,
          description:d.description??null,private:d.private??null},
        reason:'Provide the exact changed setting and verify it on GitHub; a page visit alone is not a pass.'};
    }else return {setting_id:a.settingId,owner,
      ...(a.repo?{repo:a.repo}:{}),status:'manual_confirmation_required',
      verified:false,reason:'GitHub offers no approved direct readback for this specific dashboard control.'};
    if(observed===null)return {setting_id:a.settingId,owner,
      status:'not_readable',verified:false,field,source,
      reason:'GitHub did not disclose this exact setting; manual owner confirmation is still required.'};
    const expected=a.expectedBoolean??row.verifyWith?.equals;
    if(typeof expected!=='boolean')return {setting_id:a.settingId,owner,
      status:'needs_expected_value',verified:false,source,field,observed,
      reason:'Provide the expected boolean value before concluding anything.'};
    return {setting_id:a.settingId,owner,source,field,observed,expected,
      status:observed===expected?'verified':'differs',
      verified:observed===expected};
  })
});
export const tools=[listGuided.tool,checkSetting.tool];
export const handlers=Object.fromEntries([
  [listGuided.tool,listGuided.handler],[checkSetting.tool,checkSetting.handler]
].map(([t,h])=>[t.name,h]));
