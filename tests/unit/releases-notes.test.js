import { describe, it, expect } from 'vitest';
import { makeWorld, doorsFor, parse } from '../../test/helpers/write-contract.js';
import * as releases from '../../src/tools/releases-write.js';

const BYTAG = 'GET /repos/{owner}/{repo}/releases/tags/{tag}';
const NOTES = 'POST /repos/{owner}/{repo}/releases/generate-notes';
const CREATE = 'POST /repos/{owner}/{repo}/releases';
const def = { tool: releases.tools.find((t) => t.name === 'github_release_create'),
  handler: releases.handlers.github_release_create };
async function preview(w, extra = {}) {
  return parse(await doorsFor(def)[0].call(w, {
    repo: 'hello', tag: 'v2', previewGeneratedNotes: true, dryRun: true, ...extra
  }));
}
describe('G-5 generated release notes preview', () => {
  it('requests notes from GitHub without creating a release or Git tag', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when(BYTAG).reply(404, { message: 'Not Found' });
    w.gh.when(NOTES).reply(200, { name: 'Version 2', body: 'Changes since last release' });
    const out = await preview(w, { targetCommitish: 'feature' });
    expect(JSON.stringify(out)).toContain('Changes since last release');
    expect(w.gh.calls.find((x) => x.route === NOTES).body)
      .toMatchObject({ tag_name: 'v2', target_commitish: 'feature' });
    expect(w.gh.calls.some((x) => x.route === CREATE)).toBe(false);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses conflicting note inputs before generate-notes POST', async () => {
    for (const options of [{ generateReleaseNotes: false }, { body: 'Fixed notes' }]) {
      const w = await makeWorld({ mode: 'production', profile: 'full' });
      w.gh.when(BYTAG).reply(404, { message: 'Not Found' });
      const out = await preview(w, options);
      expect(out.status).not.toBe('applied');
      expect(w.gh.calls.some((x) => x.route === NOTES)).toBe(false);
    }
  });
  it('fails closed on generation failure without attempting release creation', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when(BYTAG).reply(404, { message: 'Not Found' });
    w.gh.when(NOTES).reply(502, { message: 'Unavailable' });
    await preview(w);
    expect(w.gh.calls.some((x) => x.route === CREATE)).toBe(false);
  });
  it('does not call generation endpoint by default', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when(BYTAG).reply(404, { message: 'Not Found' });
    await preview(w, { previewGeneratedNotes: false });
    expect(w.gh.calls.some((x) => x.route === NOTES || x.route === CREATE)).toBe(false);
  });
});