import { describe, expect, it } from 'vitest';
import * as pages from '../../src/tools/pages-write.js';
import { makeWorld, doorsFor, parse, runWriteContract } from '../../test/helpers/write-contract.js';
const GET = 'GET /repos/{owner}/{repo}/pages';
const POST = 'POST /repos/{owner}/{repo}/pages';
const PUT = 'PUT /repos/{owner}/{repo}/pages';
const DELETE = 'DELETE /repos/{owner}/{repo}/pages';
const REPO = 'GET /repos/{owner}/{repo}';
const site = { source: { branch: 'main', path: '/' }, build_type: 'legacy', public: false,
  cname: null, https_enforced: false, html_url: 'https://example.github.io' };
const updated = { ...site, cname: 'docs.example.org' };
const def = (name) => ({ tool: pages.tools.find((t) => t.name === name), handler: pages.handlers[name] });
const seq = (gh, route, entries) => gh.when(route).replySequence(entries.map((item) =>
  item === null ? { status: 404, body: { message: 'Not Found' } } : { status: 200, body: item }));
const call = (w, name, args) => doorsFor(def(name))[0].call(w, args).then(parse);
runWriteContract({
  label: 'github_pages_save', definition: def('github_pages_save'), profile: 'full', production: true, needsConfirm: true,
  args: { repo: 'hello', cname: 'docs.example.org' },
  arrange(gh, mismatch) {
    gh.when(REPO).reply(200, { private: false });
    seq(gh, GET, [site, site, mismatch === 'ok' ? updated : site]);
    gh.when(PUT).reply(204, '');
  }
});
runWriteContract({
  label: 'github_pages_disable', definition: def('github_pages_disable'), profile: 'full', production: true, needsConfirm: true,
  args: { repo: 'hello' },
  arrange(gh, mismatch) {
    seq(gh, GET, [site, site, mismatch === 'ok' ? null : site]);
    gh.when(DELETE).reply(204, '');
  }
});
describe('G-6 Pages writes', () => {
  it('creates a site with POST and refuses create-time unsupported settings', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    ghSetup(w, [null, null, site]);
    w.gh.when(POST).reply(201, site);
    const out = await call(w, 'github_pages_save', { repo: 'hello', sourceBranch: 'main', confirm: true });
    expect(out.status).toBe('applied');
    expect(w.gh.calls.find((x) => x.method === 'POST').body).toMatchObject({ build_type: 'legacy', source: { branch: 'main', path: '/' } });
    expect(w.gh.invalid).toEqual([]);
    const bad = await makeWorld({ mode: 'production', profile: 'full' });
    ghSetup(bad, [null]);
    expect((await call(bad, 'github_pages_save', { repo: 'hello', sourceBranch: 'main', cname: 'docs.example.org', confirm: true })).status).not.toBe('applied');
  });
  it('marks exposing private repository content as an access change', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    w.gh.when(REPO).reply(200, { private: true });
    w.gh.when(GET).reply(404, { message: 'Not Found' });
    const out = await call(w, 'github_pages_save', { repo: 'hello', sourceBranch: 'main', dryRun: true });
    expect(out.preview).toContain('ACCESS CHANGE');
    expect(w.gh.calls.some((x) => x.method === 'POST')).toBe(false);
  });
  it('never erases untouched source or HTTPS fields while updating the domain', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    ghSetup(w, [site, site, updated]); w.gh.when(PUT).reply(204, '');
    const out = await call(w, 'github_pages_save', { repo: 'hello', cname: 'docs.example.org', confirm: true });
    expect(out.status).toBe('applied');
    const body = w.gh.calls.find((x) => x.method === 'PUT').body;
    expect(body).toHaveProperty('cname', 'docs.example.org');
    expect(body).not.toHaveProperty('source');
    expect(body).not.toHaveProperty('https_enforced');
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses a race on old site settings before mutation', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    ghSetup(w, [site, updated]);
    expect((await call(w, 'github_pages_save', { repo: 'hello', cname: 'docs.example.org', confirm: true })).status).toBe('rejected');
    expect(w.gh.calls.find((x) => x.method === 'PUT')).toBeUndefined();
  });
});
function ghSetup(w, pagesSequence) {
  w.gh.when(REPO).reply(200, { private: false });
  seq(w.gh, GET, pagesSequence);
}
