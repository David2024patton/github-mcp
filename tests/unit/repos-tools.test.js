// D-1: the repository read tools and the rules of the write tools that the write contract does not cover.
import { describe, expect, it } from 'vitest';
import { tools, handlers } from '../../src/tools/repos.js';
import { createGates } from '../../src/tools/gates.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const run = (name, w, args) => Promise.resolve(handlers[name](args, w.ctx)).then((r) => (r?.content ? parse(r) : r));
const repo = (extra = {}) => ({ full_name: 'example-org/hello', name: 'hello', private: true, visibility: 'private', default_branch: 'main', archived: false, topics: ['a'], ...extra });
const REPO = 'GET /repos/{owner}/{repo}';

describe('reads', () => {
  it('lists an organization\'s repositories without the archived ones, and a user account through its own endpoint', async () => {
    const w = await makeWorld({ accounts: ['example-org', 'example-user'] });
    w.gh.when('GET /orgs/{org}/repos').reply(200, [repo(), repo({ name: 'old', archived: true })]);
    expect((await run('github_repo_list', w, { type: 'private' })).map((r) => r.name)).toEqual(['hello']);
    expect((await run('github_repo_list', w, { includeArchived: true })).length).toBe(2);
    expect(w.gh.calls[0].query).toMatchObject({ type: 'private', per_page: '30' });
    await w.db.upsertAccount({ login: 'example-user', accountId: 5, accountType: 'User', label: 'u', credentialKind: 'fine_grained' });
    await expect(run('github_repo_list', w, { owner: 'example-user', type: 'forks' })).rejects.toThrow(/user account/);
    w.gh.when('GET /users/{username}/repos').reply(200, [repo()]);
    expect((await run('github_repo_list', w, { owner: 'example-user', type: 'owner' })).length).toBe(1);
    expect(w.gh.invalid).toEqual([]);
  });

  it('refuses an account outside the connection', async () => {
    const w = await makeWorld();
    await expect(run('github_repo_list', w, { owner: 'someone-else' })).rejects.toThrow(/not one of the GitHub accounts/);
  });

  it('gets one repository with a protection summary, and says so when the rules cannot be read', async () => {
    const w = await makeWorld();
    w.gh.when(REPO).reply(200, repo({ allow_squash_merge: true, parent: { full_name: 'up/hello' } }));
    w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, [{ type: 'pull_request' }, { type: 'deletion' }]);
    const out = await run('github_repo_get', w, { repo: 'hello' });
    expect(out).toMatchObject({ full_name: 'example-org/hello', forked_from: 'up/hello', merge_options: { squash: true }, protection: { checked: true, rules: 2, kinds: ['pull_request', 'deletion'] } });
    w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(403, { message: 'no' });
    expect((await run('github_repo_get', w, { repo: 'hello' })).protection).toMatchObject({ checked: false });
    w.gh.when(REPO).reply(404, { message: 'Not Found' });
    await expect(run('github_repo_get', w, { repo: 'hello' })).rejects.toThrow(/does not exist/);
  });

  it('finds repositories one account at a time and refuses accounts that are not the connection\'s', async () => {
    const w = await makeWorld({ accounts: ['example-org', 'example-user'] });
    w.gh.when('GET /search/repositories').reply(200, { total_count: 1, items: [repo()] });
    expect((await run('github_repo_find', w, { query: 'hello topic:mcp' })).length).toBe(2);
    expect(w.gh.calls.map((c) => c.query.q)).toEqual(['hello topic:mcp user:example-org', 'hello topic:mcp user:example-user']);
    await expect(run('github_repo_find', w, { query: 'x', accounts: ['other'] })).rejects.toThrow(/not one of/);
    expect(w.gh.invalid).toEqual([]);
  });

  describe('insights', () => {
    const arrange = (gh, statsSteps) => {
      gh.when('GET /repos/{owner}/{repo}/languages').reply(200, { JavaScript: 750, CSS: 250 });
      gh.when('GET /repos/{owner}/{repo}/contributors').reply(200, [{ login: 'octo', contributions: 40 }]);
      gh.when('GET /repos/{owner}/{repo}/community/profile').reply(200, { health_percentage: 85, files: { readme: { url: 'u' }, license: null } });
      gh.when('GET /repos/{owner}/{repo}/stats/commit_activity').replySequence(statsSteps);
    };
    it('asks again while GitHub answers 202, then reads the numbers', async () => {
      const w = await makeWorld();
      arrange(w.gh, [{ status: 202, body: {} }, { status: 200, body: [{ total: 3 }, { total: 9 }] }]);
      const out = await run('github_repo_get_insights', w, { repo: 'hello' });
      expect(out).toMatchObject({ languages: { JavaScript: '75.0%', CSS: '25.0%' }, top_contributors: [{ login: 'octo', commits: 40 }], community: { health_percentage: 85, has: ['readme'] }, commit_activity: { last_12_weeks: 12, busiest_week_commits: 9 } });
      expect(w.gh.calls.filter((c) => c.route.includes('commit_activity'))).toHaveLength(2);
    });
    it('gives up after three tries and says GitHub is still computing', async () => {
      const w = await makeWorld();
      arrange(w.gh, [{ status: 202, body: {} }]);
      const out = await run('github_repo_get_insights', w, { repo: 'hello' });
      expect(out.commit_activity).toMatch(/still computing/);
      expect(w.gh.calls.filter((c) => c.route.includes('commit_activity'))).toHaveLength(3);
    });
  });

  it('reports traffic parts that GitHub refuses instead of failing', async () => {
    const w = await makeWorld();
    w.gh.when('GET /repos/{owner}/{repo}/traffic/views').reply(200, { count: 10, uniques: 4, views: [] });
    w.gh.when('GET /repos/{owner}/{repo}/traffic/clones').reply(403, { message: 'Must have push access' });
    w.gh.when('GET /repos/{owner}/{repo}/traffic/popular/referrers').reply(200, [{ referrer: 'google.com', count: 3, uniques: 2 }]);
    w.gh.when('GET /repos/{owner}/{repo}/traffic/popular/paths').reply(200, []);
    const out = await run('github_repo_get_traffic', w, { repo: 'hello' });
    expect(out).toMatchObject({ views: { total: 10, unique: 4 }, clones: { unavailable: expect.stringContaining('push access') }, referrers: [{ referrer: 'google.com' }] });
    expect(w.gh.invalid).toEqual([]);
  });

  it('lists activity and custom properties', async () => {
    const w = await makeWorld();
    w.gh.when('GET /repos/{owner}/{repo}/activity').reply(200, [{ activity_type: 'force_push', ref: 'refs/heads/x', actor: { login: 'octo' }, timestamp: '2026-10-01T00:00:00Z', before: 'a', after: 'b' }]);
    w.gh.when('GET /repos/{owner}/{repo}/properties/values').reply(200, [{ property_name: 'team', value: 'core' }]);
    expect(await run('github_repo_list_activity', w, { repo: 'hello', activityType: 'force_push', timePeriod: 'week' })).toEqual([{ type: 'force_push', ref: 'refs/heads/x', who: 'octo', at: '2026-10-01T00:00:00Z', before: 'a', after: 'b' }]);
    expect(await run('github_repo_get_custom_properties', w, { repo: 'hello' })).toEqual({ repository: 'example-org/hello', properties: { team: 'core' } });
    expect(w.gh.invalid).toEqual([]);
  });
});

