import { describe, it, expect } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const SITE = 'GET /repos/{owner}/{repo}/pages';
const BUILD = 'GET /repos/{owner}/{repo}/pages/builds/latest';
const ORG = 'GET /orgs/{org}/packages';
const USER = 'GET /users/{username}/packages';
const ORG_V = 'GET /orgs/{org}/packages/{package_type}/{package_name}/versions';
const USER_V = 'GET /users/{username}/packages/{package_type}/{package_name}/versions';
const pkg = { id: 51, name: '@owner/library', package_type: 'npm', visibility: 'private',
  version_count: 2, owner: { login: 'example-org' } };
const version = { id: 12, name: '1.2.0', metadata: { container: { tags: ['current'] } } };
async function run(w, name, args) {
  const dispatch = createDispatch({ credentials: w.credentials, gates: [],
    fetch: w.gh.fetch, now: w.ctx.now });
  return parse(await dispatch({ registry, name, args, connection: w.connection, db: w.db }));
}
describe('G-6 Pages and packages reads', () => {
  it('reads Pages settings plus latest build, preserving source and HTTPS state', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when(SITE).reply(200, { status: 'built', html_url: 'https://example.github.io',
      https_enforced: true, cname: 'docs.example.org', source: { branch: 'docs', path: '/site' } });
    w.gh.when(BUILD).reply(200, { status: 'built', pusher: { login: 'developer' } });
    const out = await run(w, 'github_pages_get', { repo: 'hello' });
    expect(out).toMatchObject({ configured: true, https_enforced: true,
      source: { branch: 'docs', path: '/site' }, latest_build: { status: 'built' } });
    expect(w.gh.invalid).toEqual([]);
    expect(w.gh.calls.every((x) => x.method === 'GET')).toBe(true);
  });
  it('reports an unconfigured Pages site only on 404; keeps 403 as a permission error', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when(SITE).reply(404, { message: 'Not Found' });
    expect(await run(w, 'github_pages_get', { repo: 'hello' })).toMatchObject({ configured: false });
    expect(w.gh.calls).toHaveLength(1);
    const denied = await makeWorld({ profile: 'read_only' });
    denied.gh.when(SITE).reply(403, { message: 'Forbidden' });
    const dispatch = createDispatch({ credentials: denied.credentials, gates: [], fetch: denied.gh.fetch, now: denied.ctx.now });
    const result = await dispatch({ registry, name: 'github_pages_get', args: { repo: 'hello' },
      connection: denied.connection, db: denied.db });
    expect(result.isError).toBe(true);
  });
  it('uses distinct org and user routes and reports incomplete package/versions paging', async () => {
    for (const [scope, route, versions] of [['org', ORG, ORG_V], ['user', USER, USER_V]]) {
      const w = await makeWorld({ profile: 'read_only' });
      w.gh.when(route).reply(200, [pkg]);
      w.gh.when(versions).reply(200, [version]);
      const out = await run(w, 'github_package_list',
        { scope, packageType: 'npm', max: 1, versionMax: 1 });
      expect(out).toMatchObject({ scope, count: 1, next_page_possible: 2,
        items: [{ id: 51, visibility: 'private', version_count: 2,
          versions: [{ id: 12, name: '1.2.0' }], more_versions_possible: true }] });
      expect(w.gh.invalid).toEqual([]);
      expect(w.gh.calls).toHaveLength(2);
    }
  });
  it('can list packages without version calls and propagates permission refusal', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when(ORG).reply(200, [pkg]);
    const out = await run(w, 'github_package_list',
      { scope: 'org', packageType: 'npm', includeVersions: false });
    expect(out.items[0].versions).toBeUndefined();
    expect(w.gh.calls).toHaveLength(1);
    const denied = await makeWorld({ profile: 'read_only' });
    denied.gh.when(ORG).reply(403, { message: 'Forbidden' });
    const dispatch = createDispatch({ credentials: denied.credentials, gates: [],
      fetch: denied.gh.fetch, now: denied.ctx.now });
    const result = await dispatch({ registry, name: 'github_package_list',
      args: { scope: 'org', packageType: 'npm' }, connection: denied.connection, db: denied.db });
    expect(result.isError).toBe(true);
  });
});
