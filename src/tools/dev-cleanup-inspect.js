// V-2 read-only remote cleanup rehearsal. No freeze, closing PRs or DELETE.
import {defineRead} from './define-read.js';
import {ownerOf,octo,refusal} from './github-write.js';
import {readCleanupRun,inspectScratchArtifacts} from '../dev/cleanup-execute.js';

const OWNER={type:'string',maxLength:39};
const REPO={type:'string',minLength:1,maxLength:100,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$'};
const RUN={type:'string',minLength:3,maxLength:43,pattern:'^[a-z][a-z0-9-]{2,42}$'};

function reasonCode(error) {
  const s=String(error?.message??'').toLowerCase();
  if(/unrecorded or ambiguous label|recorded scratch labels|label was repurposed/.test(s))
    return 'LABEL_PROVENANCE_UNVERIFIED';
  if(/inventory|capped|pagination|truncated|incomplete|total_count/.test(s))
    return 'INCOMPLETE_REMOTE_INVENTORY';
  if(/permission|forbidden|unauthoriz|access denied/.test(s))
    return 'REMOTE_PERMISSION_DENIED';
  if(/default branch|commit|head|sha|moved|retarget/.test(s))
    return 'REMOTE_STATE_CHANGED';
  if(/foreign|unrecorded|not exact|mismatch|replaced|repurposed/.test(s))
    return 'FOREIGN_OR_CHANGED_RESOURCE';
  return 'REMOTE_PREFLIGHT_REFUSED';
}
export function cleanupPreflightResult({runId,owner,repo,phase,blocker=null,snapshot=null}) {
  return {
    run_id:runId,owner,repo,phase,
    status:blocker?'blocked':'remote_snapshot_accepted',
    blocker_code:blocker?reasonCode(blocker):null,
    blocker_detail:blocker&&blocker.status===422?String(blocker.message).slice(0,300):null,
    ...(snapshot?{inventory_counts:{
      branches:snapshot.branch_count,pull_requests:snapshot.pr_count,
      issues:snapshot.issue_count,tags:snapshot.tag_count,
      releases:snapshot.release_count,rulesets:snapshot.ruleset_count,
      labels:snapshot.label_count,workflows:snapshot.workflow_count}}:{}),
    deletion_authorized:false,destructive_operations_performed:false,
    persistent_cleanup_freeze:false,snapshot_atomic:false,
    connected_acceptance_proven:false,
    next_action:blocker
      ? 'Resolve this precise inventory or ownership refusal; inspect the unchanged run and remote resources. No deletion was attempted.'
      : 'Fresh independent preflights, current owner consent, and the guarded cleanup write are STILL required before any deletion.'
  };
}

const inspect=defineRead({
  name:'github_dev_inspect_cleanup',area:'dev',audience:['B'],
  description:'Read current remote scratch cleanup blockers without freezing runs or deleting anything.',
  properties:{owner:OWNER,repo:REPO,runId:RUN},required:['repo','runId'],
  handler:async(args,ctx)=>{
    if(ctx.connection?.mode!=='preview')
      throw new TypeError('Developer cleanup inspection is preview-only.');
    const requested=ownerOf(args,ctx);
    const owner=ctx.connection?.accounts?.find(a=>a.toLowerCase()===requested.toLowerCase());
    if(!owner)throw new TypeError('This account is not in your connection.');
    const base={runId:args.runId,owner,repo:args.repo};
    let state;
    try{
      // Same scoped journal, exact repo and scratch-org checks as destructive
      // cleanup. Never hold an open-world GitHub read error to mean "empty".
      state=await readCleanupRun(ctx,owner,args.repo,args.runId);
    }catch(error){
      if(error?.status===422||error instanceof TypeError)
        return cleanupPreflightResult({...base,phase:'journal_or_scope',blocker:error});
      throw error;
    }
    if(!state.deleteRepository) {
      // readCleanupRun itself already performed independent standalone resource
      // checks. This read does not acquire the freeze or reserve write authority.
      return cleanupPreflightResult({...base,phase:'standalone_resources'});
    }
    if(!state.existing)
      return cleanupPreflightResult({...base,phase:'repository_absent',blocker:
        refusal('Exact scratch repository is missing; reconcile the journal and remote state.')});
    const github=await octo(ctx,owner);
    try{
      const snapshot=await inspectScratchArtifacts(github,{
        owner,repo:args.repo,run:state.run,objects:state.objects,
        defaultBranch:state.existing.default_branch
      });
      return cleanupPreflightResult({...base,phase:'scratch_remote_inventory',snapshot});
    }catch(error){
      if(error?.status===422||error instanceof TypeError)
        return cleanupPreflightResult({...base,phase:'scratch_remote_inventory',blocker:error});
      throw error;
    }
  }
});
export const tools=[inspect.tool];
export const handlers={[inspect.tool.name]:inspect.handler};
