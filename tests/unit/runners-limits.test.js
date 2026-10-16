import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import * as read from '../../src/tools/runners-read.js';
import * as write from '../../src/tools/runners-write.js';
import * as limits from '../../src/tools/actions-limits.js';
import { spendGate } from '../../test/helpers/fixture-gates.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';

const def = (ns, name) => ({ tool: ns.tools.find((t) => t.name === name), handler: ns.handlers[name] });
const O = 'example-org';
const R = { owner: O, repo: 'app' };
const ok = (outcome) => outcome === 'ok';
const runner = (over = {}) => ({ id: 7, name: 'builder-1', os: 'linux', status: 'online', busy: false, labels: [{ id: 1, name: 'self-hosted', type: 'read-only' }, { id: 2, name: 'gpu', type: 'custom' }], ...over });
const group = (over = {}) => ({ id: 3, name: 'ci', visibility: 'selected', default: false, allows_public_repositories: false, runners_url: 'x', inherited: false, ...over });

const runnerRoutes = (gh, o, state = {}) => {
  let r = runner(state);
  gh.when('GET /orgs/{org}/actions/runners/{runner_id}').reply(200, () => r);
  gh.when('DELETE /orgs/{org}/actions/runners/{runner_id}').reply(204, () => { if (ok(o)) gh.when('GET /orgs/{org}/actions/runners/{runner_id}').reply(404, { message: 'Not Found' }); return null; });
  gh.when('PUT /orgs/{org}/actions/runners/{runner_id}/labels').reply(200, (req) => { if (ok(o)) { r = runner({ labels: [{ id: 1, name: 'self-hosted', type: 'read-only' }, ...req.body.labels.map((n, i) => ({ id: 10 + i, name: n, type: 'custom' }))] }); } return { total_count: 1, labels: r.labels }; });
};
runWriteContract({ label: 'github_runner_remove', definition: def(write, 'github_runner_remove'), args: { owner: O, runnerId: 7 }, needsConfirm: true, production: true, profile: 'full', arrange: (gh, o) => runnerRoutes(gh, o) });
runWriteContract({ label: 'github_runner_set_labels', definition: def(write, 'github_runner_set_labels'), args: { owner: O, runnerId: 7, labels: ['gpu', 'big'] }, needsConfirm: true, profile: 'full', arrange: (gh, o) => runnerRoutes(gh, o) });

const groupRoutes = (gh, o) => {
  let g = group();
  gh.when('GET /orgs/{org}/actions/runner-groups').reply(200, () => ({ total_count: 1, runner_groups: [g] }));
  gh.when('GET /orgs/{org}/actions/runner-groups/{runner_group_id}').reply(200, () => g);
  gh.when('POST /orgs/{org}/actions/runner-groups').reply(201, (req) => { const n = group({ id: 4, name: req.body.name, visibility: req.body.visibility ?? 'private' }); if (ok(o)) gh.when('GET /orgs/{org}/actions/runner-groups/{runner_group_id}').reply(200, n); return n; });
  gh.when('PATCH /orgs/{org}/actions/runner-groups/{runner_group_id}').reply(200, (req) => { if (ok(o)) g = { ...g, ...req.body }; return g; });
  gh.when('DELETE /orgs/{org}/actions/runner-groups/{runner_group_id}').reply(204, () => { if (ok(o)) gh.when('GET /orgs/{org}/actions/runner-groups/{runner_group_id}').reply(404, { message: 'Not Found' }); return null; });
  let repos = [1]; let runners = [7];
  gh.when('GET /orgs/{org}/actions/runner-groups/{runner_group_id}/repositories').reply(200, () => ({ total_count: repos.length, repositories: repos.map((id) => ({ id })) }));
  gh.when('GET /orgs/{org}/actions/runner-groups/{runner_group_id}/runners').reply(200, () => ({ total_count: runners.length, runners: runners.map((id) => ({ id })) }));
  gh.when('PUT /orgs/{org}/actions/runner-groups/{runner_group_id}/repositories').reply(204, (req) => { if (ok(o)) repos = req.body.selected_repository_ids; return null; });
  gh.when('PUT /orgs/{org}/actions/runner-groups/{runner_group_id}/runners').reply(204, (req) => { if (ok(o)) runners = req.body.runners; return null; });
};
runWriteContract({ label: 'github_runner_group_save', definition: def(write, 'github_runner_group_save'), args: { org: O, name: 'builders', visibility: 'private' }, needsConfirm: true, profile: 'full', arrange: groupRoutes });
runWriteContract({ label: 'github_runner_group_delete', definition: def(write, 'github_runner_group_delete'), args: { org: O, groupId: 3, name: 'ci' }, needsConfirm: true, production: true, profile: 'full', arrange: groupRoutes });
runWriteContract({ label: 'github_runner_group_set_access', definition: def(write, 'github_runner_group_set_access'), args: { org: O, groupId: 3, repositoryIds: [1, 2] }, needsConfirm: true, accessWidening: true, profile: 'full', arrange: groupRoutes });

