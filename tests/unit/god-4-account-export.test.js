// GOD-4 C (+B): account export tools and the codespace machines read.
import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import * as exp from '../../src/tools/account-export.js';
import * as billing from '../../src/tools/billing-read.js';

const def = (name) => ({ tool: exp.tools.find((t) => t.name === name), handler: exp.handlers[name] });
const withMaster = async (w) => {
  w.credentials.masterStatus = async () => ({ enrolled: true, scopes: ['repo', 'codespace'], expires_at: null });
  const base = w.credentials.token.bind(w.credentials);
  w.credentials.token = async (o) => (o.cred === 'M' ? 'ghp_FAKEmaster' : base(o));
};
const M = (id, state, extra = {}) => ({ id, state, lock_repositories: false, repositories: [{ full_name: 'example-owner/sample' }], created_at: '2026-10-23T00:00:00Z', updated_at: '2026-10-23T00:00:00Z', ...extra });
const seq = (gh, route, steps) => gh.when(route).replySequence(steps.map(([status, body, headers]) => ({ status, body, ...(headers ? { headers } : {}) })));
const opts = { profile: 'full', needsConfirm: true, production: true, prepare: withMaster };

runWriteContract({ ...opts, label: 'github_account_export_start', definition: def('github_account_export_start'), args: { repositories: ['sample'] },
  arrange(gh, outcome) {
    gh.when('GET /user').reply(200, { id: 1, login: 'example-owner', type: 'User' });
    gh.when('GET /user/migrations').reply(200, []);
    gh.when('POST /user/migrations').reply(201, M(7, 'pending'));
    gh.when('GET /user/migrations/{migration_id}').reply(200, M(7, outcome === 'ok' ? 'exporting' : 'failed'));
  } });
runWriteContract({ ...opts, label: 'github_account_export_delete', definition: def('github_account_export_delete'), args: { migrationId: 7 },
  arrange(gh, outcome) {
    gh.when('GET /user/migrations/{migration_id}').reply(200, M(7, 'exported'));
    seq(gh, 'GET /user/migrations/{migration_id}/archive', outcome === 'ok'
      ? [[302, null, { location: 'https://example.test/x' }], [404, { message: 'Not Found' }]]
      : [[302, null, { location: 'https://example.test/x' }], [302, null, { location: 'https://example.test/x' }]]);
    gh.when('DELETE /user/migrations/{migration_id}/archive').reply(204, null);
  } });

describe('GOD-4 account export and machines', () => {
  it('start never locks repositories', async () => {
    const w = await makeWorld({ profile: 'full', mode: 'production' });
    await withMaster(w);
    w.gh.when('GET /user').reply(200, { id: 1, login: 'example-owner', type: 'User' });
    w.gh.when('GET /user/migrations').reply(200, []);
    w.gh.when('POST /user/migrations').reply(201, M(7, 'pending'));
    w.gh.when('GET /user/migrations/{migration_id}').reply(200, M(7, 'exporting'));
    const out = parse(await exp.handlers.github_account_export_start({ repositories: ['sample', 'example-org/widgets'], confirm: true }, w.ctx));
    expect(out.status).toBe('applied');
    expect(w.gh.calls.find((c) => c.route === 'POST /user/migrations').body.repositories).toEqual(['example-owner/sample', 'example-org/widgets']);
    expect(w.gh.invalid).toEqual([]);
    expect(w.gh.calls.find((c) => c.route === 'POST /user/migrations').body.lock_repositories).toBe(false);
    expect(Object.keys(exp.tools.find((t) => t.name === 'github_account_export_start').inputSchema.properties)).not.toContain('lockRepositories');
  });
  it('status lists and the link returns the address only (no download)', async () => {
    const w = await makeWorld({ profile: 'full', mode: 'production' });
    await withMaster(w);
    w.gh.when('GET /user/migrations').reply(200, [M(7, 'exported')]);
    w.gh.when('GET /user/migrations/{migration_id}').reply(200, M(7, 'exported'));
    w.gh.when('GET /user/migrations/{migration_id}/archive').reply(302, null, { location: 'https://example.test/signed' });
    expect((await exp.handlers.github_account_export_status({}, w.ctx)).exports).toHaveLength(1);
    const link = (await exp.handlers.github_account_export_link({ migrationId: 7 }, w.ctx));
    expect(link).toMatchObject({ sensitive: true, link: null, sensitive_redirect_omitted: true,
      github_web_url: 'https://github.com/settings' });
    expect(w.gh.calls.some((c) => String(c.url ?? '').includes('example.test'))).toBe(false);
  });
  it('never returns a signed account export redirect, including detail:full', async () => {
    for (const detail of [undefined, 'full']) {
      const w = await makeWorld({ profile: 'full', mode: 'production' });
      await withMaster(w);
      const secret = 'opaque-export-bearer-1234567890';
      w.gh.when('GET /user/migrations/{migration_id}').reply(200, M(7, 'exported'));
      w.gh.when('GET /user/migrations/{migration_id}/archive').reply(302, null, {
        location: 'https://api.github.com/user/migrations/7/archive?sig=' + secret
      });
      const result = await exp.handlers.github_account_export_link({ migrationId: 7, ...(detail ? { detail } : {}) }, w.ctx);
      expect(result).toMatchObject({ link: null, sensitive_redirect_omitted: true });
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });
  it('link says not ready before the export finishes', async () => {
    const w = await makeWorld({ profile: 'full', mode: 'production' });
    await withMaster(w);
    w.gh.when('GET /user/migrations/{migration_id}').reply(200, M(7, 'exporting'));
    expect((await exp.handlers.github_account_export_link({ migrationId: 7 }, w.ctx))).toMatchObject({ link: null });
  });
  it('machines read uses the name and the master token', async () => {
    const w = await makeWorld({ profile: 'full', mode: 'production' });
    await withMaster(w);
    w.gh.when('GET /user').reply(200, { id: 1, login: 'example-owner', type: 'User' });
    w.gh.when('GET /user/codespaces/{codespace_name}/machines').reply(200, { total_count: 1, machines: [{ name: 'basicLinux32gb', display_name: '2 cores', operating_system: 'linux', storage_in_bytes: 34359738368, memory_in_bytes: 8589934592, cpus: 2, prebuild_availability: null }] });
    const out = await billing.codespaceMachines.handler({ codespaceName: 'sample-abc123' }, w.ctx);
    expect(out.machines[0]).toMatchObject({ name: 'basicLinux32gb', cpus: 2, memory_gb: 8, storage_gb: 32 });
    expect(w.gh.calls.find((c) => c.route === 'GET /user/codespaces/{codespace_name}/machines').headers.authorization).toContain('ghp_FAKEmaster');
    expect(w.gh.invalid).toEqual([]);
    expect(billing.codespaceMachines.tool.inputSchema.properties.codespaceName.pattern).toBe('^[A-Za-z0-9-]{1,90}$');
  });
});
