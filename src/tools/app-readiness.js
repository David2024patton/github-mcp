// P-2: one honest readiness assessment, optionally one owner-approved guarded fix.
// The only mutation path is dispatching an existing write tool back through the
// service dispatcher: profile, production, protected resources, spending,
// request journal and independent provider readback remain mandatory.
import {validateProjectProfile,APP_READINESS_IDS} from '../data/profile-schema.js';
import {inspectReadiness} from './app-readiness-observe.js';

const fields={
  project:{type:'string',minLength:3,maxLength:64,pattern:'^[a-z][a-z0-9-]+$'},
  spec:{type:'object',additionalProperties:true},
  repository:{type:'string',minLength:3,maxLength:140,
    pattern:'^[A-Za-z0-9-]+/[A-Za-z0-9_.-]+$'},
  fixRow:{type:'string',enum:APP_READINESS_IDS},
  fixFeature:{type:'string',enum:['secret_scanning','secret_scanning_push_protection']},
  confirm:{type:'boolean'},dryRun:{type:'boolean'},
  requestKey:{type:'string',minLength:4,maxLength:128}
};
const out=(body,isError=false)=>({structuredContent:body,
  content:[{type:'text',text:JSON.stringify(body)}],...(isError?{isError:true}:{})});
const no=(message)=>out({done:false,status:'refused',error:message},true);
const counts=rows=>Object.fromEntries(['done','fixed','needs_attention','not_readable',
  'needs_you','needs_decision'].map(s=>[s,rows.filter(r=>r.status===s).length]));
const ownerOf=slug=>slug.split('/')[0];
const repoOf=slug=>slug.split('/')[1];
const errText=(r)=>r?.structuredContent?.error??r?.content?.[0]?.text??'No provider readback.';

async function loadProject(a,ctx){
  if(!!a.project===!!a.spec)
    throw new TypeError('Give exactly one stored project ID or a complete inline validated policy spec.');
  const profile=a.spec?validateProjectProfile(a.spec):
    (await ctx.db.getKnownProject(a.project))?.profile;
  if(!profile)throw new TypeError('Project profile not found. Use github_profile_list or provide an inline spec.');
  const requested=a.repository?.toLowerCase()??profile.repos[0];
  if(!profile.repos.some(x=>x.toLowerCase()===requested))
    throw new TypeError('Requested repository does not belong to this exact project profile.');
  const owner=ownerOf(requested),repo=repoOf(requested);
  if(!ctx.connection.accounts.some(x=>x.toLowerCase()===owner.toLowerCase()))
    throw new TypeError('That project is not in this connection’s authorized GitHub accounts.');
  return {profile,owner,repo,requested};
}
async function run(a,ctx){
  let scope;
  try{scope=await loadProject(a,ctx);}
  catch(e){return no(e.message);}
  const {profile,owner,repo,requested}=scope;
  let first;
  try{first=await inspectReadiness(ctx,owner,repo,profile);}
  catch{return no('Readiness evidence could not be collected; no changes were attempted.');}
  const rows=first.rows;
  const baseline={project:profile.id,source:profile.source,
    policy_version:profile.schemaVersion,scope:requested,
    inspected_at:new Date(ctx.now()).toISOString(),rows,
    summary:counts(rows),all_done:rows.every(x=>x.status==='done'),
    note:'Runtime process and plan-limited observations are not marked done without evidence. All changes use normal write guards.'};
  if(!a.fixRow)return out(baseline);
  if(!ctx.callTool)return no('The guarded write dispatcher is not available; no change was attempted.');
  if(a.fixFeature&&a.fixRow!=='G15')return no('fixFeature applies only to G15 security-feature changes.');
  const key=a.fixRow==='G15'?a.fixRow+':'+(a.fixFeature??''):a.fixRow;
  if(a.fixRow==='G15'&&!a.fixFeature)
    return out({...baseline,done:false,status:'needs_choice',
      next:'Choose exactly one missing security feature (secret_scanning or secret_scanning_push_protection).'});
  const candidate=first.fixes.get(key);
  if(!candidate)
    return out({...baseline,done:false,status:'not_fixable',
      next:'This check is healthy, unreadable, or requires guided owner/provider resolution. No write was sent.'});
  if(!['G2','G3','G4','G15','G16','G17'].includes(a.fixRow))
    return no('This row is not an approved automatic repair; source workflows and owned refs are never edited.');
  // Exactly ONE predeclared underlying guarded mutation for one selected row.
  // The caller must explicitly confirm; no blanket automatic remediation.
  const selected={...candidate.args,confirm:a.confirm===true,
    dryRun:a.dryRun===true,
    ...(a.requestKey?{requestKey:a.requestKey}:{})};
  const underlying=await ctx.callTool(candidate.tool,selected);
  const mutation=underlying.structuredContent??null;
  if(!mutation||mutation.status!=='applied')
    return out({...baseline,done:false,status:'fix_not_applied',
      attempted:{id:a.fixRow,tool:candidate.tool,status:mutation?.status??'error',
        confirmation_required:mutation?.needsConfirmation===true,
        explanation:errText(underlying)},
      note:'Underlying guarded tool refused, previewed, or did not prove its readback. No repair is claimed.'});
  let updated;
  try{updated=await inspectReadiness(ctx,owner,repo,profile);}
  catch{return out({...baseline,done:false,status:'unconfirmed',
    attempted:{id:a.fixRow,tool:candidate.tool,status:'provider_write_applied'},
    warning:'Independent readiness re-observation failed; do not claim row fixed.'});}
  const current=updated.rows.find(r=>r.id===a.fixRow);
  // Some fixes are partial (e.g. G15 requires two independently confirmed
  // protections). Report the changed item without claiming the whole row done.
  const fixed=current?.status==='done';
  const finalRows=updated.rows.map(r=>
    r.id===a.fixRow&&fixed?{...r,status:'fixed'}:r);
  return out({...baseline,rows:finalRows,summary:counts(finalRows),
    all_done:finalRows.every(x=>x.status==='done'||x.status==='fixed'),
    done:fixed,status:fixed?'fixed':'partial_fix',
    attempted:{id:a.fixRow,tool:candidate.tool,verified_underlying:true,
      readback_status:current?.status??'not_readable'},
    ...(fixed?{}:{warning:'The single confirmed change may have applied, but the entire check is not yet satisfied.'})});
}

const tool={
  name:'github_workflow_app_readiness',area:'workflow',audience:['B','O'],
  description:'Check G1-G20 readiness for a stored or inline project; optionally confirm one guarded fix with provider readback.',
  usesRegistry:true,passthrough:true,
  delegatedWrites:['github_ruleset_save','github_repo_update_settings',
    'github_security_set_feature','github_actions_set_settings'],
  inputSchema:{type:'object',properties:fields,additionalProperties:false},
  annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true}
};
export const tools=[tool];
export const handlers={[tool.name]:run};
