import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import * as extras from '../../src/tools/org-admin-extras.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';

const def = (name) => ({ tool: extras.tools.find((t) => t.name === name), handler: extras.handlers[name] });
const O = 'example-org';
const ok = (o) => o === 'ok';

runWriteContract({ label: 'github_org_security_manager_set', definition: def('github_org_security_manager_set'), args: { owner: O, teamSlug: 'secops', enabled: true }, needsConfirm: true, production: true, accessWidening: true, profile: 'full',
  arrange: (gh, o) => {
    let teams = [];
    gh.when('GET /orgs/{org}/security-managers').reply(200, () => teams);
    gh.when('PUT /orgs/{org}/security-managers/teams/{team_slug}').reply(204, () => { if (ok(o)) teams = [{ slug: 'secops', id: 1 }]; return null; });
  } });

const cfg = (over = {}) => ({ id: 'ABCD1234', name: 'vnet-1', compute_service: 'actions', network_settings_ids: ['NS1'], failover_network_enabled: false, created_on: '2026-10-01T00:00:00Z', ...over });
runWriteContract({ label: 'github_org_network_config_save', definition: def('github_org_network_config_save'), args: { owner: O, name: 'vnet-1', computeService: 'actions', networkSettingsIds: ['NS1'] }, needsConfirm: true, production: true, profile: 'full',
  arrange: (gh, o) => {
    let items = [];
    gh.when('GET /orgs/{org}/settings/network-configurations').reply(200, () => ({ total_count: items.length, network_configurations: items }));
    gh.when('POST /orgs/{org}/settings/network-configurations').reply(201, (req) => { const c = cfg({ name: ok(o) ? req.body.name : 'other' }); items = [c]; return c; });
  } });

runWriteContract({ label: 'github_org_migration_start', definition: def('github_org_migration_start'), args: { owner: O, repositories: ['app'] }, needsConfirm: true, production: true, profile: 'full',
  arrange: (gh, o) => {
    const mig = (state) => ({ id: 9, node_id: 'x', guid: 'g', state, lock_repositories: false, repositories: [{ full_name: 'example-org/app', name: 'app' }], created_at: 'a', updated_at: 'b' });
    gh.when('GET /orgs/{org}/migrations').reply(200, []);
    gh.when('POST /orgs/{org}/migrations').reply(201, () => { gh.when('GET /orgs/{org}/migrations/{migration_id}').reply(200, mig(ok(o) ? 'pending' : 'failed')); return mig('pending'); });
  } });

describe('org admin extras', () => {
  const run = async (w, name, args) => {
    const result = await createDispatch({ env: w.ctx.env, credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now, sleep: async () => {} })({ registry, name, args, connection: w.connection, db: w.db });
    let body; try { body = parse(result); } catch { body = { message: result.content?.[0]?.text }; }
    return { result, body };
  };
  it('network configurations on a plan without them say not_available_on_plan', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when('GET /orgs/{org}/settings/network-configurations').reply(403, { message: 'Forbidden' });
    const out = await run(w, 'github_org_network_config_list', { owner: O });
    expect(out.result.isError).toBe(true);
  });
  it('lists configurations and shows the migration archive pointer only when exported', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when('GET /orgs/{org}/settings/network-configurations').reply(200, { total_count: 1, network_configurations: [cfg()] });
    expect((await run(w, 'github_org_network_config_list', { owner: O })).body).toMatchObject({ count: 1, items: [{ id: 'ABCD1234', name: 'vnet-1' }] });
    w.gh.when('GET /orgs/{org}/migrations/{migration_id}').reply(200, { id: 9, state: 'exported', lock_repositories: false, repositories: [{ full_name: 'example-org/app' }], created_at: 'a', updated_at: 'b' });
    const done = await run(w, 'github_org_migration_status', { owner: O, migrationId: 9 });
    expect(done.body.archive).toContain('does not fetch');
    expect(JSON.stringify(done.body)).not.toMatch(/archive_url|signature/);
  });
  it('does not start a second migration while one runs, and removes a role nobody has as nothing to do', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when('GET /orgs/{org}/migrations').reply(200, [{ id: 5, state: 'exporting' }]);
    const started = await run(w, 'github_org_migration_start', { owner: O, repositories: ['app'], confirm: true });
    expect(started.body.done).not.toBe(true);
    expect(w.gh.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    w.gh.when('GET /orgs/{org}/security-managers').reply(200, []);
    expect((await run(w, 'github_org_security_manager_set', { owner: O, teamSlug: 'x', enabled: false, confirm: true })).body.done).not.toBe(true);
    expect(w.gh.invalid).toEqual([]);
  });
});
