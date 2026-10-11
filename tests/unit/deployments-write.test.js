import { describe, it, expect } from 'vitest';
import { runWriteContract, makeWorld, doorsFor, parse } from '../../test/helpers/write-contract.js';
import * as deployments from '../../src/tools/deployments-write.js';

const R = { repo: 'hello', ref: 'feature', environment: 'staging' };
const repo = { name: 'hello', default_branch: 'main' };
const deploy = { id: 42, ref: 'feature', environment: 'staging', production_environment: false };
const status = { id: 71, state: 'success', description: 'Ready' };
const CREATE = 'POST /repos/{owner}/{repo}/deployments';
const DEPLOY = 'GET /repos/{owner}/{repo}/deployments/{deployment_id}';
const STATUS = 'POST /repos/{owner}/{repo}/deployments/{deployment_id}/statuses';
const STATUSES = 'GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses';
const REPO = 'GET /repos/{owner}/{repo}';
const ENV = 'GET /repos/{owner}/{repo}/environments/{environment_name}';
const BRANCH = 'GET /repos/{owner}/{repo}/branches/{branch}';
const RULES = 'GET /repos/{owner}/{repo}/rules/branches/{branch}';
const def = (name) => ({ tool: deployments.tools.find((t) => t.name === name), handler: deployments.handlers[name] });
const writes = (gh) => gh.calls.filter((c) => ['PUT', 'POST', 'DELETE', 'PATCH'].includes(c.method));
const call = async (name, world, args) => parse(await doorsFor(def(name))[0].call(world, args));
function safeRef(gh) {
  gh.when(REPO).reply(200, repo);
  gh.when(ENV).reply(404, { message: 'not found' });
  gh.when(BRANCH).reply(200, { protected: false });
  gh.when(RULES).reply(200, []);
}
runWriteContract({
  label: 'github_deploy_create (no branch auto-merge)', definition: def('github_deploy_create'),
  args: R, needsConfirm: true, profile: 'everyday',
  arrange(gh, outcome) {
    safeRef(gh);
    gh.when(CREATE).reply(201, { id: 42, ref: 'feature', environment: 'staging' });
    gh.when(DEPLOY).reply(200, outcome === 'ok' ? deploy : { ...deploy, environment: 'different' });
  }
});
runWriteContract({
  label: 'github_deploy_set_status (actual deployment)', definition: def('github_deploy_set_status'),
  args: { repo: 'hello', deploymentId: 42, state: 'success', description: 'Ready' },
  profile: 'everyday',
  arrange(gh, outcome) {
    safeRef(gh);
    gh.when(DEPLOY).reply(200, deploy);
    gh.when(STATUS).reply(201, status);
    gh.when(STATUSES).reply(200, outcome === 'ok' ? [status] : [{ ...status, state: 'failure' }]);
  }
});

describe('G-4 deployment writes', () => {
  it('always disables auto-merge and preserves required checks', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'everyday' });
    safeRef(w.gh);
    w.gh.when(CREATE).reply(201, deploy);
    w.gh.when(DEPLOY).reply(200, deploy);
    const result = await call('github_deploy_create', w, { ...R, confirm: true });
    expect(result.status).toBe('applied');
    expect(writes(w.gh)[0].body).toMatchObject({ ref: 'feature', environment: 'staging', auto_merge: false });
    expect(writes(w.gh)[0].body).not.toHaveProperty('required_contexts');
    expect(w.gh.invalid).toEqual([]);
  });

  it('never sends a production deployment from preview mode', async () => {
    const w = await makeWorld({ mode: 'preview', profile: 'everyday' });
    safeRef(w.gh);
    const out = await call('github_deploy_create', w, { ...R, environment: 'production', confirm: true });
    expect(out).toMatchObject({ status: 'refused_by_guard', refusedBy: 'mode' });
    expect(writes(w.gh)).toEqual([]);
  });

  it('honors an explicit production flag even for staging', async () => {
    const w = await makeWorld({ mode: 'preview', profile: 'everyday' });
    safeRef(w.gh);
    const out = await call('github_deploy_create', w, { ...R, productionEnvironment: true, confirm: true });
    expect(out).toMatchObject({ status: 'refused_by_guard', refusedBy: 'mode' });
    expect(writes(w.gh)).toEqual([]);
  });

  it('does not turn a 202 merge response into a created deployment', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'everyday' });
    safeRef(w.gh);
    w.gh.when(CREATE).reply(202, { sha: '0123456789abcdef' });
    const out = await call('github_deploy_create', w, { ...R, confirm: true });
    expect(out.status).not.toBe('applied');
    expect(writes(w.gh)).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });

  it('derives status production protection from GitHub deployment, not caller labels', async () => {
    const w = await makeWorld({ mode: 'preview', profile: 'everyday' });
    w.gh.when(DEPLOY).reply(200, { ...deploy, environment: 'production' });
    const out = await call('github_deploy_set_status', w,
      { repo: 'hello', deploymentId: 42, state: 'success', confirm: true });
    expect(out).toMatchObject({ status: 'refused_by_guard', refusedBy: 'mode' });
    expect(writes(w.gh)).toEqual([]);
  });

  it('refuses unknown deployment ids and never guesses a safe environment', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'everyday' });
    w.gh.when(DEPLOY).reply(404, { message: 'Not found' });
    const out = await call('github_deploy_set_status', w,
      { repo: 'hello', deploymentId: 999, state: 'failure' });
    expect(out.status).not.toBe('applied');
    expect(writes(w.gh)).toEqual([]);
  });

  it('verifies the exact status id rather than assuming a successful latest write', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'everyday' });
    safeRef(w.gh);
    w.gh.when(DEPLOY).reply(200, deploy);
    w.gh.when(STATUS).reply(201, status);
    w.gh.when(STATUSES).reply(200, [{ id: 72, state: 'success' }]);
    const out = await call('github_deploy_set_status', w,
      { repo: 'hello', deploymentId: 42, state: 'success' });
    expect(out.status).toBe('unconfirmed');
    expect(writes(w.gh)).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
});
