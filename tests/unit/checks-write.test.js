// G-2 part 2: every check, status, artifact and cache change tool passes the write contract through all three doors, then the extra rules.
import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import { protectionGate } from '../../test/helpers/fixture-gates.js';
import * as checks from '../../src/tools/checks-write.js';

const def = (name) => ({ tool: checks.tools.find((t) => t.name === name), handler: checks.handlers[name] });
const R = { repo: 'hello' };
const A = 'a'.repeat(40);
const COMMIT = 'GET /repos/{owner}/{repo}/commits/{ref}';
const CHECK = 'GET /repos/{owner}/{repo}/check-runs/{check_run_id}';
const STATUSES = 'GET /repos/{owner}/{repo}/commits/{ref}/statuses';
const ARTIFACT = 'GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}';
const CACHES = 'GET /repos/{owner}/{repo}/actions/caches';
const seq = (gh, route, steps) => gh.when(route).replySequence(steps.map(([status, body]) => ({ status, body })));
const gatesFor = ({ protectedLevel }) => (protectedLevel ? [protectionGate(protectedLevel === 'pr-only' ? 'none' : protectedLevel)] : []);
const base = { gatesFor, conveyor: true };
const gone = [404, { message: 'Not Found' }];

runWriteContract({
  ...base, label: 'github_check_create_run', definition: def('github_check_create_run'), args: { ...R, name: 'lint', headSha: A, status: 'completed', conclusion: 'success', title: 'Lint', summary: 'No problems' }, needsConfirm: false,
  arrange(gh, outcome) {
    gh.when(COMMIT).reply(200, { sha: A });
    gh.when('POST /repos/{owner}/{repo}/check-runs').reply(201, { id: 5, name: 'lint', head_sha: A, status: 'completed', conclusion: 'success' });
    gh.when(CHECK).reply(200, { id: 5, name: 'lint', head_sha: A, status: 'completed', conclusion: outcome === 'ok' ? 'success' : 'failure', html_url: 'u' });
  }
});

runWriteContract({
  ...base, label: 'github_check_update_run', definition: def('github_check_update_run'), args: { ...R, checkRunId: 5, status: 'completed', conclusion: 'failure', summary: 'Two problems' }, needsConfirm: false,
  arrange(gh, outcome) {
    const running = { id: 5, name: 'lint', head_sha: A, status: 'in_progress', conclusion: null };
    seq(gh, CHECK, [[200, running], [200, outcome === 'ok' ? { ...running, status: 'completed', conclusion: 'failure' } : running]]);
    gh.when('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}').reply(200, { id: 5 });
  }
});

runWriteContract({
  ...base, label: 'github_status_create', definition: def('github_status_create'), args: { ...R, sha: A, state: 'success', context: 'deploy/preview', description: 'Preview is live' }, needsConfirm: false,
  arrange(gh, outcome) {
    gh.when(COMMIT).reply(200, { sha: A });
    seq(gh, STATUSES, [[200, [{ context: 'deploy/preview', state: 'pending', description: 'Building' }]], [200, [{ context: 'deploy/preview', state: outcome === 'ok' ? 'success' : 'pending' }]]]);
    gh.when('POST /repos/{owner}/{repo}/statuses/{sha}').reply(201, { id: 1, state: 'success' });
  }
});

runWriteContract({
  ...base, label: 'github_artifact_delete', definition: def('github_artifact_delete'), args: { ...R, artifactId: 8 }, needsConfirm: true,
  arrange(gh, outcome) {
    const art = { id: 8, name: 'build', size_in_bytes: 10, expired: false };
    seq(gh, ARTIFACT, outcome === 'ok' ? [[200, art], gone] : [[200, art], [200, art]]);
    gh.when('DELETE /repos/{owner}/{repo}/actions/artifacts/{artifact_id}').reply(204, null);
  }
});

