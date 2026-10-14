// Container disposal consent is distinct from provenance of individual labels.
import {summarizeScratchBirth} from './birth-report.js';
import {compareObservedScratchLabels} from './label-drift.js';
import {refusal} from '../tools/github-write.js';

export function baselineScratchLabels({run,objects,intents,birth,owner,repo,labels,savedLabels}) {
  // Legacy runs retain strict recorded-label-only cleanup; never adopt a later read.
  if(!birth)return new Set();
  const report=summarizeScratchBirth({run,objects,intents,birth,
    listingComplete:objects.length<50&&intents.length<50});
  if(!report.journal_binding_verified||birth.owner.toLowerCase()!==owner.toLowerCase()||birth.repo!==repo)
    throw refusal('Scratch birth label baseline has no exact complete creation journal binding.');
  const names=new Set(birth.labels.map(x=>x.name));
  if(savedLabels.some(x=>names.has(x.object_id)))
    throw refusal('Scratch birth labels overlap recorded run labels; ambiguous label ownership.');
  // Remove only separately journaled fixture labels from the comparison. The
  // caller still verifies every fixture label and refuses any other addition.
  const fixtureNames=new Set(savedLabels.map(x=>x.object_id));
  const delta=compareObservedScratchLabels(birth.labels,labels.filter(x=>!fixtureNames.has(x.name)));
  if(!delta.exact_observation_unchanged)
    throw refusal('Scratch repository contains an unrecorded or ambiguous label, or changed birth labels; deletion refused.');
  return names;
}