const SECRET = 'AFAKE_TOKEN_123';
const registerRoutes = (gh, o = 'ok') => {
  gh.when('GET /orgs/{org}/actions/runners').reply(200, { total_count: 0, runners: [] });
  gh.when('POST /orgs/{org}/actions/runners/registration-token').reply(201, { token: SECRET, expires_at: ok(o) ? '2026-10-10T19:00:00Z' : '2026-10-10T17:00:00Z' });
};
runWriteContract({ label: 'github_runner_register', definition: def(write, 'github_runner_register'), args: { owner: O, kind: 'registration' }, needsConfirm: true, production: true, accessWidening: true, profile: 'full', arrange: (gh, o) => registerRoutes(gh, o) });

// limits: the second value is larger than today's, so the contract exercises the spend gate (1 cent placeholder)
const limitRoutes = (gh, o) => {
  let days = 7;
  gh.when('GET /organizations/{org}/actions/cache/retention-limit').reply(200, () => ({ max_cache_retention_days: days }));
  gh.when('PUT /organizations/{org}/actions/cache/retention-limit').reply(204, (req) => { if (ok(o)) days = req.body.max_cache_retention_days; return null; });
};
runWriteContract({ label: 'github_actions_set_limits', definition: def(limits, 'github_actions_set_limits'), args: { owner: O, setting: 'cacheRetentionDays', value: 14 }, needsConfirm: true, spendCents: 1, profile: 'full', arrange: limitRoutes });

const rulesRoutes = (gh, o) => {
  let rules = [];
  const P = '/repos/{owner}/{repo}/environments/{environment_name}/deployment_protection_rules';
  gh.when(`GET ${P}`).reply(200, () => ({ total_count: rules.length, custom_deployment_protection_rules: rules }));
  gh.when(`GET ${P}/apps`).reply(200, { total_count: 1, available_custom_deployment_protection_rule_integrations: [{ id: 44, slug: 'gatekeeper', integration_url: 'https://example.com', node_id: 'A_1' }] });
  gh.when(`POST ${P}`).reply(201, () => { const r = { id: 9, node_id: 'R_9', enabled: true, app: { id: 44, slug: 'gatekeeper', integration_url: 'https://example.com', node_id: 'A_1' } }; if (ok(o)) rules = [r]; return r; });
};
runWriteContract({ label: 'github_env_protection_rule_save', definition: def(limits, 'github_env_protection_rule_save'), args: { ...R, environment: 'staging', action: 'add', integrationId: 44 }, needsConfirm: true, profile: 'full', arrange: rulesRoutes });

runWriteContract({ label: 'github_deploy_review_custom_rule', definition: def(limits, 'github_deploy_review_custom_rule'), args: { ...R, runId: 99, environment: 'staging', state: 'approved' }, needsConfirm: true, production: true, profile: 'full',
  arrange: (gh, o) => {
    let status = 'waiting';
    gh.when('GET /repos/{owner}/{repo}/actions/runs/{run_id}').reply(200, () => ({ id: 99, status, conclusion: null }));
    gh.when('POST /repos/{owner}/{repo}/actions/runs/{run_id}/deployment_protection_rule').reply(204, () => { if (ok(o)) status = 'in_progress'; return null; });
  } });