runWriteContract({
  ...base, label: 'github_cache_delete (by id)', definition: def('github_cache_delete'), args: { ...R, cacheId: 2 }, needsConfirm: true,
  arrange(gh, outcome) {
    const cache = { id: 2, key: 'npm-2', ref: 'refs/heads/main', size_in_bytes: 1024 };
    seq(gh, CACHES, [[200, { total_count: 1, actions_caches: [cache] }], [200, { total_count: outcome === 'ok' ? 0 : 1, actions_caches: outcome === 'ok' ? [] : [cache] }]]);
    gh.when('DELETE /repos/{owner}/{repo}/actions/caches/{cache_id}').reply(204, null);
  }
});

runWriteContract({
  ...base, label: 'github_cache_delete (by key)', definition: def('github_cache_delete'), args: { ...R, key: 'npm-2', ref: 'refs/heads/main' }, needsConfirm: true,
  arrange(gh, outcome) {
    const cache = { id: 2, key: 'npm-2', ref: 'refs/heads/main', size_in_bytes: 1024 };
    seq(gh, CACHES, [[200, { total_count: 1, actions_caches: [cache] }], [200, { total_count: outcome === 'ok' ? 0 : 1, actions_caches: outcome === 'ok' ? [] : [cache] }]]);
    gh.when('DELETE /repos/{owner}/{repo}/actions/caches').reply(200, { total_count: 1, actions_caches: [cache] });
  }
});

const call = async (name, w, args) => parse(await checks.handlers[name](args, w.ctx));

describe('check, status and cache rules', () => {
  it('a fine-grained token is told in plain words that only a GitHub App can create check runs', async () => {
    const w = await makeWorld({});
    w.gh.when(COMMIT).reply(200, { sha: A });
    w.gh.when('POST /repos/{owner}/{repo}/check-runs').reply(403, { message: 'Resource not accessible by personal access token' });
    const out = await call('github_check_create_run', w, { ...R, name: 'lint', headSha: A, confirm: true });
    expect(out.status).toBe('rejected');
    expect(JSON.stringify(out)).toMatch(/Only a GitHub App can create or change check runs/);
  });

  it('a completed check run needs a conclusion, and a conclusion needs "completed"', async () => {
    const w = await makeWorld({});
    expect((await call('github_check_create_run', w, { ...R, name: 'x', headSha: A, status: 'completed' })).status).toBe('refused');
    expect((await call('github_check_update_run', w, { ...R, checkRunId: 5, status: 'in_progress', conclusion: 'success' })).status).toBe('refused');
    expect(w.gh.calls).toEqual([]);
  });

  it('a status change is undone by setting the previous state again', async () => {
    const w = await makeWorld({});
    w.gh.when(COMMIT).reply(200, { sha: A });
    seq(w.gh, STATUSES, [[200, [{ context: 'ci', state: 'failure', description: 'old' }]], [200, [{ context: 'ci', state: 'success' }]]]);
    w.gh.when('POST /repos/{owner}/{repo}/statuses/{sha}').reply(201, { id: 1 });
    await call('github_status_create', w, { ...R, sha: A, state: 'success', context: 'ci', confirm: true });
    expect((await w.db.getChange(1)).inverse).toMatchObject({ tool: 'github_status_create', args: { state: 'failure', context: 'ci', description: 'old' } });
    expect(w.gh.invalid).toEqual([]);
  });

  it('a cache delete needs exactly one of id or key, and says so when nothing matches', async () => {
    const w = await makeWorld({});
    expect((await call('github_cache_delete', w, { ...R })).status).toBe('refused');
    expect((await call('github_cache_delete', w, { ...R, cacheId: 1, key: 'x' })).status).toBe('refused');
    w.gh.when(CACHES).reply(200, { total_count: 0, actions_caches: [] });
    const out = await call('github_cache_delete', w, { ...R, key: 'nothing', confirm: true });
    expect(out.status).toBe('rejected');
    expect(w.gh.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });
});
