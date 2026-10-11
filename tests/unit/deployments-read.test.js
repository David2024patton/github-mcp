import { describe, it, expect } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const LIST = 'GET /repos/{owner}/{repo}/deployments';
const STATUSES = 'GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses';
const deployment = { id: 42, ref: 'feature/read', sha: '0123456789abcdef', environment: 'staging', task: 'deploy',
  created_at: '2026-10-10T00:00:00Z', production_environment: false, creator: { login: 'builder' } };
const latest = { id: 13, state: 'success', description: 'Ready',
  created_at: '2026-10-11T00:00:00Z', environment_url: 'https://example.com' };
async function run(w, args) {
  const dispatch = createDispatch({ credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now });
  return parse(await dispatch({ registry, name: 'github_deploy_list', args, connection: w.connection, db: w.db }));
}
const world = () => makeWorld({ profile: 'read_only' });

describe('G-4 deployment reads', () => {
  it('filters deployments, returns the latest status and reports possible next page without mutations', async () => {
    const w = await world();
    w.gh.when(LIST).reply(200, [deployment]);
    w.gh.when(STATUSES).reply(200, [latest]);
    const result = await run(w, { repo: 'hello', ref: 'feature/read', environment: 'staging', max: 1 });
    expect(result).toMatchObject({ count: 1, page: 1, next_page_possible: 2,
      items: [{ id: 42, environment: 'staging', latest_status: { state: 'success', id: 13 } }] });
    expect(w.gh.calls[0].query).toMatchObject({ ref: 'feature/read', environment: 'staging', per_page: '1', page: '1' });
    expect(w.gh.calls[1].query).toMatchObject({ per_page: '1', page: '1' });
    expect(w.gh.calls.every((c) => c.method === 'GET')).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });

  it('preserves no-status as null without inventing a successful deployment', async () => {
    const w = await world();
    w.gh.when(LIST).reply(200, [deployment]);
    w.gh.when(STATUSES).reply(200, []);
    const result = await run(w, { repo: 'hello' });
    expect(result.items[0].latest_status).toBeNull();
    expect(result.next_page_possible).toBeUndefined();
    expect(w.gh.invalid).toEqual([]);
  });

  it('allows skipping status reads without changing the list query', async () => {
    const w = await world();
    w.gh.when(LIST).reply(200, [deployment]);
    const result = await run(w, { repo: 'hello', includeLatestStatus: false });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].latest_status).toBeNull();
    expect(w.gh.calls).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });

  it('reports GitHub permission failure rather than showing an empty list', async () => {
    const w = await world();
    w.gh.when(LIST).reply(403, { message: 'Forbidden' });
    const dispatch = createDispatch({ credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now });
    const result = await dispatch({ registry, name: 'github_deploy_list', args: { repo: 'hello' },
      connection: w.connection, db: w.db });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/GitHub|permission|access|forbidden/i);
    expect(w.gh.calls.every((c) => c.method === 'GET')).toBe(true);
  });
});
