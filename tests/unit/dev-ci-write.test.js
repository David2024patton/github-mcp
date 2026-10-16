import { describe, expect, it } from 'vitest';
import { makeWorld, parse, runWriteContract } from '../../test/helpers/write-contract.js';
import { runDevMutationOnce } from '../../src/dev/execute.js';
import * as ciWrite from '../../src/tools/dev-ci-write.js';

const OWNER = 'example-org', REPO = 'host-repo', RUN = 'run-ci-102', NAME = 'one';
const BRANCH = `rtc/${RUN}/${NAME}`, FILE = `rtc/${RUN}/${NAME}.md`;
const A = 'a'.repeat(40), B = 'b'.repeat(40);
const def = (name) => ({ tool: ciWrite.tools.find((t) => t.name === name), handler: ciWrite.handlers[name] });
const dispatch = def('github_dev_dispatch_and_wait'), check = def('github_dev_set_check_run');
const yaml = (extra = '') => Buffer.from(`name: CI\non:\n  workflow_dispatch:\njobs:\n  t:\n    runs-on: ubuntu-latest\n${extra}    steps:\n      - run: echo ok\n`).toString('base64');
const record = (w, type, objectId, createdSha, stepId, objectName = objectId) => runDevMutationOnce(w.ctx, { runId: RUN, account: OWNER, connection: 'client-1', stepId, type, owner: OWNER, repo: REPO, objectName, create: async () => ({ objectId, createdSha }) });
const recordBranch = (w) => record(w, 'branch', BRANCH, A, `test-branch-${NAME}`);

function arrangeDispatch(gh, outcome, { status = 'completed', content = yaml() } = {}) {
  gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: `${OWNER}/${REPO}`, default_branch: 'main', archived: false });
  gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
  gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { name: BRANCH, protected: false, commit: { sha: A } });
  gh.when('GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}').reply(200, { id: 77, name: 'CI', path: '.github/workflows/ci.yml' });
  gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, { content, encoding: 'base64' });
  gh.when('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches').reply(200, { workflow_run_id: 555, run_url: 'https://api.github.com/x', html_url: 'https://github.com/x' });
  gh.when('GET /repos/{owner}/{repo}/actions/runs/{run_id}').reply(200, { id: 555, status, conclusion: status === 'completed' ? 'success' : null, head_branch: BRANCH, head_sha: outcome === 'mismatch' ? B : A, event: 'workflow_dispatch', html_url: 'https://github.com/x/runs/555' });
}
runWriteContract({ label: 'github_dev_dispatch_and_wait', definition: dispatch, args: { repo: REPO, runId: RUN, name: NAME, workflow: 'ci.yml' }, previewOnly: true, needsConfirm: false, arrange: arrangeDispatch, prepare: recordBranch });

function arrangeCheck(gh, outcome) {
  let current = null;
  gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: `${OWNER}/${REPO}`, default_branch: 'main', archived: false });
  gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(200, { sha: B });
  const shape = (req) => {
    const b = req.body ?? {};
    current = { id: 900, name: b.name ?? current?.name ?? 'ci', head_sha: B, external_id: `rtc_run=${RUN}`, status: b.status, conclusion: b.conclusion, html_url: 'https://github.com/x/checks/900' };
    return current;
  };
  gh.when('POST /repos/{owner}/{repo}/check-runs').reply(201, shape);
  gh.when('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}').reply(200, shape);
  gh.when('GET /repos/{owner}/{repo}/check-runs/{check_run_id}').reply(200, () => (outcome === 'mismatch' ? { ...current, conclusion: 'failure' } : current));
}
const recordFixture = (w) => record(w, 'fixture_file', FILE, B, `test-pr-file-${NAME}`);
runWriteContract({ label: 'github_dev_set_check_run', definition: check, args: { repo: REPO, runId: RUN, name: 'ci', headSha: B, state: 'success' }, previewOnly: true, needsConfirm: false, arrange: arrangeCheck, prepare: recordFixture });

