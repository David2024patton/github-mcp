import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const R = { repo: 'hello' };
const A = 'a'.repeat(40);
async function run(world, name, args) {
  const dispatch = createDispatch({ credentials: world.credentials, gates: [], fetch: world.gh.fetch, now: world.ctx.now, sleep: async () => {} });
  const result = await dispatch({ registry, name, args, connection: world.connection, db: world.db });
  return { result, body: result.isError ? null : (result.structuredContent ?? parse(result)) };
}
const ciWorld = async ({ required = [{ context: 'ci' }], runs = [], statuses = [] } = {}) => {
  const w = await makeWorld({ profile: 'read_only' });
  w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main' });
  w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(200, { sha: A });
  w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, { head: { sha: A }, base: { ref: 'release' } });
  w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, required.length ? [{ type: 'required_status_checks', parameters: { required_status_checks: required } }] : []);
  w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks').reply(404, { message: 'Branch not protected' });
  w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/check-runs').reply(200, { total_count: runs.length, check_runs: runs });
  w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}/status').reply(200, { state: 'pending', total_count: statuses.length, statuses });
  return w;
};

describe('check, artifact and cache read tools (G-2)', () => {
  it('CI state merges check runs and statuses; a required check that never reported is missing, and the answer is red', async () => {
    const w = await ciWorld({ required: [{ context: 'ci' }, { context: 'legacy' }, { context: 'deploy' }], runs: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success', started_at: '2026-10-11T00:00:00Z', app: { id: 1 } }],
      statuses: [{ context: 'legacy', state: 'success' }] });
    const { body } = await run(w, 'github_check_get_ci_state', R);
    expect(body).toMatchObject({ head_sha: A, base_branch: 'main', overall: 'red', basis: 'required' });
    expect(body.checks).toEqual(expect.arrayContaining([expect.objectContaining({ context: 'ci', state: 'success', source: 'check run' }), expect.objectContaining({ context: 'legacy', state: 'success', source: 'status' }), expect.objectContaining({ context: 'deploy', state: 'missing', source: 'none' })]));
    expect(body.checks[0].started_at).toBe('2026-10-11T00:00:00Z');
    expect(w.gh.invalid).toEqual([]);
  });

  it('CI state of a pull request uses its head and its base branch, and pending is not red', async () => {
    const w = await ciWorld({ runs: [{ id: 1, name: 'ci', status: 'in_progress', conclusion: null, started_at: '2026-10-11T00:00:00Z', app: { id: 1 } }] });
    const { body } = await run(w, 'github_check_get_ci_state', { ...R, pr: 4 });
    expect(body).toMatchObject({ overall: 'pending', base_branch: 'release' });
    expect(w.gh.calls.find((c) => c.route === 'GET /repos/{owner}/{repo}/rules/branches/{branch}').params.branch).toBe('release');
  });

  it('all green when every required check passed', async () => {
    const w = await ciWorld({ runs: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success', started_at: '2026-10-11T00:00:00Z', app: { id: 1 } }] });
    expect((await run(w, 'github_check_get_ci_state', R)).body.overall).toBe('green');
  });

  it('a check run comes with its annotations', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/check-runs/{check_run_id}').reply(200, { id: 5, name: 'lint', status: 'completed', conclusion: 'failure', output: { title: 't', summary: 's', annotations_count: 1 }, app: { slug: 'x' } });
    w.gh.when('GET /repos/{owner}/{repo}/check-runs/{check_run_id}/annotations').reply(200, [{ path: 'a.js', start_line: 3, annotation_level: 'failure', title: 'bad', message: 'no-undef' }]);
    const { body } = await run(w, 'github_check_get_run', { ...R, checkRunId: 5 });
    expect(body.annotations).toEqual([{ path: 'a.js', line: 3, level: 'failure', title: 'bad', message: 'no-undef' }]);
    expect(w.gh.invalid).toEqual([]);
  });

  it('artifact link is the redirect only; an expired artifact says so; the list filters by run', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}').reply(200, { id: 8, name: 'build', size_in_bytes: 10, expired: false });
    w.gh.when('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}').reply(302, '', { location: 'https://pipelines.actions.githubusercontent.com/x?sig=1' });
    const { body } = await run(w, 'github_artifact_get_link', { ...R, artifactId: 8 });
    expect(body).toMatchObject({ name: 'build', url: expect.stringContaining('githubusercontent.com') });
    w.gh.when('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}').reply(200, { id: 8, name: 'build', expired: true, expires_at: '2026-10-01' });
    expect((await run(w, 'github_artifact_get_link', { ...R, artifactId: 8 })).result.isError).toBe(true);
    w.gh.when('GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts').reply(200, { total_count: 1, artifacts: [{ id: 8, name: 'build', size_in_bytes: 10, expired: false }] });
    expect((await run(w, 'github_artifact_list', { ...R, runId: 3 })).body.items[0]).toMatchObject({ id: 8, name: 'build' });
    expect(w.gh.invalid).toEqual([]);
  });

  it('cache list shows total usage and each cache', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/actions/cache/usage').reply(200, { full_name: 'example-org/hello', active_caches_size_in_bytes: 2048, active_caches_count: 2 });
    w.gh.when('GET /repos/{owner}/{repo}/actions/caches').reply(200, { total_count: 2, actions_caches: [{ id: 1, key: 'npm-1', ref: 'refs/heads/main', size_in_bytes: 1024 }, { id: 2, key: 'npm-2', ref: 'refs/heads/x', size_in_bytes: 1024 }] });
    const { body } = await run(w, 'github_cache_list', { ...R, key: 'npm-' });
    expect(body).toMatchObject({ usage: { caches: 2, bytes: 2048 }, count: 2, items: [{ id: 1, key: 'npm-1' }, expect.anything()] });
    expect(w.gh.calls.find((c) => c.route.endsWith('/actions/caches')).query.key).toBe('npm-');
    expect(w.gh.invalid).toEqual([]);
  });
});
