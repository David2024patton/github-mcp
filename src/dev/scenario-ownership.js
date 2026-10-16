// V-1/V-2 finite resource bound: a journalled object is not automatically
// authorized merely because it is in a private run-marked repository.
// Partial seeds are allowed up to the exact type counts of their scenario;
// non-executable plans and extra resource types always refuse teardown.
import {EXECUTABLE_SCENARIOS,scenarioObjectLimits} from './scenarios.js';
import {refusal} from '../tools/github-write.js';

export const MAX_TEST_WEBHOOKS=3;
// A scenario that plans its own webhook (webhook-target) is held to exactly that; every other scenario may carry up to three test webhooks.
export const webhookLimit=(scenario)=>scenarioObjectLimits(scenario).webhook??MAX_TEST_WEBHOOKS;

export function assertScenarioResourceBounds({run,objects,owner,repo}) {
  if(!run||!Array.isArray(run.scenarios)||run.scenarios.length!==1||
    !EXECUTABLE_SCENARIOS.includes(run.scenarios[0])||
    !Array.isArray(objects)||!owner||!repo)
    throw refusal('Scratch run has no single supported executable scenario; cleanup refused.');
  // V-4 test webhooks may be added to any executable scenario's scratch repository (at most three).
  const limits={...scenarioObjectLimits(run.scenarios[0])};
  limits.webhook=webhookLimit(run.scenarios[0]);
  const counts=Object.create(null);
  for(const item of objects) {
    if(!item||item.owner?.toLowerCase()!==owner.toLowerCase()||
      item.repo!==repo||typeof item.object_id!=='string'||!item.object_id||
      !Object.hasOwn(limits,item.object_type))
      throw refusal('Scratch run contains a foreign or non-scenario object; cleanup refused.');
    counts[item.object_type]=(counts[item.object_type]??0)+1;
    if(counts[item.object_type]>limits[item.object_type])
      throw refusal('Scratch run exceeds its finite scenario resource limit; cleanup refused.');
  }
  if(counts.repo!==1)
    throw refusal('Scratch run lacks exactly one recorded repository; cleanup refused.');
}
