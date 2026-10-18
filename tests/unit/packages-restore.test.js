import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, doorsFor, parse } from '../../test/helpers/write-contract.js';
import * as restore from '../../src/tools/packages-restore.js';
const ROOT = 'GET /orgs/{org}/packages/{package_type}/{package_name}';
const GETV = ROOT + '/versions/{package_version_id}';
const POSTV = 'POST /orgs/{org}/packages/{package_type}/{package_name}/versions/{package_version_id}/restore';
const POST = 'POST /orgs/{org}/packages/{package_type}/{package_name}/restore';
const UROOT = 'GET /user/packages/{package_type}/{package_name}';
const UPOST = 'POST /user/packages/{package_type}/{package_name}/restore';
const pkg = { id: 18, name: '@example-org/library', package_type: 'npm', updated_at: '2026-10-10' };
const ver = { id: 41, name: '1.0.0' };
const args = { scope: 'org', packageType: 'npm', packageName: pkg.name, versionId: 41 };
const def = { tool: restore.tools[0], handler: restore.handlers.github_package_restore_version };
const seq = (gh, route, list) => gh.when(route).replySequence(list.map(x => x === null
  ? { status: 404, body: { message: 'Not Found' } } : { status: 200, body: x }));
const call = (w, a) => doorsFor(def)[0].call(w, a).then(parse);
runWriteContract({packageToken:true,
  label: 'github_package_restore_version exact ID', definition: def,
  args, needsConfirm: true, production: true, profile: 'full',
  arrange(gh, outcome) {
    gh.when(ROOT).reply(200, pkg);
    seq(gh, GETV, [null, null, outcome === 'ok' ? ver : null]);
    gh.when(POSTV).reply(204, '');
  }
});
runWriteContract({packageToken:true,
  label: 'github_package_restore_version whole package', definition: def,
  args: { scope: 'org', packageType: 'npm', packageName: pkg.name }, needsConfirm: true, production: true, profile: 'full',
  arrange(gh, outcome) {
    seq(gh, ROOT, [null, null, outcome === 'ok' ? pkg : null]);
    gh.when(POST).reply(204, '');
  }
});
describe('G-6 package and version recovery', () => {
  it('does not restore an active package or overwrite an existing version', async () => {
    for (const a of [{ scope: 'org', packageType: 'npm', packageName: pkg.name }, args]) {
      const w = await makeWorld({packageToken:true, mode: 'production', profile: 'full' });
      w.gh.when(ROOT).reply(200, pkg);
      if (a.versionId) w.gh.when(GETV).reply(200, ver);
      expect((await call(w, { ...a, confirm: true })).status).toBe('rejected');
      expect(w.gh.calls.every(c=>c.method==='GET')).toBe(true);
    }
  });
  it('uses user route for a whole package and preserves scoped name encoding', async () => {
    const w = await makeWorld({packageToken:true,packageUser:true, mode: 'production', profile: 'full' });
    seq(w.gh, UROOT, [null, null, pkg]); w.gh.when(UPOST).reply(204, '');
    const result = await call(w, { scope: 'user', packageType: 'npm', packageName: pkg.name, confirm: true });
    expect(result.status).toBe('applied');
    const req = w.gh.calls.find(c=>c.method==='POST');
    expect(req.route).toBe(UPOST); expect(req.path).toContain('%2F');
    expect(w.gh.invalid).toEqual([]);
  });
  it('permission refusal remains an error, not a deleted-target signal', async () => {
    const w = await makeWorld({packageToken:true, mode: 'production', profile: 'full' });
    w.gh.when(ROOT).reply(403, { message: 'Forbidden' });
    expect((await call(w, { ...args, confirm: true })).status).not.toBe('applied');
    expect(w.gh.calls.every(c=>c.method==='GET')).toBe(true);
  });
  it('rejects a changed parent package before restoring a version', async () => {
    const w = await makeWorld({packageToken:true, mode: 'production', profile: 'full' });
    seq(w.gh, ROOT, [pkg, { ...pkg, id: 99 }]);
    w.gh.when(GETV).reply(404, { message: 'Not Found' });
    expect((await call(w, { ...args, confirm: true })).status).toBe('rejected');
    expect(w.gh.calls.every(c=>c.method==='GET')).toBe(true);
  });
  it('previews the 30-day window and namespace reuse risk', async () => {
    const w = await makeWorld({packageToken:true, mode: 'production', profile: 'full' });
    w.gh.when(ROOT).reply(404, { message: 'Not Found' });
    const result = await call(w, { scope: 'org', packageType: 'npm', packageName: pkg.name, dryRun: true });
    expect(result.preview).toMatch(/30 days/);
    expect(result.preview).toMatch(/namespace/);
  });
});