runWriteContract({ label: 'github_pages_build_request', definition: def(limits, 'github_pages_build_request'), args: R, needsConfirm: false, profile: 'full',
  arrange: (gh, o) => {
    gh.when('GET /repos/{owner}/{repo}/pages/builds/latest').reply(200, { url: 'x', status: 'built', created_at: '2026-10-01T00:00:00Z' });
    gh.when('POST /repos/{owner}/{repo}/pages/builds').reply(201, () => { if (ok(o)) gh.when('GET /repos/{owner}/{repo}/pages/builds/latest').reply(200, { url: 'x', status: 'queued', created_at: '2026-10-10T18:00:00Z' }); return { url: 'x', status: 'queued' }; });
  } });

describe('Y-6 rules', () => {
  const run = async (w, name, args, gates = []) => parse(await createDispatch({ env: w.ctx.env, credentials: w.credentials, gates, fetch: w.gh.fetch, now: w.ctx.now, sleep: w.ctx.sleep })({ registry, name, args, connection: w.connection, db: w.db }));
  const writesOf = (w) => w.gh.calls.filter((c) => !['GET', 'HEAD'].includes(c.method));
  it('all twelve tools are registered with short descriptions; writes are full profile only', () => {
    const names = [...read.tools, ...write.tools, ...limits.tools].map((t) => t.name);
    expect(names).toHaveLength(12);
    for (const n of names) { const t = registry.tools.find((x) => x.name === n); expect(t, n).toBeTruthy(); expect(t.description.length, n).toBeLessThanOrEqual(160); }
    expect(registry.tools.find((t) => t.name === 'github_runner_register').declarations.profiles).toEqual(['full']);
  });
  it('a busy online runner is never removed', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    runnerRoutes(w.gh, 'ok', { busy: true });
    const r = await run(w, 'github_runner_remove', { owner: O, runnerId: 7, confirm: true }).catch(() => ({ done: false }));
    expect(r.done).not.toBe(true);
    expect(writesOf(w).filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });
  it('allowing public repositories on a runner group asks first with a warning and is off by default', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    groupRoutes(w.gh, 'ok');
    const r = await run(w, 'github_runner_group_save', { org: O, groupId: 3, name: 'ci', allowsPublicRepositories: true, dryRun: true });
    expect(JSON.stringify(r)).toMatch(/stranger|public repositories/i);
    expect(writesOf(w)).toHaveLength(0);
  });
  it('the runner token reaches no tool result and no change log', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    registerRoutes(w.gh);
    const r = await run(w, 'github_runner_register', { owner: O, kind: 'registration', confirm: true });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(JSON.stringify(r)).toMatch(/setup/);
    const log = await w.db.listChanges({ includePreviews: true, limit: 50 });
    expect(log.length).toBeGreaterThan(0);
    expect(JSON.stringify(log)).not.toContain(SECRET);
  });
  it('raising a storage limit is blocked at a $0 spend limit; lowering it is not', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    const g = [spendGate({ limitCents: 0 })];
    limitRoutes(w.gh, 'ok');
    const up = await run(w, 'github_actions_set_limits', { owner: O, setting: 'cacheRetentionDays', value: 30, confirm: true }, g).catch(() => ({ done: false }));
    expect(up.done).not.toBe(true);
    expect(writesOf(w)).toHaveLength(0);
    const down = await run(w, 'github_actions_set_limits', { owner: O, setting: 'cacheRetentionDays', value: 3, dryRun: true }, g);
    expect(JSON.stringify(down)).not.toMatch(/INCREASE/);
  });
  it('an app GitHub does not list cannot be added as a protection rule', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    rulesRoutes(w.gh, 'ok');
    const r = await run(w, 'github_env_protection_rule_save', { ...R, environment: 'staging', action: 'add', integrationId: 555, confirm: true }).catch(() => ({ done: false }));
    expect(r.done).not.toBe(true);
    expect(writesOf(w)).toHaveLength(0);
  });
  it('a run that is not waiting cannot be answered', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when('GET /repos/{owner}/{repo}/actions/runs/{run_id}').reply(200, { id: 99, status: 'completed', conclusion: 'success' });
    const r = await run(w, 'github_deploy_review_custom_rule', { ...R, runId: 99, environment: 'staging', state: 'approved', confirm: true }).catch(() => ({ done: false }));
    expect(r.done).not.toBe(true);
    expect(writesOf(w)).toHaveLength(0);
  });
});
