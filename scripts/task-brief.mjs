// Deterministic, bounded orientation from the authoritative work index. No network access.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
// Batch IDs may have several uppercase letters (for example PUB-1) while staying bounded.
const CARD = /^[A-Z][A-Z0-9]{0,7}-[0-9]+$/;
export function buildTaskBrief(index, cardId, source='') {
  if(!CARD.test(cardId??'')) throw new TypeError('Use an exact card ID, for example V-1 or PUB-1.');
  const row=index.cards?.find(x=>x.id===cardId);
  if(!row) throw new TypeError(`Unknown card: ${cardId}`);
  const paths=[...new Set([...source.matchAll(/`((?:src|test|tests|docs|scripts|api|packages)\/[a-zA-Z0-9_./*-]+)`/g)]
    .map(x=>x[1]))].slice(0,16);
  return [
    `Card: ${row.id} — ${row.title}`,
    `Status: ${row.status}; dependencies: ${row.dependencies.join(', ')||'none'}`,
    `Owner gates: ${row.ownerInputs.join(', ')||'none'}; never bypass`,
    'First reconcile open PRs: docs/SESSION-START.md §0',
    `Governing rules: AGENTS.md; exact design section: ${row.design}`,
    `Card: ${row.card} (${source?'present':'JIT, draft from current code'})`,
    'Execution packet: docs/implementation-contracts/IMPLEMENTATION-DETAIL.md',
    ...(paths.length?[`Relevant card paths: ${paths.join(', ')}`]:[]),
    'Focused tests/lint first; full npm run check + unit/db/shapes as applicable.',
    'Exact-head ci, self-review, open review threads and merge guards remain mandatory.'
  ].join('\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const id=process.argv[2], index=JSON.parse(readFileSync(resolve(ROOT,'docs/pr-cards/work-index.json'),'utf8'));
    const row=index.cards?.find(x=>x.id===id), path=row?.card&&resolve(ROOT,row.card);
    console.log(buildTaskBrief(index,id,path&&existsSync(path)?readFileSync(path,'utf8'):''));
  }catch(error){console.error(`Task brief: ${error.message}`);process.exitCode=1;}
}
