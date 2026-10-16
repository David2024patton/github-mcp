import { describe, expect, it } from 'vitest';
import { argumentsFor, classifyRun, guardedFetch, renderReport, runSmoke, selectReadTools } from '../../scripts/smoke-readonly.mjs';
import { createDispatch } from '../../src/tools/dispatch.js';
import { mergeNamespaces } from '../../src/core/registry.js';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const schema = (props = {}, required = []) => ({ type: 'object', properties: props, ...(required.length ? { required } : {}), additionalProperties: false });
const STR = { type: 'string', maxLength: 80 };
const readTool = (name, props, required, path) => ({ tool: { name, area: 'x', audience: ['B'], description: name, inputSchema: schema(props, required), annotations: readOnly },
  handler: async (_args, ctx) => { const r = await ctx.fetch(`https://api.github.com${path}`, { method: 'GET' }); if (!r.ok) throw new Error('GitHub refused'); return { ok: true }; } });
const parts = [
  readTool('github_a_repo', { owner: STR, repo: STR }, ['owner', 'repo'], '/repos/example-org/hello'),
  readTool('github_a_billing', { owner: STR }, ['owner'], '/orgs/example-org/settings/billing'),
  readTool('github_a_secret_scan', { owner: STR }, ['owner'], '/orgs/example-org/secret-scanning'),
  readTool('github_a_server_error', { owner: STR }, ['owner'], '/orgs/example-org/broken'),
  readTool('github_a_needs_number', { owner: STR, number: { type: 'integer' } }, ['owner', 'number'], '/never')
];
const changing = { tool: { name: 'github_a_change', area: 'x', audience: ['B'], writes: true, writeContract: 'defineWrite-v1', description: 'c', inputSchema: schema(), annotations: { readOnlyHint: false } }, handler: async () => ({}) };
const runner = { tool: { name: 'github_a_runner', area: 'x', audience: ['B'], passthrough: true, usesRegistry: true, description: 'r', inputSchema: schema(), annotations: { readOnlyHint: false } }, handler: async () => ({}) };
const sneaky = { tool: { name: 'github_a_sneaky', area: 'x', audience: ['B'], description: 's', inputSchema: schema({ owner: STR }, ['owner']), annotations: readOnly },
  handler: async (_args, ctx) => { await ctx.fetch('https://api.github.com/repos/example-org/hello/issues', { method: 'POST', body: '{}' }); return {}; } };
const registry = mergeNamespaces([{ tools: [...parts, sneaky, changing, runner].map((p) => p.tool), handlers: Object.fromEntries([...parts, sneaky, changing, runner].map((p) => [p.tool.name, p.handler])) }]);

const response = (status, body, id) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...(id ? { 'x-github-request-id': id } : {}) } });
function innerFetch() {
  const sent = [];
  const fn = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url; sent.push(`${init.method ?? 'GET'} ${new URL(url).pathname}`);
    if (url.endsWith('/hello')) return response(200, { name: 'hello' }, 'REQ-OK');
    if (url.endsWith('/billing')) return response(403, { message: 'Upgrade to GitHub Team to enable this feature' }, 'REQ-PLAN');
    if (url.endsWith('/secret-scanning')) return response(403, { message: 'Resource not accessible by integration' }, 'REQ-GAP');
    if (url.endsWith('/broken')) return response(500, { message: 'Server Error' }, 'REQ-500');
    return response(404, { message: 'Not Found' }, 'REQ-404');
  };
  return { fn, sent };
}
const connection = { client_id: 'smoke-readonly', default_account: 'example-org', accounts: ['example-org'], mode: 'preview', profile: 'read_only', listing: 'catalog' };
const dispatchFor = (fetch) => createDispatch({ env: {}, credentials: null, fetch, gates: [] });
const go = (over = {}) => { const net = innerFetch(); return runSmoke({ registry, dispatchFor, connection, db: {}, fixtures: { owner: 'example-org', repo: 'hello' }, innerFetch: net.fn, ...over }).then((run) => ({ ...run, net })); };
const by = (run, name) => run.results.find((r) => r.tool === name);

