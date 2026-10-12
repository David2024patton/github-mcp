// V-1 evidence-only progress classification. Never infer remote GitHub success from a ledger.
import {listScenarioBlueprints} from './scenarios.js';

const sizes=new Map(listScenarioBlueprints().map(x=>[x.name,x.planned_object_count]));
const paired=(objects,intents)=>objects.every(o=>intents.some(i=>
  i.status==='recorded'&&i.object_type===o.object_type&&i.object_id===o.object_id&&
  i.owner===o.owner&&(i.repo??null)===(o.repo??null)));
export function summarizeDevProgress({run,objects,intents,limit,moreMayExist}){
  if(!run||!Array.isArray(objects)||!Array.isArray(intents)||
    !Number.isInteger(limit)||limit<1||limit>50)
    throw new TypeError('Bounded scoped run, objects and intents are required.');
  const scenarios=run.scenarios??[];
  const expected=scenarios.length===1?sizes.get(scenarios[0]):undefined;
  const uncertain=intents.filter(i=>i.status==='uncertain').map(i=>i.step_id);
  const claimed=intents.filter(i=>i.status==='claimed').map(i=>i.step_id);
  const recorded=intents.filter(i=>i.status==='recorded');
  const cleaned=objects.filter(x=>x.cleaned===true).length;
  const completePage=moreMayExist!==true&&objects.length<limit&&intents.length<limit;
  const hasExactPairs=completePage&&recorded.length===objects.length&&paired(objects,intents);
  let state,next;
  if(uncertain.length){
    state='reconciliation_required';
    next='Inspect uncertain step IDs and exact GitHub objects; never rerun a failed mutation blindly.';
  }else if(claimed.length){
    state='pending_claims';
    next='Inspect claimed steps; do not start a second writer while their outcome is unknown.';
  }else if(!completePage){
    state='incomplete_listing';
    next=limit<50?'Request max: 50 to inspect the full ledger.':
      'The 50-row cap prevents complete evidence; do not infer success.';
  }else if(expected===undefined){
    state='unknown_scenario';
    next='Review the original scenario contract before interpreting object rows.';
  }else if(cleaned||!hasExactPairs||objects.length>expected){
    state='identity_review_required';
    next='Inspect recorded step/object identities and cleanup flags before resuming.';
  }else if(objects.length===expected){
    state='recorded_complete';
    next='All expected IDs have durable matching intents; live GitHub acceptance is still unverified.';
  }else{
    state='partial';
    next='Inspect the last recorded step and prerequisites; resume only through safe claimed-step replay.';
  }
  return {state,scenario:scenarios.length===1?scenarios[0]:null,
    expected_object_count:expected??null,listed_object_count:objects.length,
    recorded_intent_count:recorded.length,uncertain_steps:uncertain,
    claimed_steps:claimed,cleaned_object_count:cleaned,
    missing_object_count:completePage&&expected!==undefined?Math.max(0,expected-objects.length):null,
    ledger_identities_match:hasExactPairs,listing_complete:completePage,
    live_acceptance_verified:false,next_action:next};
}
