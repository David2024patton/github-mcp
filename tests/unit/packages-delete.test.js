import { describe, expect, it } from 'vitest';
import * as p from '../../src/tools/packages-write.js';
import { runWriteContract, makeWorld, doorsFor, parse } from '../../test/helpers/write-contract.js';
const PKG = 'GET /orgs/{org}/packages/{package_type}/{package_name}';
const VER = PKG + '/versions';
const DEL = 'DELETE /orgs/{org}/packages/{package_type}/{package_name}';
const USER_PKG = 'GET /users/{username}/packages/{package_type}/{package_name}';
const USER_VER = USER_PKG + '/versions';
const USER_DEL = 'DELETE /users/{username}/packages/{package_type}/{package_name}';
const pkg = { id: 5, name: '@example-org/widgets', visibility: 'private', version_count: 2, updated_at: '2026-10-10' };
const versions = [{ id: 11, name: 'v1', download_count: 5 }, { id: 12, name: 'v2', download_count: 12 }];
const args = { scope: 'org', packageType: 'npm', packageName: pkg.name };
const def = { tool: p.tools.find(t=>t.name === 'github_package_delete'), handler: p.handlers.github_package_delete };
const seq = (gh, route, values) => gh.when(route).replySequence(values.map(body=>
  body === null ? { status: 404, body: { message: 'Not Found' } } : { status: 200, body }));
const call = (w, a=args) => doorsFor(def)[0].call(w,a).then(parse);
runWriteContract({packageToken:true,
  label: 'github_package_delete', definition: def, args, production: true, needsConfirm: true, profile: 'full',
  arrange(gh, outcome) {
    seq(gh, PKG, [pkg, pkg, outcome === 'ok' ? null : pkg]);
    gh.when(VER).reply(200, versions);
    gh.when(DEL).reply(204, '');
  }
});
describe('G-6 whole-package deletion', () => {
  it('shows exact version count in the destructive preview', async () => {
    const w=await makeWorld({packageToken:true,mode:'production',profile:'full'});
    w.gh.when(PKG).reply(200,pkg); w.gh.when(VER).reply(200,versions);
    const out=await call(w,{...args,dryRun:true});
    expect(out.preview).toContain('ALL 2 versions'); expect(out.preview).toContain('30 days');
    expect(w.gh.calls.every(c=>c.method==='GET')).toBe(true);
  });
  it('refuses deletion if the version inventory is incomplete', async () => {
    const w=await makeWorld({packageToken:true,mode:'production',profile:'full'});
    w.gh.when(PKG).reply(200,{...pkg,version_count:3}); w.gh.when(VER).reply(200,versions);
    expect((await call(w,{...args,confirm:true})).status).toBe('rejected');
    expect(w.gh.calls.every(c=>c.method==='GET')).toBe(true);
  });
  it('refuses public packages when any visible version has over 5000 downloads', async () => {
    const w=await makeWorld({packageToken:true,mode:'production',profile:'full'});
    w.gh.when(PKG).reply(200,{...pkg,visibility:'public'});
    w.gh.when(VER).reply(200,[versions[0],{...versions[1],download_count:5001}]);
    expect((await call(w,{...args,confirm:true})).status).toBe('rejected');
    expect(w.gh.calls.every(c=>c.method==='GET')).toBe(true);
  });
  it('distinguishes user routes and omits user-version paging query fields', async () => {
    const w=await makeWorld({packageToken:true,mode:'production',profile:'full'});
    seq(w.gh,USER_PKG,[pkg,pkg,null]); w.gh.when(USER_VER).reply(200,versions);
    w.gh.when(USER_DEL).reply(204,'');
    const out=await call(w,{...args,scope:'user',confirm:true});
    expect(out.status).toBe('applied');
    expect(w.gh.calls.find(c=>c.route===USER_VER).query).toEqual({});
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses an intervening version change instead of deleting a different package state', async () => {
    const w=await makeWorld({packageToken:true,mode:'production',profile:'full'});
    seq(w.gh,PKG,[pkg,pkg]);
    seq(w.gh,VER,[versions,[versions[0],{...versions[1],id:13}]]);
    expect((await call(w,{...args,confirm:true})).status).toBe('rejected');
    expect(w.gh.calls.every(c=>c.method==='GET')).toBe(true);
  });
});
