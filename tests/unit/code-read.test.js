import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const R = { repo: 'hello' };
const b64 = (text) => Buffer.from(text).toString('base64');
const fileBody = (extra = {}) => ({ type: 'file', name: 'a.md', path: 'docs/a.md', size: 5, sha: 'abc', encoding: 'base64', content: b64('hello'), html_url: 'u', download_url: 'd', ...extra });

async function run(world, name, args) {
  const dispatch = createDispatch({ credentials: world.credentials, gates: [], fetch: world.gh.fetch, now: world.ctx.now, sleep: async () => {} });
  const result = await dispatch({ registry, name, args, connection: world.connection, db: world.db });
  return { result, body: result.isError ? null : (result.structuredContent ?? parse(result)) };
}
const world = () => makeWorld({ profile: 'read_only' });

describe('content reads (D-2)', () => {
  it('reads a text file at a ref', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, fileBody());
    const { body } = await run(w, 'github_content_get', { ...R, path: 'docs/a.md', ref: 'dev' });
    expect(body).toMatchObject({ type: 'file', path: 'docs/a.md', content: 'hello' });
    expect(w.gh.calls[0].query).toMatchObject({ ref: 'dev' });
    expect(w.gh.invalid).toEqual([]);
  });
  it('encodes a path with spaces and # so GitHub receives it whole', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, fileBody({ path: 'my dir/#notes.md' }));
    await run(w, 'github_content_get', { ...R, path: 'my dir/#notes.md' });
    expect(decodeURIComponent(w.gh.calls[0].path)).toBe('/repos/example-org/hello/contents/my dir/#notes.md');
    expect(w.gh.calls[0].path).not.toContain('#');
    expect(w.gh.calls[0].path).not.toContain(' ');
  });
  it('lists a directory', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, [{ name: 'a.md', path: 'docs/a.md', type: 'file', size: 5 }, { name: 'img', path: 'docs/img', type: 'dir', size: 0 }]);
    const { body } = await run(w, 'github_content_get', { ...R, path: 'docs' });
    expect(body).toMatchObject({ type: 'dir', count: 2 });
    expect(body.items[1]).toMatchObject({ name: 'img', type: 'dir' });
  });
  it('does not show a binary file, only its size and link', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, fileBody({ content: Buffer.from([0, 1, 2, 3, 255, 0]).toString('base64'), size: 6 }));
    const { body } = await run(w, 'github_content_get', { ...R, path: 'x.png' });
    expect(body).toMatchObject({ binary: true, content: null, download_url: 'd' });
  });
  it('long text is cut and kept behind a handle', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, fileBody({ content: b64('line\n'.repeat(5000)), size: 25000 }));
    const { body } = await run(w, 'github_content_get', { ...R, path: 'big.txt' });
    expect(body.kept_result.handle).toMatch(/^res_/);
    expect(body.content.length).toBeLessThan(25000);
  });
  it('says so when a file is too large for the contents API', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, fileBody({ encoding: 'none', content: '', size: 5_000_000 }));
    const { body } = await run(w, 'github_content_get', { ...R, path: 'huge.bin' });
    expect(body.content).toBeNull();
    expect(body.note).toContain('too large');
  });
  it('lists the tree of the real default branch and filters by glob', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'trunk' });
    w.gh.when('GET /repos/{owner}/{repo}/git/trees/{tree_sha}').reply(200, { sha: 's', truncated: false, tree: [
      { path: 'src', type: 'tree' }, { path: 'src/a.js', type: 'blob', size: 3 }, { path: 'src/deep/b.js', type: 'blob', size: 4 }, { path: 'README.md', type: 'blob', size: 9 }] });
    const { body } = await run(w, 'github_content_get_tree', { ...R, glob: 'src/**/*.js' });
    expect(body.items.map((i) => i.path)).toEqual(['src/a.js', 'src/deep/b.js']);
    expect(w.gh.calls[1].params.tree_sha).toBe('trunk');
    expect(w.gh.calls[1].query).toMatchObject({ recursive: '1' });
  });
  it('reports GitHub\'s truncated tree', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/git/trees/{tree_sha}').reply(200, { sha: 's', truncated: true, tree: [{ path: 'a', type: 'blob' }] });
    const { body } = await run(w, 'github_content_get_tree', { ...R, ref: 'main' });
    expect(body).toMatchObject({ github_truncated: true });
    expect(body.note).toContain('very large');
  });
  it('returns only the redirect link of an archive', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/tarball/{ref}').reply(302, '', { location: 'https://codeload.github.com/example-org/hello/legacy.tar.gz/main' });
    const { body } = await run(w, 'github_content_get_archive_link', { ...R, ref: 'main' });
    expect(body.url).toBe('https://codeload.github.com/example-org/hello/legacy.tar.gz/main');
  });
  it('keeps the signed query and fragment out of the default archive link', async () => {
    const w = await world();
    const bare = 'https://codeload.github.com/example-org/hello/legacy.tar.gz/main';
    w.gh.when('GET /repos/{owner}/{repo}/tarball/{ref}').reply(302, '', { location: `${bare}?token=opaque-signed-value#section` });
    const { body } = await run(w, 'github_content_get_archive_link', { ...R, ref: 'main' });
    expect(body.url).toBe(bare);
    expect(body.signed).toBe(true);
    expect(body.note).toContain('detail: "full"');
    expect(JSON.stringify(body)).not.toContain('opaque-signed-value');
  });
  it('returns the complete signed archive link when detail is full', async () => {
    const w = await world();
    const signed = 'https://codeload.github.com/example-org/hello/legacy.tar.gz/main?token=opaque-signed-value';
    w.gh.when('GET /repos/{owner}/{repo}/tarball/{ref}').reply(302, '', { location: signed });
    const { body } = await run(w, 'github_content_get_archive_link', { ...R, ref: 'main', detail: 'full' });
    expect(body.url).toBe(signed);
  });
  it('leaves an archive link with no query untouched in both modes', async () => {
    const bare = 'https://codeload.github.com/example-org/hello/legacy.tar.gz/main';
    for (const detail of [undefined, 'full']) {
      const w = await world();
      w.gh.when('GET /repos/{owner}/{repo}/tarball/{ref}').reply(302, '', { location: bare });
      const { body } = await run(w, 'github_content_get_archive_link', { ...R, ref: 'main', ...(detail ? { detail } : {}) });
      expect(body.url).toBe(bare);
      expect(body.signed).toBe(false);
    }
  });
  it('still hides a credential-shaped access code, even with detail full', async () => {
    const w = await world();
    const token = `ghp_FAKE${'x'.repeat(32)}`;
    w.gh.when('GET /repos/{owner}/{repo}/tarball/{ref}').reply(302, '', { location: `https://codeload.github.com/example-org/hello/legacy.tar.gz/main?token=${token}` });
    const { body } = await run(w, 'github_content_get_archive_link', { ...R, ref: 'main', detail: 'full' });
    expect(body.url).toContain('[hidden]');
    expect(JSON.stringify(body)).not.toContain(token);
  });
  describe('codeowners', () => {
    it('turns each problem into line, column, kind and a plain fix', async () => {
      const w = await world();
      w.gh.when('GET /repos/{owner}/{repo}/codeowners/errors').reply(200, { errors: [{ line: 3, column: 9, kind: 'Unknown owner', source: '*.js @nobody', suggestion: 'Did you mean @somebody?', message: 'Unknown owner on line 3', path: '.github/CODEOWNERS' }] });
      const { body } = await run(w, 'github_content_check_codeowners', R);
      expect(body.problems).toBe(1);
      expect(body.items[0]).toMatchObject({ line: 3, column: 9, kind: 'Unknown owner', fix: expect.stringContaining('not a GitHub user or team') });
    });
    it('says no problems when there are none', async () => {
      const w = await world();
      w.gh.when('GET /repos/{owner}/{repo}/codeowners/errors').reply(200, { errors: [] });
      expect((await run(w, 'github_content_check_codeowners', R)).body).toMatchObject({ problems: 0, ok: expect.any(String) });
    });
    it('says "no CODEOWNERS file", not "no errors", when GitHub answers 404', async () => {
      const w = await world();
      w.gh.when('GET /repos/{owner}/{repo}/codeowners/errors').reply(404, { message: 'Not Found' });
      const { body } = await run(w, 'github_content_check_codeowners', { ...R, ref: 'dev' });
      expect(body).toMatchObject({ no_codeowners_file: true, problems: null });
      expect(body.note).toContain('not the same as "no errors"');
    });
  });
});

