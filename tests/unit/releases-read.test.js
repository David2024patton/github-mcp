import { describe, it, expect } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const LIST = 'GET /repos/{owner}/{repo}/releases';
const ID = 'GET /repos/{owner}/{repo}/releases/{release_id}';
const TAG = 'GET /repos/{owner}/{repo}/releases/tags/{tag}';
const LATEST = 'GET /repos/{owner}/{repo}/releases/latest';
const release = { id: 12, tag_name: 'v1.2.0', name: 'Release v1.2.0', draft: false,
  prerelease: false, target_commitish: 'main', created_at: '2026-10-10T00:00:00Z',
  published_at: '2026-10-11T00:00:00Z', author: { login: 'builder' },
  assets: [{ id: 31, name: 'dist.zip', size: 50, download_count: 3,
    browser_download_url: 'https://github.com/example-org/hello/releases/download/v1.2.0/dist.zip' }] };
const world = () => makeWorld({ profile: 'read_only' });
async function run(w, name, args) {
  const dispatch = createDispatch({ credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now });
  return parse(await dispatch({ registry, name, args, connection: w.connection, db: w.db }));
}

describe('G-5 release metadata reads', () => {
  it('lists releases with truthful paging, draft flags and asset counts', async () => {
    const w = await world();
    w.gh.when(LIST).reply(200, [release]);
    const result = await run(w, 'github_release_list', { repo: 'hello', page: 2, max: 1 });
    expect(result).toMatchObject({ page: 2, count: 1, next_page_possible: 3,
      items: [{ id: 12, tag_name: 'v1.2.0', draft: false, asset_count: 1 }] });
    expect(result.items[0].assets).toBeUndefined();
    expect(w.gh.calls[0].query).toMatchObject({ page: '2', per_page: '1' });
    expect(w.gh.invalid).toEqual([]);
    expect(w.gh.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('gets release by id with asset metadata, without retrieving bytes', async () => {
    const w = await world();
    w.gh.when(ID).reply(200, release);
    const result = await run(w, 'github_release_get', { repo: 'hello', selector: 'id', releaseId: 12 });
    expect(result).toMatchObject({ id: 12, assets: [{ id: 31, name: 'dist.zip', download_count: 3 }] });
    expect(w.gh.calls).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });

  it('gets releases by tag and latest via distinct routes', async () => {
    for (const [selector, params, route] of [
      ['tag', { tag: 'v1.2.0' }, TAG], ['latest', {}, LATEST]
    ]) {
      const w = await world();
      w.gh.when(route).reply(200, release);
      const result = await run(w, 'github_release_get', { repo: 'hello', selector, ...params });
      expect(result.tag_name).toBe('v1.2.0');
      expect(w.gh.calls[0].route).toBe(route);
      expect(w.gh.invalid).toEqual([]);
    }
  });

  it('reports a missing release honestly and leaves permission failures as errors', async () => {
    const missing = await world();
    missing.gh.when(LATEST).reply(404, { message: 'Not Found' });
    expect(await run(missing, 'github_release_get', { repo: 'hello', selector: 'latest' }))
      .toMatchObject({ not_found: 'latest published release' });
    const denied = await world();
    denied.gh.when(LIST).reply(403, { message: 'Forbidden' });
    const dispatch = createDispatch({ credentials: denied.credentials, gates: [], fetch: denied.gh.fetch, now: denied.ctx.now });
    const out = await dispatch({ registry, name: 'github_release_list', args: { repo: 'hello' },
      connection: denied.connection, db: denied.db });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/GitHub|permission|access|forbidden/i);
  });

  it('rejects contradictory selector inputs without a request', async () => {
    for (const args of [
      { selector: 'id', tag: 'v1.0.0' },
      { selector: 'latest', releaseId: 12 },
      { selector: 'tag', releaseId: 12 }
    ]) {
      const w = await world();
      const dispatch = createDispatch({ credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now });
      const out = await dispatch({ registry, name: 'github_release_get', args: { repo: 'hello', ...args },
        connection: w.connection, db: w.db });
      expect(out.isError).toBe(true);
      expect(w.gh.calls).toEqual([]);
    }
  });
});
