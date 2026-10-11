import { describe, it, expect } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const R = { repo: 'hello' };
const ONE = 'GET /repos/{owner}/{repo}/environments/{environment_name}';
const LIST = 'GET /repos/{owner}/{repo}/environments';
const POLICIES = 'GET /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies';
const SECRET = 'GET /repos/{owner}/{repo}/environments/{environment_name}/secrets';
const VAR = 'GET /repos/{owner}/{repo}/environments/{environment_name}/variables';
const simple = { id: 4, name: 'staging', created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-02T00:00:00Z', protection_rules: [], deployment_branch_policy: null };
const rich = { ...simple, deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  protection_rules: [
    { id: 1, type: 'wait_timer', wait_timer: 30 },
    { id: 2, type: 'required_reviewers', prevent_self_review: true,
      reviewers: [{ type: 'User', reviewer: { id: 11, login: 'safety' } }, { type: 'Team', reviewer: { id: 20, slug: 'ops' } }] },
    { id: 3, type: 'custom', app: { slug: 'a' } }
  ] };
async function run(w, name, args) {
  const call = createDispatch({ credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now });
  return parse(await call({ registry, name, args, connection: w.connection, db: w.db }));
}
const world = () => makeWorld({ profile: 'read_only' });

describe('G-4 environment reads', () => {
  it('lists environments with actual total, protection and next page', async () => {
    const w = await world();
    w.gh.when(LIST).reply(200, { total_count: 3, environments: [simple] });
    const result = await run(w, 'github_env_list', { ...R, page: 1, max: 1 });
    expect(result).toMatchObject({ count: 1, total_count: 3, next_page: 2 });
    expect(result.items[0]).toMatchObject({ name: 'staging', protection: { wait_timer: 0, reviewers: [] } });
    expect(w.gh.calls[0].query).toMatchObject({ per_page: '1', page: '1' });
    expect(w.gh.invalid).toEqual([]);
  });

  it('counts only metadata, and reports permission denied as unknown rather than zero', async () => {
    const w = await world();
    w.gh.when(LIST).reply(200, { total_count: 1, environments: [simple] });
    w.gh.when(SECRET).reply(200, { total_count: 2, secrets: [] });
    w.gh.when(VAR).reply(403, { message: 'Forbidden' });
    const result = await run(w, 'github_env_list', { ...R, includeCounts: true });
    expect(result.items[0]).toMatchObject({ secrets: { count: 2 }, variables: { count: null, unavailable: 403 } });
    expect(JSON.stringify(result)).not.toMatch(/encrypted_value|secret value|password/i);
    expect(w.gh.invalid).toEqual([]);
  });

  it('gets reviewers and branch/tag patterns without flattening custom protection away', async () => {
    const w = await world();
    w.gh.when(ONE).reply(200, rich);
    w.gh.when(POLICIES).reply(200, { total_count: 2, branch_policies: [
      { id: 5, name: 'release/*', type: 'branch' }, { id: 6, name: 'v*', type: 'tag' }
    ] });
    const result = await run(w, 'github_env_get', { ...R, environment: 'staging' });
    expect(result.protection).toMatchObject({ wait_timer: 30, prevent_self_review: true,
      reviewers: [{ type: 'User', id: 11 }, { type: 'Team', id: 20 }], custom_protection_rules: [{ id: 3, type: 'custom' }] });
    expect(result.branch_policies.items).toEqual([{ id: 5, name: 'release/*', type: 'branch' }, { id: 6, name: 'v*', type: 'tag' }]);
    expect(w.gh.invalid).toEqual([]);
  });

  it('has an explicit missing state, but does not hide a real access error', async () => {
    const no = await world();
    no.gh.when(ONE).reply(404, { message: 'Not found' });
    expect(await run(no, 'github_env_get', { ...R, environment: 'absent' })).toMatchObject({ not_found: 'absent' });
    const forbidden = await world();
    forbidden.gh.when(ONE).reply(403, { message: 'Forbidden' });
    const res = await run(forbidden, 'github_env_get', { ...R, environment: 'production' });
    expect(res.not_found).toBeUndefined();
    expect(res.error).toBeDefined();
  });
});
