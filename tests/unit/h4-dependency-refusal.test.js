import { describe, expect, it } from 'vitest';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';

const route = 'GET /repos/{owner}/{repo}/dependency-graph/compare/{basehead}';
const run = async (w) => {
  const result = await createDispatch({
    env: w.ctx.env, credentials: w.credentials, gates: [],
    fetch: w.gh.fetch, now: w.ctx.now, sleep: async () => {}
  })({
    registry, name: 'github_security_compare_dependencies',
    args: { owner: 'example-org', repo: 'hello', base: 'abc123', head: 'def456' },
    connection: w.connection, db: w.db
  });
  let body; try { body = parse(result); }
  catch { body = { message: result.content?.[0]?.text }; }
  return { result, body };
};

describe('H-4 dependency review refuses honestly without product authority loss', () => {
  it('passes a legitimate provider dependency comparison without writes', async () => {
    const w = await makeWorld({ mode: 'preview', profile: 'full' });
    w.gh.when(route).reply(200, [{ change_type: 'added', manifest: 'package.json', ecosystem: 'npm',
      name: 'dep', version: '1', license: 'MIT', vulnerabilities: [] }]);
    const out = await run(w);
    expect(out.body).toMatchObject({ count: 1, complete: true,
      changes: [{ change_type: 'added', package: 'dep' }] });
    expect(w.gh.calls.every(c => c.method === 'GET')).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });

  it('does not claim a missing App permission proves missing plan entitlement', async () => {
    const w = await makeWorld({ mode: 'preview', profile: 'full' });
    w.gh.when(route).reply(403, { message: 'Resource not accessible by integration' });
    const out = await run(w);
    expect(out.result.isError).toBe(true);
    expect(JSON.stringify(out)).toMatch(/not allowed|permission|integration/i);
    expect(JSON.stringify(out)).not.toMatch(/not_available_on_plan|requires eligible Code Security/);
    expect(w.gh.calls.every(c => c.method === 'GET')).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });

  it('leaves ambiguous provider plan-or-policy refusal undecided and preserves no-write safety', async () => {
    const w = await makeWorld({ mode: 'preview', profile: 'full' });
    w.gh.when(route).reply(403, { message: 'Forbidden' });
    const out = await run(w);
    expect(out.result.isError).toBe(true);
    expect(JSON.stringify(out)).not.toContain('not_available_on_plan');
    expect(w.gh.calls.every(c => c.method === 'GET')).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
});
