import { describe, expect, it } from 'vitest';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';
import * as mod from '../../src/tools/dev-cleanup-write.js';

const RUN = 'run-ci-103', OWNER = 'example-org', REPO = 'host-project', BR = `rtc/${RUN}/one`;
const A = 'a'.repeat(40), B = 'b'.repeat(40);
const handler = mod.handlers.github_dev_cleanup;
const record = (w, type, objectId, createdSha) => w.db.recordDevObject({ runId: RUN, account: OWNER, connection: 'client-1', type, owner: OWNER, repo: REPO, objectId, createdSha });
async function world({ run = {}, check = {} } = {}) {
  const w = await makeWorld();
  await w.db.createDevRun({ id: RUN, account: OWNER, connection: 'client-1' });
  await record(w, 'branch', BR, A);
  await record(w, 'fixture_file', `${BR}.md`, B);
  await record(w, 'workflow_run', '555', B);
  await record(w, 'check_run', '900', B);
  const wf = { id: 555, event: 'workflow_dispatch', head_branch: BR, head_sha: B, status: 'completed', repository: { full_name: `${OWNER}/${REPO}` }, ...run };
  const cr = { id: 900, head_sha: B, external_id: `rtc_run=${RUN}`, status: 'completed', ...check };
  const gone = { status: 404, body: { message: 'Not Found' } };
  const branch = { name: BR, protected: false, commit: { sha: B } };
  w.gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: `${OWNER}/${REPO}`, default_branch: 'main' });
  w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
  w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').replySequence([...Array.from({ length: 5 }, () => ({ status: 200, body: branch })), gone]);
  w.gh.when('DELETE /repos/{owner}/{repo}/git/refs/{ref}').reply(204);
  w.gh.when('GET /repos/{owner}/{repo}/actions/runs/{run_id}').replySequence([{ status: 200, body: wf }, { status: 200, body: wf }, { status: 200, body: wf }, gone]);
  w.gh.when('DELETE /repos/{owner}/{repo}/actions/runs/{run_id}').reply(204);
  w.gh.when('POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel').reply(202, {});
  w.gh.when('GET /repos/{owner}/{repo}/check-runs/{check_run_id}').replySequence([{ status: 200, body: cr }]);
  w.gh.when('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}').reply(200, { ...cr, status: 'completed' });
  return w;
}
const run = async (w) => parse(await handler({ runId: RUN, repo: REPO, confirm: true }, w.ctx));

describe('V-2 cleanup of V-3 objects in a host repository', () => {
  it('deletes the exact workflow run and branch, closes out the check, marks the fixture file and never touches the host', async () => {
    const w = await world();
    const out = await run(w);
    expect(out.status).toBe('applied');
    expect(out.result.cleanup).toMatchObject({ verified: true, deleted_repository: false, objects_cleaned: 4, retained_by_github: [{ type: 'check_run', id: '900' }] });
    expect(w.gh.calls.filter((c) => c.method === 'DELETE').map((c) => c.route).sort()).toEqual(['DELETE /repos/{owner}/{repo}/actions/runs/{run_id}', 'DELETE /repos/{owner}/{repo}/git/refs/{ref}']);
    expect(w.gh.calls.some((c) => c.route === 'DELETE /repos/{owner}/{repo}')).toBe(false);
    expect(w.gh.calls.some((c) => c.route.startsWith('PATCH'))).toBe(false);
    const objects = await w.db.listDevObjects({ runId: RUN, account: OWNER, connection: 'client-1' });
    expect(objects.every((o) => o.cleaned === true)).toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
  it('cancels a still-running check, and reports a run that is still stopping instead of deleting it', async () => {
    const w = await world({ check: { status: 'in_progress' } });
    const open = { status: 200, body: { id: 900, head_sha: B, external_id: `rtc_run=${RUN}`, status: 'in_progress' } };
    w.gh.when('GET /repos/{owner}/{repo}/check-runs/{check_run_id}').replySequence([open, open, open, { status: 200, body: { ...open.body, status: 'completed' } }]);
    expect((await run(w)).status).toBe('applied');
    expect(w.gh.calls.find((c) => c.route.startsWith('PATCH')).body).toMatchObject({ status: 'completed', conclusion: 'cancelled' });
    const busy = await world({ run: { status: 'in_progress' } });
    busy.gh.when('GET /repos/{owner}/{repo}/actions/runs/{run_id}').replySequence([{ status: 200, body: { id: 555, event: 'workflow_dispatch', head_branch: BR, head_sha: B, status: 'in_progress', repository: { full_name: `${OWNER}/${REPO}` } } }]);
    const out = await run(busy);
    expect(out.done).toBe(false);
    expect(busy.gh.calls.some((c) => c.route === 'POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel')).toBe(true);
    expect(busy.gh.calls.some((c) => c.route === 'DELETE /repos/{owner}/{repo}/actions/runs/{run_id}')).toBe(false);
    expect((await busy.db.listDevObjects({ runId: RUN, account: OWNER, connection: 'client-1' })).filter((o) => o.cleaned).length).toBe(0);
  });
  it('refuses a workflow run, check run or branch that no longer matches the journal', async () => {
    for (const changes of [{ run: { head_branch: 'main' } }, { run: { event: 'push' } }, { run: { head_sha: A } }, { check: { external_id: 'someone-else' } }, { check: { head_sha: A } }]) {
      const w = await world(changes);
      const out = await run(w);
      expect(out.done).toBe(false);
      expect(w.gh.calls.filter((c) => c.method === 'DELETE')).toEqual([]);
    }
    const moved = await world();
    moved.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { name: BR, protected: false, commit: { sha: 'c'.repeat(40) } });
    expect((await run(moved)).done).toBe(false);
    expect(moved.gh.calls.filter((c) => c.method === 'DELETE')).toEqual([]);
  });
  it('refuses a fixture file whose branch was never recorded', async () => {
    const w = await makeWorld();
    await w.db.createDevRun({ id: RUN, account: OWNER, connection: 'client-1' });
    await record(w, 'branch', BR, A);
    await record(w, 'fixture_file', `rtc/${RUN}/other.md`, B);
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: `${OWNER}/${REPO}`, default_branch: 'main' });
    w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { name: BR, protected: false, commit: { sha: A } });
    w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
    expect((await run(w)).done).toBe(false);
    expect(w.gh.calls.filter((c) => c.method === 'DELETE')).toEqual([]);
  });
});
