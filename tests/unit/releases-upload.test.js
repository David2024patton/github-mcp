import { describe, it, expect, vi } from 'vitest';
import { runWriteContract, makeWorld, doorsFor, parse } from '../../test/helpers/write-contract.js';
vi.mock('../../src/github/public-url.js', async (importOriginal) => ({
  ...await importOriginal(),
  downloadPublicAsset: vi.fn(async () => ({
    bytes: Buffer.from('abc'), size: 3, contentType: 'application/octet-stream'
  }))
}));
import * as assets from '../../src/tools/releases-assets.js';

const REL = 'GET /repos/{owner}/{repo}/releases/{release_id}';
const ONE = 'GET /repos/{owner}/{repo}/releases/assets/{asset_id}';
const UP = 'POST /repos/{owner}/{repo}/releases/{release_id}/assets';
const URL = 'https://uploads.github.com/repos/example-org/hello/releases/42/assets{?name,label}';
const release = { id: 42, tag_name: 'v1', draft: true, immutable: false, assets: [], upload_url: URL };
const uploaded = { id: 17, name: 'app.zip', size: 3, state: 'uploaded',
  browser_download_url: 'https://github.com/example-org/hello/releases/download/v1/app.zip' };
const args = { repo: 'hello', releaseId: 42, name: 'app.zip', sourceUrl: 'https://files.public-assets.org/app.zip' };
const def = { tool: assets.tools.find((x) => x.name === 'github_release_upload_asset'),
  handler: assets.handlers.github_release_upload_asset };
const call = async (w, extra = {}) => parse(await doorsFor(def)[0].call(w, { ...args, ...extra }));
const mutations = (w) => w.gh.calls.filter((x) => x.method === 'POST');
runWriteContract({
  label: 'github_release_upload_asset', definition: def, args,
  profile: 'full', production: false, needsConfirm: true,
  arrange(gh, outcome) {
    gh.when(REL).reply(200, release);
    gh.when(UP).reply(201, uploaded);
    gh.when(ONE).reply(200, outcome === 'ok' ? uploaded : { ...uploaded, name: 'wrong.zip' });
  }
});
describe('G-5 guarded release asset upload', () => {
  it('uploads via the GitHub host and keeps bytes out of tool results', async () => {
    const w = await makeWorld({ mode: 'preview', profile: 'full' });
    w.gh.when(REL).reply(200, release); w.gh.when(UP).reply(201, uploaded);
    w.gh.when(ONE).reply(200, uploaded);
    const out = await call(w, { confirm: true });
    expect(out.status).toBe('applied');
    expect(JSON.stringify(out)).not.toContain('abc');
    expect(mutations(w).map((x) => x.route)).toEqual([UP]);
    expect(mutations(w)[0].query).toMatchObject({ name: 'app.zip' });
    expect(w.gh.invalid).toEqual([]);
  });
  it('rejects private sources without a GitHub mutation', async () => {
    for (const sourceUrl of ['http://localhost/file', 'https://127.0.0.1/file', 'https://foo.internal/file']) {
      const w = await makeWorld({ mode: 'production', profile: 'full' });
      expect((await call(w, { sourceUrl, confirm: true })).status).not.toBe('applied');
      expect(mutations(w)).toHaveLength(0);
    }
  });
  it('classifies a published release as production', async () => {
    const w = await makeWorld({ mode: 'preview', profile: 'full' });
    w.gh.when(REL).reply(200, { ...release, draft: false });
    const out = await call(w, { confirm: true });
    expect(out.status).toBe('refused_by_guard');
    expect(mutations(w)).toHaveLength(0);
  });
  it('never overwrites an existing filename', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when(REL).reply(200, { ...release, assets: [uploaded] });
    expect((await call(w, { confirm: true })).status).not.toBe('applied');
    expect(mutations(w)).toHaveLength(0);
  });
});
