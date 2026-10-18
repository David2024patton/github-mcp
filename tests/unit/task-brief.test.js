import { describe, expect, it } from 'vitest';
import { buildTaskBrief } from '../../scripts/task-brief.mjs';
const index={cards:[{id:'V-1',title:'Scenario foundation',status:'IN_PROGRESS',
  dependencies:['G-6'],ownerInputs:['IN-06'],design:'docs/designs/BATCH-V.md',card:'docs/pr-cards/V-1.md'},
  {id:'PUB-1',title:'Tenant foundation',status:'APPROVED',dependencies:['Y-9'],ownerInputs:[],design:'docs/designs/PUBLIC-SCALE.md',card:'docs/pr-cards/PUB-1.md'}]};
describe('bounded task brief',()=>{
  it('uses the work index and only concrete paths named in the card',()=>{
    const s=buildTaskBrief(index,'V-1','Read `src/dev/ledger.js` and `tests/unit/dev-ledger.test.js`.');
    expect(s).toContain('V-1 — Scenario foundation');
    expect(s).toContain('IN-06');expect(s).toContain('src/dev/ledger.js');
    expect(s).toContain('Exact-head ci');
    expect(s.split('\n').length).toBeLessThanOrEqual(11);
  });
  it('briefs a registered multi-letter PUB card without demanding a pre-existing JIT file',()=>{
    const s=buildTaskBrief(index,'PUB-1');
    expect(s).toContain('Card: PUB-1 — Tenant foundation');
    expect(s).toContain('Status: APPROVED');
    expect(s).toContain('JIT, draft from current code');
    expect(s).toContain('docs/designs/PUBLIC-SCALE.md');
  });
  it('rejects unknown cards and untrusted arbitrary card IDs',()=>{
    expect(()=>buildTaskBrief(index,'../../secret')).toThrow(/card ID/);
    expect(()=>buildTaskBrief(index,'V-9')).toThrow(/Unknown/);
    expect(()=>buildTaskBrief(index,'pub-1')).toThrow(/card ID/);
    expect(()=>buildTaskBrief(index,'P'.repeat(20)+'-1')).toThrow(/card ID/);
  });
});
