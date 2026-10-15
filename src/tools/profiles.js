// P-1: scoped read-only access to persisted versioned project profiles.
// Optional profiles are separate from GitHub API credentials and never grant privileges.
import { defineRead } from './define-read.js';
import { plain } from './github-read.js';
import { validateProjectProfile } from '../data/profile-schema.js';

const ID={type:'string',minLength:3,maxLength:64,pattern:'^[a-z][a-z0-9-]+$'};
const LIMIT={type:'integer',minimum:1,maximum:100};
const ensureDb=(c)=>{
  if(!c.db||typeof c.db.listKnownProjects!=='function'||
    typeof c.db.getKnownProject!=='function')
    throw new TypeError('The project profile store is unavailable.');
  return c.db;
};
const safe=(p)=>({id:p.id,name:p.name,status:p.status,version:p.version,
  repos:p.profile.repos,production_branches:p.profile.productionBranches,
  production_environments:p.profile.productionEnvironments,
  owned_ref_count:p.profile.ownedRefs.length,
  readiness_checks:p.profile.readiness.length,
  source:p.profile.source,updated_at:p.updated_at});
const list=defineRead({
  name:'github_profile_list',area:'profile',audience:['B','O'],
  description:'List versioned optional project policies, their repositories, source evidence, production refs and readiness coverage.',
  properties:{max:LIMIT,status:{type:'string',enum:['active','draft','retired']}},
  handler:(a,c)=>plain(async()=>{
    const all=await ensureDb(c).listKnownProjects();
    const rows=all.filter(p=>!a.status||p.status===a.status);
    return {profiles:rows.slice(0,a.max??100).map(safe),
      count:rows.length,complete:rows.length<=(a.max??100),
      policy_version:1,note:'Profiles strengthen protections only. They are not credentials or owner approval.'};
  })
});
const get=defineRead({
  name:'github_profile_get',area:'profile',audience:['B','O'],
  description:'Inspect an exact persisted versioned project policy with all workflow ownership and safety rules.',
  properties:{project:ID},required:['project'],
  handler:(a,c)=>plain(async()=>{
    const entry=await ensureDb(c).getKnownProject(a.project);
    if(!entry)throw new TypeError('No profile exists for that project ID.');
    return {id:entry.id,version:entry.version,status:entry.status,
      profile:validateProjectProfile(entry.profile),updated_at:entry.updated_at,
      policy_version:1,read_only:true};
  })
});
const all=[list,get];
export const tools=all.map(x=>x.tool);
export const handlers=Object.fromEntries(all.map(x=>[x.tool.name,x.handler]));
