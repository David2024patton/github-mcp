// The actual current HTTP surface is narrower than the standalone MCP catalog.
// Share one selector between dispatch and public evidence; metadata is never a grant.
import {toolsForProfile} from '../core/registry.js';
import {areaOf} from '../core/meta.js';
export const RTC_HTTP_AREAS=Object.freeze(['server','meta']);
export function rtcHttpTools(registry){
  return toolsForProfile(registry,'read_only').filter(tool=>
    RTC_HTTP_AREAS.includes(areaOf(tool))&&tool.annotations?.readOnlyHint===true&&
    tool.writes!==true&&tool.passthrough!==true);
}
export function rtcIdentity(revision=process.env.VERCEL_GIT_COMMIT_SHA){
  const valid=typeof revision==='string'&&/^[a-f0-9]{40}$/.test(revision);
  return {server:'robinson-github-mcp',reported_revision:valid?revision:null,
    revision_source:valid?'vercel_git_commit_sha':null,
    independently_verified:false};
}
export function rtcHttpCapabilities(registry){
  return {authentication:'service_issued_pass',modes:['preview'],profiles:['read_only'],
    areas:[...RTC_HTTP_AREAS],counts:{tools:rtcHttpTools(registry).length,writes:0,money:0},
    allow_writes:false,production_access:false,money_limit_cents:0,
    full_conformance_verified:false,authenticated_acceptance_verified:false};
}
