import { describe, expect, it } from 'vitest';
import * as p from '../../src/tools/packages-write.js';
import { runWriteContract, doorsFor, makeWorld, parse } from '../../test/helpers/write-contract.js';
const PKG = 'GET /orgs/{org}/packages/{package_type}/{package_name}';
const VER = PKG + '/versions/{package_version_id}';
const DEL = 'DELETE /orgs/{org}/packages/{package_type}/{package_name}/versions/{package_version_id}';
const pkg = { id: 17, name: '@example-org/library', visibility: 'private', version_count: 2, updated_at: '2026-10-10' };
const version = { id: 91, name: '1.2.3', download_count: 4, updated_at: '2026-10-10' };
const def = { tool: p.tools[0], handler: p.handlers.github_package_delete_version };
const args = { scope: 'org', packageType: 'npm', packageName: '@example-org/library', versionId: 91 };
const seq = (gh, route, entries) => gh.when(route).replySequence(entries.map(x =>
  x === null ? { status: 404, body: { message: 'Not Found' } } : { status: 200, body: x }));
const call = (w, a = args) => doorsFor(def)[0].call(w, a).then(parse);
runWriteContract({packageToken:true,
  label: 'github_package_delete_version', definition: def, args,
  needsConfirm: true, production: true, profile: 'full',
  arrange(gh, state) {
    seq(gh, PKG, [pkg, pkg]);
    seq(gh, VER, [version, version, state === 'ok' ? null : version]);
    gh.when(DEL).reply(204, '');
  }
});
describe('G-6 version deletion', () => {
  it('encodes a scoped package name and checks the exact version by ID', async () => {
    const w = await makeWorld({packageToken:true, mode: 'production', profile: 'full' });
    seq(w.gh, PKG, [pkg, pkg]); seq(w.gh, VER, [version, version, null]);
    w.gh.when(DEL).reply(204, '');
    expect((await call(w, { ...args, confirm: true })).status).toBe('applied');
    expect(w.gh.invalid).toEqual([]);
    expect(w.gh.calls.some(x => x.route === DEL && x.path.includes('%2F'))).toBe(true);
  });
  it('refuses deletion for public packages over 5,000 version downloads', async () => {
    const w = await makeWorld({packageToken:true, mode: 'production', profile: 'full' });
    w.gh.when(PKG).reply(200, { ...pkg, visibility: 'public' });
    w.gh.when(VER).reply(200, { ...version, download_count: 5001 });
    expect((await call(w, { ...args, confirm: true })).status).toBe('rejected');
    expect(w.gh.calls.every(x=>x.method === 'GET')).toBe(true);
  });
  it('does not confuse permission refusal with a missing version', async () => {
    const w = await makeWorld({packageToken:true, mode: 'production', profile: 'full' });
    w.gh.when(PKG).reply(403, { message: 'Forbidden' });
    const out = await call(w, { ...args, confirm: true });
    expect(out.status).not.toBe('applied');
    expect(w.gh.calls.every(x=>x.method === 'GET')).toBe(true);
  });
  it('rejects an intervening version update without deleting', async () => {
    const w = await makeWorld({packageToken:true, mode: 'production', profile: 'full' });
    seq(w.gh, PKG, [pkg, pkg]);
    seq(w.gh, VER, [version, { ...version, name: 'changed' }]);
    expect((await call(w, { ...args, confirm: true })).status).toBe('rejected');
    expect(w.gh.calls.some(x=>x.method === 'DELETE')).toBe(false);
  });
});
