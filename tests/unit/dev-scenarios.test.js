import { describe, expect, it } from 'vitest';
import { listScenarioBlueprints, planScenario } from '../../src/dev/scenarios.js';
describe('V-1 deterministic scenario planning',()=>{
  it('covers every approved named scenario with a complete ordered object plan',()=>{
    const plans=listScenarioBlueprints();
    expect(plans.map(p=>p.name)).toEqual(['repo-basic','failing-ci','pr-with-threads','stack-of-three','release-train','protected-main','webhook-target']);
    for(const p of plans){
      const plan=planScenario(p.name,{runId:'run-a123',owner:'example-org',repo:'scratch-repo',scratch:true});
      expect(plan.plan_only).toBe(true);
      expect(plan.objects).toHaveLength(p.planned_object_count);
      for(let i=1;i<plan.objects.length;i++)expect(plan.objects[i].depends_on).toBe(plan.objects[i-1].id);
    }
  });
  it('refuses unknown names and scratch-only plans on unverified accounts',()=>{
    expect(()=>planScenario('repo-basic',{runId:'run-a123',owner:'example-org',repo:'hello'})).toThrow(/scratch account/);
    expect(()=>planScenario('arbitrary',{runId:'run-a123',owner:'example-org',repo:'hello',scratch:true})).toThrow(/Unknown/);
    expect(()=>planScenario('stack-of-three',{runId:'bad ID',owner:'example-org',repo:'hello'})).toThrow(/Run ID/);
  });
  it('tags all planned objects but performs no external operations',()=>{
    const p=planScenario('stack-of-three',{runId:'run-a123',owner:'example-org',repo:'hello'});
    expect(p.tag).toBe('rtc-run-run-a123');
    expect(p.objects.every(o=>o.marker.includes('run-a123'))).toBe(true);
  });
});