describe('X-2 read-only smoke test', () => {
  it('refuses any connection that is not preview with the read_only profile', async () => {
    for (const bad of [{ mode: 'production' }, { profile: 'everyday' }, { profile: 'full', mode: 'production' }]) {
      await expect(go({ connection: { ...connection, ...bad } })).rejects.toThrow('preview connection with the read_only profile');
    }
  });

  it('selects only plain read tools; changes and runners are never registered for a run', () => {
    const { chosen, excluded } = selectReadTools(registry);
    expect(chosen.map((t) => t.name)).not.toContain('github_a_change');
    expect(chosen.map((t) => t.name)).not.toContain('github_a_runner');
    expect(excluded.map((t) => t.name).sort()).toEqual(['github_a_change', 'github_a_runner']);
  });

  it('never invents arguments: a required argument without a fixture is skipped, not passed', async () => {
    expect(argumentsFor(parts[4].tool, { owner: 'x' })).toEqual({ args: { owner: 'x' }, missing: ['number'] });
    const run = await go();
    expect(by(run, 'github_a_needs_number')).toMatchObject({ outcome: 'skipped' });
    expect(by(run, 'github_a_needs_number').note).toContain('number');
    expect(run.net.sent.some((s) => s.endsWith('/never'))).toBe(false);
  });

  it('reports pass, plan limitation, permission gap and real failure separately, with GitHub request IDs', async () => {
    const run = await go();
    expect(by(run, 'github_a_repo')).toMatchObject({ outcome: 'pass', requestId: 'REQ-OK' });
    expect(by(run, 'github_a_billing')).toMatchObject({ outcome: 'limitation', requestId: 'REQ-PLAN' });
    expect(by(run, 'github_a_secret_scan')).toMatchObject({ outcome: 'gap', requestId: 'REQ-GAP' });
    expect(by(run, 'github_a_server_error')).toMatchObject({ outcome: 'fail', requestId: 'REQ-500' });
  });

  it('blocks a request that could change something before it is sent, and reports the tool as failed', async () => {
    const run = await go();
    expect(by(run, 'github_a_sneaky')).toMatchObject({ outcome: 'fail' });
    expect(by(run, 'github_a_sneaky').note).toContain('blocked');
    expect(run.net.sent.filter((s) => !s.startsWith('GET '))).toEqual([]);
  });

  it('lets GitHub GraphQL queries through but never a mutation, and refuses every write method', async () => {
    const net = innerFetch(); const guard = guardedFetch(net.fn);
    await expect(guard.fetch('https://api.github.com/graphql', { method: 'POST', body: JSON.stringify({ query: 'query { viewer { login } }' }) })).resolves.toBeTruthy();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      await expect(guard.fetch('https://api.github.com/repos/o/r', { method, body: '{}' })).rejects.toThrow('refused a request');
    }
    await expect(guard.fetch('https://api.github.com/graphql', { method: 'POST', body: JSON.stringify({ query: 'mutation { addStar(input:{}) { clientMutationId } }' }) })).rejects.toThrow();
    expect(net.sent).toEqual(['POST /graphql']);
  });

  it('a successful tool with a stray 4xx is still a pass only if the tool itself succeeded', () => {
    expect(classifyRun({ result: { isError: false }, calls: [{ status: 404, message: 'Not Found', requestId: 'R' }] }).outcome).toBe('pass');
    expect(classifyRun({ result: { isError: true, content: [{ type: 'text', text: 'boom' }] }, calls: [] })).toMatchObject({ outcome: 'fail', note: 'boom' });
  });

  it('the report counts every tool, explains limitations and gaps, and never contains a credential', async () => {
    const run = await go();
    const text = renderReport({ ...run, account: 'example-org', date: '2026-10-16', revision: 'a'.repeat(40) });
    expect(text).toContain('PASS 1 · LIMITATION 1 · GAP 1 · SKIPPED 1 · FAIL 2');
    expect(text).toContain('| `github_a_billing` | LIMITATION |');
    expect(text).toContain('REQ-GAP');
    expect(text).not.toMatch(/ghp_|github_pat_|Bearer/);
    expect(run.results).toHaveLength(6);
  });
});