describe('commit and git reads (D-2)', () => {
  const commit = (sha, extra = {}) => ({ sha, commit: { message: `msg ${sha}\n\nbody`, author: { name: 'N', date: '2026-10-10T10:00:00Z' }, verification: { verified: true } }, author: { login: 'octo' }, parents: [{ sha: 'p' }], html_url: 'u', ...extra });
  it('lists commits with filters and summarises them', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/commits').reply(200, [commit('a1'), commit('b2')]);
    const { body } = await run(w, 'github_commit_list', { ...R, ref: 'dev', author: 'octo', path: 'src' });
    expect(body.count).toBe(2);
    expect(body.items[0]).toMatchObject({ sha: 'a1', author: 'octo', verified: true });
    expect(w.gh.calls[0].query).toMatchObject({ sha: 'dev', author: 'octo', path: 'src' });
    expect(w.gh.invalid).toEqual([]);
  });
  it('gets one commit with patches cut per file', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(200, commit('a1', { stats: { total: 3 }, files: [{ filename: 'a.js', status: 'modified', additions: 2, deletions: 1, patch: '+'.repeat(5000) }] }));
    const { body } = await run(w, 'github_commit_get', { ...R, ref: 'a1' });
    expect(body).toMatchObject({ sha: 'a1', files_changed: 1, parents: ['p'], verified: true });
    expect(body.files[0].patch.length).toBeLessThan(1700);
    expect(body.files[0].patch).toContain('patch cut');
  });
  it('compares two refs', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/compare/{basehead}').reply(200, { status: 'ahead', ahead_by: 2, behind_by: 0, total_commits: 2, merge_base_commit: { sha: 'm' }, commits: [commit('a1'), commit('b2')], files: [] });
    const { body } = await run(w, 'github_commit_compare', { ...R, base: 'main', head: 'ai/claude/x' });
    expect(body).toMatchObject({ status: 'ahead', ahead_by: 2, merge_base: 'm' });
    expect(body.commits[0]).toMatchObject({ sha: 'a1', message: 'msg a1' });
    expect(decodeURIComponent(w.gh.calls[0].params.basehead)).toBe('main...ai/claude/x');
    expect(w.gh.invalid).toEqual([]);
  });
  it('lists the pull requests that contain a commit', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls').reply(200, [{ number: 4, title: 'T', state: 'open', user: { login: 'octo' }, head: { ref: 'h' }, base: { ref: 'main' } }]);
    const { body } = await run(w, 'github_commit_list_prs', { ...R, sha: 'a1b2' });
    expect(body.items[0]).toMatchObject({ number: 4, head: 'h' });
  });
  it('reads a ref with or without the refs/ prefix', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200, { ref: 'refs/heads/main', object: { sha: 's1', type: 'commit' } });
    const { body } = await run(w, 'github_git_get_ref', { ...R, ref: 'refs/heads/main' });
    expect(body).toEqual(expect.objectContaining({ ref: 'refs/heads/main', sha: 's1', type: 'commit' }));
    expect(decodeURIComponent(w.gh.calls[0].params.ref)).toBe('heads/main');
  });
  it('reads the low-level commit object', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/git/commits/{commit_sha}').reply(200, { sha: 'c1', tree: { sha: 't1' }, parents: [{ sha: 'p1' }], message: 'm', verification: { verified: false, reason: 'unsigned' } });
    expect((await run(w, 'github_git_get_commit', { ...R, sha: 'c1c1' })).body).toMatchObject({ tree: 't1', parents: ['p1'], verified: false, verification_reason: 'unsigned' });
  });
  it('a repository GitHub cannot find gives a plain sentence', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/commits').reply(404, { message: 'Not Found' });
    const { result } = await run(w, 'github_commit_list', R);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Next:/);
  });
});

describe('W-3 bounded exact-head file context',()=>{
  it('returns the requested lines without sending local range arguments to GitHub',async()=>{
    const w=await world(),ref='a'.repeat(40),text='one\ntwo\nthree\nfour';
    w.gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200,fileBody({content:b64(text),size:text.length}));
    const {body}=await run(w,'github_content_get',{...R,path:'docs/a.md',ref,startLine:2,endLine:3});
    expect(body).toMatchObject({content:'two\nthree',start_line:2,end_line:3,total_lines:4});
    expect(w.gh.calls[0].query).toEqual({ref});expect(w.gh.invalid).toEqual([]);
  });
  it('refuses half, reversed or oversized ranges before calling GitHub',async()=>{
    const w=await world();
    for(const range of [{startLine:2},{startLine:3,endLine:2},{startLine:1,endLine:101}])
      expect((await run(w,'github_content_get',{...R,path:'a.js',...range})).result.isError).toBe(true);
    expect(w.gh.calls).toEqual([]);
  });
});
