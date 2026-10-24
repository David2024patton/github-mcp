import { describe, expect, it } from 'vitest';
import { registry } from '../../src/tools/index.js';
import { REFUSED_MUTATIONS, WRITE_SPECS } from '../../src/github/graphql-writes.js';
import { buildCapabilityInventory, COVERED_BY_TOOL } from '../../src/github/capability-inventory.js';

describe('GQL-1 group 3/4: repository, deployments, refusals', () => {
  it('every covered mutation points at a tool that exists, and no mutation is both covered/spec and refused', () => {
    const names = new Set(registry.tools.map((t) => t.name));
    for (const [m, tool] of COVERED_BY_TOOL) {
      expect(names.has(tool), `${m} -> ${tool}`).toBe(true);
      expect(REFUSED_MUTATIONS.has(m), `${m} covered and refused`).toBe(false);
    }
    for (const m of WRITE_SPECS.keys()) expect(REFUSED_MUTATIONS.has(m), `${m} spec and refused`).toBe(false);
  });
  it('every refusal carries a plain-English reason', () => {
    for (const [m, why] of REFUSED_MUTATIONS) expect(why.length, m).toBeGreaterThan(30);
  });
  it('only the enterprise settings mutations are still without a disposition', () => {
    const inv = buildCapabilityInventory({ registryTools: registry.tools });
    const missing = inv.operations.filter((r) => r.state === 'missing').map((r) => r.operation.field);
    expect(missing.length).toBeGreaterThan(0);
    for (const m of missing) expect(m, m).toMatch(/^updateEnterprise/);
  });
  it('topics sort before comparing and the topic undo restores the old list', () => {
    const spec = WRITE_SPECS.get('updateTopics');
    const before = { repositoryTopics: { nodes: [{ topic: { name: 'b' } }, { topic: { name: 'a' } }] } };
    expect(spec.already({ topicNames: ['a', 'b'] }, before)).toBe(true);
    expect(spec.inverse({ repositoryId: 'R1', topicNames: ['z'] }, before)).toEqual({ mutation: 'updateTopics', input: { repositoryId: 'R1', topicNames: ['a', 'b'] } });
  });
});