describe('write rules beyond the contract', () => {
  const live = (profile = 'full') => makeWorld({ mode: 'production', profile, gates: createGates() });

  it('settings other than merge options are not production; merge options are', async () => {
    const w = await makeWorld({ profile: 'full', gates: createGates() });
    w.gh.when(REPO).reply(200, repo());
    const quiet = await run('github_repo_update_settings', w, { repo: 'hello', description: 'New words', dryRun: true });
    expect(quiet.status).toBe('preview');
    expect(quiet.preview).not.toContain('PRODUCTION');
    const merge = await run('github_repo_update_settings', w, { repo: 'hello', delete_branch_on_merge: true, confirm: true });
    expect(merge).toMatchObject({ status: 'refused_by_guard', refusedBy: 'mode' });
  });

  it('refuses an update that names nothing to change', async () => {
    const w = await makeWorld({ profile: 'full', gates: createGates() });
    expect(await run('github_repo_update_settings', w, { repo: 'hello' })).toMatchObject({ status: 'refused', error: expect.stringContaining('Say what to change') });
  });

  it('putting topics and a description makes two calls and compares both', async () => {
    const w = await makeWorld({ profile: 'full', gates: createGates() });
    w.gh.when(REPO).replySequence([{ status: 200, body: repo() }, { status: 200, body: repo({ description: 'New', topics: ['mcp', 'github'] }) }]);
    w.gh.when('PATCH /repos/{owner}/{repo}').reply(200, repo());
    w.gh.when('PUT /repos/{owner}/{repo}/topics').reply(200, { names: ['mcp', 'github'] });
    const out = await run('github_repo_update_settings', w, { repo: 'hello', description: 'New', topics: ['mcp', 'github'], confirm: true });
    expect(out).toMatchObject({ status: 'applied', result: { description: 'New', topics: ['mcp', 'github'] } });
    expect(w.gh.calls.filter((c) => c.method !== 'GET').map((c) => c.route)).toEqual(['PATCH /repos/{owner}/{repo}', 'PUT /repos/{owner}/{repo}/topics']);
    expect(w.gh.invalid).toEqual([]);
  });

  it('delete needs the name typed back, and is refused on a pr-only repository by the real protected list', async () => {
    const w = await live();
    expect(await run('github_repo_delete', w, { repo: 'hello', confirmName: 'Hello', confirm: true })).toMatchObject({ status: 'refused', error: expect.stringContaining('confirmName') });
    await w.db.upsertAccount({ login: 'robinson-ai-systems', accountId: 9, accountType: 'Organization', label: 'r', credentialKind: 'fine_grained' });
    const r = await makeWorld({ mode: 'production', profile: 'full', accounts: ['robinson-ai-systems'], gates: createGates() });
    await r.db.setProductionEnabled('robinson-ai-systems', true);
    r.gh.when(REPO).reply(200, repo({ full_name: 'robinson-ai-systems/github-mcp' }));
    const out = await run('github_repo_delete', r, { repo: 'github-mcp', confirmName: 'github-mcp', confirm: true });
    expect(out).toMatchObject({ status: 'refused_by_guard', refusedBy: expect.stringContaining('protected') });
    expect(r.gh.calls.filter((c) => c.method === 'DELETE')).toEqual([]);
  });

  it('making a repository public is an access change that names what becomes visible', async () => {
    const w = await live();
    await w.db.setProductionEnabled('example-org', true);
    w.gh.when(REPO).reply(200, repo());
    const out = await run('github_repo_set_visibility', w, { repo: 'hello', visibility: 'public' });
    expect(out).toMatchObject({ status: 'needs_confirmation' });
    expect(out.preview).toContain('PUBLIC');
    expect(out.preview).toContain('ACCESS CHANGE');
    expect(out.preview).toContain('PRODUCTION');
  });

  it('create refuses a name that exists and an internal repository for a user account', async () => {
    const w = await makeWorld({ gates: createGates() });
    w.gh.when(REPO).reply(200, repo());
    const out = await run('github_repo_create', w, { repo: 'hello', dryRun: true });
    expect(out.preview).toContain('already exists');
    const confirmed = await run('github_repo_create', w, { repo: 'hello', confirm: true });
    expect(confirmed).toMatchObject({ status: 'rejected', error: expect.stringContaining('already exists') });
    expect(w.gh.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('create sends private unless public is asked for, and a user account uses its own endpoint', async () => {
    const w = await makeWorld({ accounts: ['example-user'], gates: createGates() });
    await w.db.upsertAccount({ login: 'example-user', accountId: 5, accountType: 'User', label: 'u', credentialKind: 'fine_grained' });
    w.gh.when(REPO).replySequence([{ status: 404, body: {} }, { status: 200, body: repo({ full_name: 'example-user/hello' }) }]);
    w.gh.when('POST /user/repos').reply(201, repo());
    const out = await run('github_repo_create', w, { repo: 'hello', autoInit: true, confirm: true });
    expect(out.status).toBe('applied');
    expect(w.gh.calls.find((c) => c.method === 'POST').body).toMatchObject({ name: 'hello', private: true, auto_init: true });
    expect(w.gh.invalid).toEqual([]);
  });

  it('every tool this card adds is in the catalog list and names an audience', () => {
    expect(tools.length).toBe(20);
    for (const t of tools) expect(t.audience?.length).toBeGreaterThan(0);
  });
});
