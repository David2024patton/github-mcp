import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { REFUSED_MUTATIONS, WRITE_SPECS } from '../../src/github/graphql-writes.js';
import { buildCapabilityInventory, COVERED_BY_TOOL, STATES } from '../../src/github/capability-inventory.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const MUTATION = (name, type) => `mutation M($input: ${type}!){ ${name}(input:$input){ clientMutationId } }`;
const run = (w, args) => createDispatch({ env: w.ctx.env, credentials: w.credentials, gates: w.ctx.gates, fetch: w.gh.fetch, now: w.ctx.now, sleep: w.ctx.sleep })
  .call(null, { registry, name: 'github_graphql_write', args, connection: w.connection, db: w.db }).then(parse);
const world = () => makeWorld({ profile: 'full', mode: 'production', advanceClockOnSleep: true });
const sent = (gh) => gh.calls.filter((c) => /^\s*mutation\b/.test(c.body?.query ?? ''));

describe('GQL-1 Projects v2 coverage', () => {
  it('every covered mutation is mapped to a tool that exists, and the inventory counts it as covered', () => {
    const names = new Set(registry.tools.map((t) => t.name));
    for (const [mutation, tool] of COVERED_BY_TOOL) expect(names.has(tool), `${mutation} -> ${tool}`).toBe(true);
    const inv = buildCapabilityInventory({ registryTools: registry.tools });
    for (const m of ['createProjectV2', 'deleteProjectV2', 'updateProjectV2', 'copyProjectV2', 'addProjectV2ItemById', 'linkProjectV2ToRepository']) {
      const row = inv.operations.find((r) => r.interface === 'graphql' && r.operation?.field === m);
      expect(row.state, m).toBe('implemented-unverified');
      expect(row.implementation.tool).toBe(COVERED_BY_TOOL.get(m));
    }
  });

  it('the two refused mutations say why and send nothing', async () => {
    expect([...REFUSED_MUTATIONS.keys()].sort()).toEqual(['createProjectV2IssueField', 'updateProjectV2Collaborators']);
    for (const [name, type, input] of [['updateProjectV2Collaborators', 'UpdateProjectV2CollaboratorsInput', { projectId: 'P1', collaborators: [] }],
      ['createProjectV2IssueField', 'CreateProjectV2IssueFieldInput', { projectId: 'P1', issueFieldId: 'F1' }]]) {
      const w = await world();
      const out = await run(w, { mutation: MUTATION(name, type), variables: { input }, owner: 'example-org', confirm: true })
        .catch((e) => ({ status: 'error', message: String(e?.message ?? e) }));
      expect(out.status).not.toBe('applied');
      expect(JSON.stringify(out)).toMatch(/refused on purpose/);
      expect(sent(w.gh)).toHaveLength(0);
    }
  });

  it('a refused mutation has no write spec, and the inventory lists it as refused-by-design with its reason', () => {
    expect(STATES).toContain('refused-by-design');
    for (const name of REFUSED_MUTATIONS.keys()) expect(WRITE_SPECS.has(name)).toBe(false);
    const inv = buildCapabilityInventory({ registryTools: registry.tools });
    const rows = inv.operations.filter((r) => r.state === 'refused-by-design');
    expect(rows.map((r) => r.operation.field).sort()).toEqual(['createProjectV2IssueField', 'updateProjectV2Collaborators']);
    for (const r of rows) expect(r.implementation.reason.length).toBeGreaterThan(20);
    const project = inv.operations.filter((r) => r.interface === 'graphql' && r.operation?.root === 'mutation' && /ProjectV2/.test(r.operation.field));
    expect(project.filter((r) => r.state === 'missing')).toEqual([]);
  });
});
