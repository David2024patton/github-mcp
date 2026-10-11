import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const R = { repo: 'hello' };
const A = 'a'.repeat(40);
const pr = (extra = {}) => ({ number: 7, title: 'Add thing', state: 'open', draft: false, merged: false, user: { login: 'alice' }, head: { ref: 'feature', sha: A }, base: { ref: 'main' }, labels: [{ name: 'bug' }], mergeable: true,
  mergeable_state: 'clean', commits: 1, changed_files: 1, additions: 3, deletions: 1, body: 'text', author_association: 'OWNER', html_url: 'https://github.com/example-org/hello/pull/7', ...extra });
const PULL = 'GET /repos/{owner}/{repo}/pulls/{pull_number}';

async function run(world, name, args) {
  const dispatch = createDispatch({ credentials: world.credentials, gates: [], fetch: world.gh.fetch, now: world.ctx.now, sleep: async () => {} });
  const result = await dispatch({ registry, name, args, connection: world.connection, db: world.db });
  return { result, body: result.isError ? null : (result.structuredContent ?? parse(result)) };
}
const threadsQuery = (w, threads) => w.gh.when('POST /graphql').reply(200, { data: { repository: { pullRequest: { reviewDecision: 'APPROVED', isDraft: false, reviewThreads: { totalCount: threads.length, nodes: threads.map((r) => ({ isResolved: r })) } } } } });

describe('pull request read tools (E-1)', () => {
  it('github_pr_get gives the review decision, unresolved threads and each required check at the exact head', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when(PULL).reply(200, pr());
    threadsQuery(w, [true, false, false]);
    w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci' }, { context: 'lint' }, { context: 'deploy' }] } }]);
    w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks').reply(404, { message: 'Branch not protected' });
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/check-runs').reply(200, { total_count: 2, check_runs: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success' }, { id: 2, name: 'lint', status: 'in_progress', conclusion: null }] });
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/status').reply(200, { state: 'pending', statuses: [], total_count: 0 });
    const { body } = await run(w, 'github_pr_get', { ...R, number: 7 });
    expect(body).toMatchObject({ number: 7, head_sha: A, review: { decision: 'APPROVED', threads: 3, unresolved_threads: 2 } });
    expect(body.required_checks).toMatchObject({ green: false, required: [{ context: 'ci', state: 'success' }, { context: 'lint', state: 'pending' }, { context: 'deploy', state: 'missing' }] });
    expect(w.gh.calls.find((c) => c.route === 'GET /repos/{owner}/{repo}/commits/{ref}/check-runs').params.ref).toBe(A);
    expect(w.gh.invalid).toEqual([]);
  });

  it('is green only when every required check passed, using classic protection and statuses too', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when(PULL).reply(200, pr());
    threadsQuery(w, []);
    w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
    w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks').reply(200, { strict: true, contexts: ['legacy'], checks: [{ context: 'ci', app_id: null }] });
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/check-runs').reply(200, { total_count: 1, check_runs: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'skipped' }] });
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/status').reply(200, { state: 'success', total_count: 1, statuses: [{ context: 'legacy', state: 'success' }] });
    const { body } = await run(w, 'github_pr_get', { ...R, number: 7 });
    expect(body.required_checks).toMatchObject({ green: true, required: [{ context: 'legacy', state: 'success' }, { context: 'ci', state: 'success' }] });
  });

  it('says so when the requirements cannot be read, instead of claiming green', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when(PULL).reply(200, pr());
    threadsQuery(w, []);
    w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(403, { message: 'no' });
    w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks').reply(403, { message: 'no' });
    const { body } = await run(w, 'github_pr_get', { ...R, number: 7 });
    expect(body.required_checks.green).toBeNull();
    expect(body.required_checks.note).toEqual(expect.any(String));
  });

  it('github_pr_list filters by head, author and label, and qualifies a bare head branch with the owner', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/pulls').reply(200, [pr(), pr({ number: 8, user: { login: 'bob' } }), pr({ number: 9, labels: [] })]);
    const { body } = await run(w, 'github_pr_list', { ...R, head: 'feature', author: 'alice', label: 'bug' });
    expect(body.items.map((p) => p.number)).toEqual([7]);
    expect(w.gh.calls.find((c) => c.route === 'GET /repos/{owner}/{repo}/pulls').query.head).toBe('example-org:feature');
    expect(w.gh.invalid).toEqual([]);
  });

  it('github_pr_get_diff cuts a long diff and says where; files and commits list', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when(PULL).reply(200, 'd'.repeat(40000), { 'content-type': 'application/vnd.github.diff' });
    const { body } = await run(w, 'github_pr_get_diff', { ...R, number: 7 });
    expect(body).toMatchObject({ characters: expect.any(Number), cut_at: 30000 });
    w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}/files').reply(200, [{ filename: 'a.js', status: 'modified', additions: 1, deletions: 0, patch: 'x'.repeat(2000) }]);
    w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}/commits').reply(200, [{ sha: A, commit: { message: 'm', author: { name: 'n', date: 'd' } }, parents: [] }]);
    const files = (await run(w, 'github_pr_list_files', { ...R, number: 7 })).body;
    expect(files.items[0]).toMatchObject({ path: 'a.js', patch_cut: true });
    expect((await run(w, 'github_pr_list_commits', { ...R, number: 7 })).body.count).toBe(1);
    expect(w.gh.invalid).toEqual([]);
  });
});
