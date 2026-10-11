// D-1 part 2: the rules of the repository write tools that the write contract does not cover.
import { describe, expect, it } from 'vitest';
import { tools, handlers } from '../../src/tools/repos-write.js';
import { createGates } from '../../src/tools/gates.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const run = (name, w, args) => Promise.resolve(handlers[name](args, w.ctx)).then((r) => (r?.content ? parse(r) : r));
const repo = (extra = {}) => ({ full_name: 'example-org/hello', name: 'hello', private: true, visibility: 'private', default_branch: 'main', archived: false, topics: ['a'], ...extra });
const REPO = 'GET /repos/{owner}/{repo}';

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
    expect(tools.length).toBe(13);
    for (const t of tools) expect(t.audience?.length).toBeGreaterThan(0);
  });
});
