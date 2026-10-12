import {describe,expect,it} from 'vitest';
import {assertScratchJournalCoverage} from '../../src/dev/cleanup-inventory.js';

const OWNER='example-org',REPO='fixture';
const ids={
  branch:[`rtc/run-fixture-001/test`],pr:['101'],issue:['202'],
  tag:['v0.1.0'],release:['301'],ruleset:['401']
};
const tracked=Object.entries(ids).flatMap(([type,values])=>
  values.map(id=>({object_type:type,object_id:id,owner:OWNER,repo:REPO,cleaned:false})));
const verify=(objects=tracked,live=ids)=>
  assertScratchJournalCoverage({owner:OWNER,repo:REPO,objects,live});

describe('scratch pre-delete two-way durable inventory proof',()=>{
  it('accepts a one-to-one exact tracked remote inventory, including the empty scenario',()=>{
    expect(()=>verify()).not.toThrow();
    expect(()=>verify([],
      {branch:[],pr:[],issue:[],tag:[],release:[],ruleset:[]})).not.toThrow();
  });
  for(const type of Object.keys(ids)){
    it(`refuses a missing journaled ${type} even if every listed object is owned`,()=>{
      const remote={...ids,[type]:[]};
      expect(()=>verify(tracked,remote)).toThrow(/missing|journal/i);
    });
    it(`refuses a foreign or duplicate remote ${type}`,()=>{
      expect(()=>verify(tracked,{...ids,[type]:[...ids[type],'foreign']})).toThrow();
      expect(()=>verify(tracked,{...ids,[type]:[...ids[type],...ids[type]]})).toThrow();
    });
  }
  it('fails closed on omitted or denied inventory, not an inferred empty list',()=>{
    const missing={...ids};
    delete missing.ruleset;
    expect(()=>verify(tracked,missing)).toThrow();
    expect(()=>verify(tracked,{...ids,pr:null})).toThrow();
  });
  it('refuses a journal object associated with another repository or owner',()=>{
    expect(()=>verify([{...tracked[0],repo:'another'},...tracked.slice(1)])).toThrow(/foreign/i);
    expect(()=>verify([{...tracked[0],owner:'other-org'},...tracked.slice(1)])).toThrow(/foreign/i);
  });
  it('refuses already-cleaned objects still appearing remotely',()=>{
    expect(()=>verify([{...tracked[0],cleaned:true},...tracked.slice(1)])).toThrow(/already-cleaned/i);
  });
  it('does not normalize case, convert numeric IDs or use run markers as authority',()=>{
    expect(()=>verify([{...tracked[1],object_id:'0101'},...tracked.filter((_,i)=>i!==1)])).toThrow(/missing/i);
    expect(()=>verify(tracked,{...ids,tag:['V0.1.0']})).toThrow(/missing/i);
  });
});
