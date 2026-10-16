import { describe, expect, it } from 'vitest';
import { makeWorld } from '../../test/helpers/write-contract.js';
import { registry } from '../../src/tools/index.js';
import * as integration from '../../src/tools/dev-integration.js';

const OWNER = 'example-org', REPO = 'my-app';
const run = (w, spec) => integration.handlers.github_dev_check_integration({ repo: REPO, spec }, w.ctx);
function arrange(gh, over = {}) {
  gh.when('GET /repos/{owner}/{repo}').reply(200, { full_name: `${OWNER}/${REPO}`, default_branch: 'main' });
  gh.when('GET /repos/{owner}/{repo}/hooks').reply(200, over.hooks ?? [{ id: 1, active: true, events: ['push'] }, { id: 2, active: false, events: ['issues'] }]);
  gh.when('GET /repos/{owner}/{repo}/actions/secrets').reply(200, over.secrets ?? { total_count: 1, secrets: [{ name: 'DEPLOY_KEY' }] });
  gh.when('GET /repos/{owner}/{repo}/actions/variables').reply(200, over.variables ?? { total_count: 1, variables: [{ name: 'REGION', value: 'must-not-appear' }] });
  gh.when('GET /repos/{owner}/{repo}/actions/workflows').reply(200, over.workflows ?? { total_count: 1, workflows: [{ id: 1, path: '.github/workflows/ci.yml' }] });
  gh.when('GET /repos/{owner}/{repo}/environments').reply(200, over.environments ?? { total_count: 1, environments: [{ name: 'staging' }] });
  gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, over.rules ?? [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci' }] } }]);
}
const spec = { webhookEvents: ['push', 'issues', 'release'], secrets: ['DEPLOY_KEY', 'API_TOKEN'], variables: ['REGION', 'STAGE'], workflows: ['.github/workflows/ci.yml', '.github/workflows/deploy.yml'], environments: ['staging', 'production'], requiredChecks: ['ci', 'e2e'] };

describe('V-5 integration check', () => {
  it('reports every item ok or missing with the exact fix, reads only, and never shows a value', async () => {
    const w = await makeWorld();
    arrange(w.gh);
    const out = await run(w, spec);
    const by = (area, item) => out.items.find((i) => i.area === area && i.item === item);
    expect(['push', 'issues', 'release'].map((e) => by('webhook event', e).status)).toEqual(['ok', 'missing', 'missing']);
    expect([by('secret', 'DEPLOY_KEY').status, by('secret', 'API_TOKEN').status]).toEqual(['ok', 'missing']);
    expect([by('variable', 'REGION').status, by('variable', 'STAGE').status]).toEqual(['ok', 'missing']);
    expect([by('workflow', '.github/workflows/ci.yml').status, by('workflow', '.github/workflows/deploy.yml').status]).toEqual(['ok', 'missing']);
    expect([by('environment', 'staging').status, by('environment', 'production').status]).toEqual(['ok', 'missing']);
    expect([by('required check', 'ci').status, by('required check', 'e2e').status]).toEqual(['ok', 'missing']);
    expect(by('secret', 'API_TOKEN').fix.tool).toBe('github_secret_set');
    expect(JSON.stringify(out)).not.toContain('must-not-appear');
    expect(out).toMatchObject({ ok: 6, missing: 7, unreadable: 0, all_ok: false });
    expect(w.gh.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    expect(w.gh.invalid).toEqual([]);
  });
  it('reports a refused or plan-limited read as unreadable, never as missing', async () => {
    const w = await makeWorld();
    arrange(w.gh);
    w.gh.when('GET /repos/{owner}/{repo}/actions/secrets').reply(403, { message: 'Resource not accessible' });
    w.gh.when('GET /repos/{owner}/{repo}/environments').reply(404, { message: 'Not Found' });
    const out = await run(w, { secrets: ['DEPLOY_KEY'], environments: ['staging'], requiredChecks: ['ci'] });
    expect(out.items.map((i) => i.status)).toEqual(['unreadable', 'unreadable', 'ok']);
    expect(out).toMatchObject({ missing: 0, unreadable: 2 });
  });
  it('compares app permissions with the recorded installation, and says so when none is recorded', async () => {
    const app = await makeWorld({ scratchAccount: true });
    arrange(app.gh);
    await app.db.setInstallation(OWNER, { installationId: 902, repositorySelection: 'all', permissions: { contents: 'write', issues: 'read' }, status: 'active' });
    const out = await run(app, { appPermissions: { contents: 'read', issues: 'write', checks: 'write' } });
    expect(out.items.map((i) => i.status)).toEqual(['ok', 'missing', 'missing']);
    expect(app.gh.calls).toEqual([]);
    const plain = await makeWorld();
    expect((await run(plain, { appPermissions: { contents: 'read' } })).items[0].status).toBe('unreadable');
  });
  it('refuses an empty spec and other accounts, and every suggested tool exists in the registry', async () => {
    const w = await makeWorld();
    arrange(w.gh);
    await expect(run(w, {})).rejects.toThrow(/nothing to check/);
    await expect(integration.handlers.github_dev_check_integration({ owner: 'other-org', repo: REPO, spec }, w.ctx)).rejects.toThrow(/not in this connection/);
    const missing = await run(w, spec);
    const unread = await makeWorld();
    arrange(unread.gh);
    for (const route of ['hooks', 'actions/secrets', 'actions/variables', 'actions/workflows', 'environments']) unread.gh.when(`GET /repos/{owner}/{repo}/${route}`).reply(403, { message: 'no' });
    unread.gh.when('GET /repos/{owner}/{repo}').reply(403, { message: 'no' });
    const tools = new Set([...missing.items, ...(await run(unread, spec)).items].flatMap((i) => (i.fix ? [i.fix.tool, i.fix.then?.tool].filter(Boolean) : [])));
    expect(tools.size).toBeGreaterThan(5);
    for (const name of tools) expect(registry.tools.some((t) => t.name === name), name).toBe(true);
  });
});
