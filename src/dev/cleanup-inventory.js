// V-2 reverse reconciliation: names, tags and markers never grant deletion
// authority. This only *denies* deletion when a durable object is missing from
// an independently complete and validated remote collection.
import { refusal } from '../tools/github-write.js';

const TYPES=Object.freeze(['branch','pr','issue','tag','release','ruleset','webhook']);

export function assertScratchJournalCoverage({owner,repo,objects,live}) {
  if(typeof owner!=='string'||!owner||typeof repo!=='string'||!repo||
    !Array.isArray(objects)||!live||typeof live!=='object')
    throw refusal('Scratch journal or remote inventory is unavailable; deletion refused.');
  for(const type of TYPES) {
    const ids=live[type];
    if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!id)||
      new Set(ids).size!==ids.length)
      throw refusal('Scratch remote inventory is malformed, ambiguous or incomplete; deletion refused.');
    const tracked=objects.filter(x=>x.object_type===type);
    if(tracked.some(x=>x?.owner?.toLowerCase()!==owner.toLowerCase()||
      x.repo!==repo||x.cleaned===true||
      typeof x.object_id!=='string'||!x.object_id))
      throw refusal('Scratch journal contains foreign, already-cleaned or invalid resource evidence.');
    const found=new Set(ids);
    if(tracked.length!==found.size||
      tracked.some(x=>!found.has(x.object_id)))
      throw refusal('A recorded scratch resource is missing from the complete remote inventory; deletion refused.');
  }
}
