// V-1 approved scenario blueprints: deterministic object *plans*, never side effects.
import { validateRun } from './ledger.js';
const SPEC = Object.freeze({
  'repo-basic': { scratch: true, objects: [['repo','scratch-repo'],['workflow_file','ci-pass'],['label','rtc-run']] },
  'failing-ci': { scratch: true, objects: [['repo','scratch-repo'],['workflow_file','ci-fails'],['branch','failure-ref']] },
  'pr-with-threads': { scratch: false, objects: [['branch','review-ref'],['pr','draft-review'],['review_thread','first'],['review_thread','second'],['review_thread','outdated']] },
  'stack-of-three': { scratch: false, objects: [['branch','stack-1'],['pr','draft-1'],['branch','stack-2'],['pr','draft-2'],['branch','stack-3'],['pr','draft-3']] },
  'release-train': { scratch: true, objects: [['repo','scratch-repo'],['tag','v0.1.0'],['tag','v0.2.0'],['tag','v0.3.0'],['release','draft-v0.3.0']] },
  'protected-main': { scratch: true, objects: [['repo','scratch-repo'],['ruleset','required-ci']] },
  'webhook-target': { scratch: true, objects: [['repo','scratch-repo'],['forwarder','target'],['webhook','test-hook']] }
});
export function listScenarioBlueprints() {
  return Object.entries(SPEC).map(([name,spec])=>({
    name, scratch_required:spec.scratch, planned_object_count:spec.objects.length,
    object_types:[...new Set(spec.objects.map(([type])=>type))]
  }));
}
export function planScenario(name,{runId,owner,repo,scratch=false}) {
  validateRun({id:runId,account:owner,connection:'planner'});
  const spec=SPEC[name];
  if(!spec) throw new TypeError('Unknown scenario.');
  if(typeof repo!=='string'||!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(repo)) throw new TypeError('A concrete repository is required.');
  if(spec.scratch&&!scratch) throw new TypeError('An owner-verified scratch account is required for this scenario.');
  const tag=`rtc-run-${runId}`;
  if(tag.length>50) throw new TypeError('GitHub topic exceeds 50 characters.');
  return { name,run_id:runId,owner,repo,tag,plan_only:true,scratch_required:spec.scratch,
    objects:spec.objects.map(([type,label],i)=>({
      id:`${runId}-${i+1}`,type,label,owner,repo,
      depends_on:i?`${runId}-${i}`:null,
      marker:type==='branch'?`rtc/${runId}/${label}`:`rtc_run=${runId}`
    }))
  };
}