const call = async (d, w, args) => parse(await d.handler({ repo: REPO, runId: RUN, ...args }, w.ctx));
describe('V-3 dispatch and bounded wait', () => {
  const base = { name: NAME, workflow: 'ci.yml', confirm: true };
  it('waits at most 45 seconds, returns a handle, and a resumed check never dispatches again', async () => {
    const w = await makeWorld();
    let slept = 0;
    w.ctx.sleep = async (ms) => { slept += ms; };
    arrangeDispatch(w.gh, 'ok', { status: 'in_progress' });
    await recordBranch(w);
    const first = await call(dispatch, w, base);
    expect(first).toMatchObject({ status: 'applied', result: { complete: false, status: 'in_progress', handle: { github_run_id: 555 } } });
    expect(slept).toBeLessThanOrEqual(45_000);
    expect(slept).toBeGreaterThan(0);
    const again = await call(dispatch, w, { ...base, poll: 2, waitSeconds: 3 });
    expect(again.status).toBe('applied');
    expect(w.gh.calls.filter((c) => c.route.endsWith('/dispatches'))).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
  it('returns the finished run without waiting when it is already complete', async () => {
    const w = await makeWorld();
    let slept = 0;
    w.ctx.sleep = async (ms) => { slept += ms; };
    arrangeDispatch(w.gh, 'ok');
    await recordBranch(w);
    const out = await call(dispatch, w, base);
    expect(out.result).toMatchObject({ complete: true, conclusion: 'success', handle: null });
    expect(slept).toBe(0);
  });
  it('refuses refs the run did not create, and workflows that deploy to production', async () => {
    const w = await makeWorld();
    arrangeDispatch(w.gh, 'ok');
    expect((await call(dispatch, w, base)).error).toMatch(/not a recorded test branch/);
    const prod = await makeWorld();
    arrangeDispatch(prod.gh, 'ok', { content: yaml('    environment: production\n') });
    await recordBranch(prod);
    const out = await call(dispatch, prod, base);
    expect(out.status).toBe('refused_by_guard');
    expect(prod.gh.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });
  it('explains an unknown workflow and never dispatches', async () => {
    const w = await makeWorld();
    arrangeDispatch(w.gh, 'ok');
    w.gh.when('GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}').reply(404, { message: 'Not Found' });
    await recordBranch(w);
    expect((await call(dispatch, w, base)).error).toMatch(/no workflow ci\.yml/);
    expect(w.gh.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });
});
describe('V-3 simulated check runs', () => {
  const base = { name: 'ci', headSha: B, state: 'success', confirm: true };
  it('writes only on commits the run created and updates the one recorded check run', async () => {
    const w = await makeWorld();
    arrangeCheck(w.gh, 'ok');
    await recordFixture(w);
    await recordBranch(w);
    expect((await call(check, w, { ...base, headSha: A })).error).toMatch(/commit this run created/);
    expect(w.gh.calls.filter((c) => c.method === 'POST')).toEqual([]);
    expect((await call(check, w, base)).status).toBe('applied');
    const failed = await call(check, w, { ...base, state: 'failure' });
    expect(failed).toMatchObject({ status: 'applied', result: { conclusion: 'failure', check_run_id: 900 } });
    expect(w.gh.calls.filter((c) => c.route === 'POST /repos/{owner}/{repo}/check-runs')).toHaveLength(1);
    expect(w.gh.calls.filter((c) => c.route.startsWith('PATCH'))).toHaveLength(1);
    expect(w.gh.calls.find((c) => c.route === 'POST /repos/{owner}/{repo}/check-runs').body).toMatchObject({ external_id: `rtc_run=${RUN}`, status: 'completed', conclusion: 'success' });
    expect(w.gh.invalid).toEqual([]);
  });
  it('tells a token-backed account in plain words that only an App can write checks', async () => {
    const w = await makeWorld();
    arrangeCheck(w.gh, 'ok');
    w.gh.when('POST /repos/{owner}/{repo}/check-runs').reply(403, { message: 'Resource not accessible by personal access token' });
    await recordFixture(w);
    const out = await call(check, w, base);
    expect(out.done).toBe(false);
    expect(JSON.stringify(out)).toMatch(/Only a GitHub App can write check runs/);
  });
});
