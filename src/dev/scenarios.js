// V-1 approved scenario blueprints: deterministic object *plans*, never side effects.
import { validateRun } from './ledger.js';
const SPEC = Object.freeze({
  'repo-basic': { scratch: true, objects: [['repo','scratch-repo'],['workflow_file','ci-pass'],['label','rtc-run']] },
  'failing-ci': { scratch: true, objects: [['repo','scratch-repo'],['workflow_file','ci-fails'],['branch','failure-ref']] },
  'pr-with-threads': { scratch: true, objects: [['repo','scratch-repo'],['label','rtc-run'],['branch','review-ref'],
 ['fixture_file','review.md'],['pr','draft-review'],['pr_label','review-label'],
 ['review_comment','first-comment'],['review_thread','first-thread'],
 ['review_comment','second-comment'],['review_thread','second-thread'],
 ['review_comment','third-comment'],['review_thread','outdated-thread'],
 ['fixture_revision','review.md-revision']] },
  'stack-of-three': { scratch: true, objects: [['repo','scratch-repo'],['label','rtc-run'],
    ['branch','stack-1'],['fixture_file','stack-1.md'],['pr','draft-1'],['pr_label','draft-1-label'],
    ['branch','stack-2'],['fixture_file','stack-2.md'],['pr','draft-2'],['pr_label','draft-2-label'],
    ['branch','stack-3'],['fixture_file','stack-3.md'],['pr','draft-3'],['pr_label','draft-3-label']] },
  'release-train': { scratch: true, objects: [['repo','scratch-repo'],['tag','v0.1.0'],['tag','v0.2.0'],['tag','v0.3.0'],['release','draft-v0.3.0']] },
  'protected-main': { scratch: true, objects: [['repo','scratch-repo'],['ruleset','required-ci']] },
  'webhook-target': { scratch: true, objects: [['repo','scratch-repo'],['forwarder','target'],['webhook','test-hook']] }
});
// Every blueprint is executable; the list stays explicit so a new blueprint cannot run before its seed and cleanup exist.
export const EXECUTABLE_SCENARIOS = Object.freeze([
  'repo-basic','failing-ci','release-train','protected-main','stack-of-three','pr-with-threads','webhook-target'
]);
export function scenarioObjectLimits(name) {
  const spec=SPEC[name];
  if(!spec)throw new TypeError('Unknown development scenario.');
  const limits=Object.create(null);
  for(const [type] of spec.objects)limits[type]=(limits[type]??0)+1;
  return limits;
}
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
