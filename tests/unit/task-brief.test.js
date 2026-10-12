import { describe, expect, it } from 'vitest';
import { buildTaskBrief } from '../../scripts/task-brief.mjs';
const index={cards:[{id:'V-1',title:'Scenario foundation',status:'IN_PROGRESS',
  dependencies:['G-6'],ownerInputs:['IN-06'],design:'docs/designs/BATCH-V.md',card:'docs/pr-cards/V-1.md'}]};
describe('bounded task brief',()=>{
  it('uses the work index and only concrete paths named in the card',()=>{
    const s=buildTaskBrief(index,'V-1','Read `src/dev/ledger.js` and `tests/unit/dev-ledger.test.js`.');
    expect(s).toContain('V-1 — Scenario foundation');
    expect(s).toContain('IN-06');expect(s).toContain('src/dev/ledger.js');
    expect(s).toContain('Exact-head ci');
    expect(s.split('\n').length).toBeLessThanOrEqual(11);
  });
  it('rejects unknown cards and untrusted arbitrary card IDs',()=>{
    expect(()=>buildTaskBrief(index,'../../secret')).toThrow(/card ID/);
    expect(()=>buildTaskBrief(index,'V-9')).toThrow(/Unknown/);
  });
});
