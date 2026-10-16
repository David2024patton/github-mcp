import {describe,expect,it} from 'vitest';
import {EXECUTABLE_SCENARIOS,scenarioObjectLimits} from '../../src/dev/scenarios.js';
import {assertScenarioResourceBounds} from '../../src/dev/scenario-ownership.js';
import {SEEDABLE} from '../../src/tools/dev-seed-write.js';

const OWNER='example-org',REPO='fixture';
const record=(type,i=0)=>({object_type:type,object_id:`${type}-${i}`,owner:OWNER,repo:REPO});
const verify=(name,objects)=>
  assertScenarioResourceBounds({run:{scenarios:[name]},objects,owner:OWNER,repo:REPO});

describe('finite exact V-1 scenario ownership bounds for V-2 deletion',()=>{
  it('uses the exact executor allowlist rather than interpreting any plan as executable',()=>{
    expect(EXECUTABLE_SCENARIOS).toEqual(SEEDABLE);
    expect(EXECUTABLE_SCENARIOS).toContain('webhook-target');
    expect(()=>verify('unknown',[record('repo')])).toThrow();
    expect(()=>assertScenarioResourceBounds({
      run:{scenarios:['repo-basic','release-train']},owner:OWNER,repo:REPO,
      objects:[record('repo')]})).toThrow();
  });
  for(const name of EXECUTABLE_SCENARIOS){
    it(`accepts complete ${name} counts and its partial repo-only prefix, rejects every excess type`,()=>{
      const caps=scenarioObjectLimits(name);
      const all=Object.entries(caps).flatMap(([type,max])=>
        Array.from({length:max},(_,i)=>record(type,i)));
      expect(()=>verify(name,all)).not.toThrow();
      expect(()=>verify(name,[record('repo')])).not.toThrow();
      for(const type of Object.keys(caps)){
        if(type==='repo')continue;
        expect(()=>verify(name,[...all,record(type,100)])).toThrow(/limit/i);
      }
      expect(()=>verify(name,[...all,record('unplanned')])).toThrow(/non-scenario/i);
    });
  }
  it('holds webhook-target to its one planned webhook and lets other scenarios carry up to three test webhooks',()=>{
    const hooks=n=>Array.from({length:n},(_,i)=>record('webhook',i));
    expect(()=>verify('repo-basic',[record('repo'),...hooks(3)])).not.toThrow();
    expect(()=>verify('repo-basic',[record('repo'),...hooks(4)])).toThrow(/limit/i);
    expect(()=>verify('webhook-target',[record('repo'),record('forwarder'),...hooks(2)])).toThrow(/limit/i);
  });
  it('does not silently accept foreign scope, unsupported objects or an absent root',()=>{
    expect(()=>verify('repo-basic',[])).toThrow(/repository/i);
    expect(()=>verify('repo-basic',[{...record('repo'),owner:'other'}])).toThrow(/foreign/i);
    expect(()=>verify('repo-basic',[{...record('repo'),repo:'other'}])).toThrow(/foreign/i);
    expect(()=>verify('repo-basic',[record('repo'),record('repo',1)])).toThrow(/limit/i);
    expect(()=>verify('repo-basic',[record('repo'),record('issue')])).toThrow(/non-scenario/i);
  });
});
