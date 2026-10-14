import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const path = 'GET /repos/{owner}/{repo}/issues';
const issue = (number, extra = {}) => ({ id: 100 + number, number, title: 'Issue '+number,
  state: 'open', body: 'details', labels: [{ name: 'bug' }], user: { login: 'author' },
  assignees: [], comments: 0, html_url: 'https://github.com/example-org/hello/issues/'+number, ...extra });
async function call(world, name, args) {
  const dispatch = createDispatch({ credentials: world.credentials, fetch: world.gh.fetch, now: world.ctx.now, sleep: async () => {}, gates: [] });
  const out = await dispatch({ registry, name, args, connection: world.connection, db: world.db });
  return { out, body: out.isError ? null : (out.structuredContent ?? parse(out)) };
}
const world = () => makeWorld({ profile: 'read_only' });

describe('F-1 issue triage reads', () => {
  it('refills a full PR-only page before counting real issues', async () => {
    const w = await world();
    const prs = Array.from({ length: 100 }, (_, n) => issue(n + 1, { pull_request: { url: 'https://api.github.com/pr' } }));
    w.gh.when(path).replySequence([{ status: 200, body: prs }, { status: 200, body: [issue(101), issue(102)] }]);
    const { body } = await call(w, 'github_issue_list', { repo: 'hello', max: 2, labels: 'bug', type: 'Bug' });
    expect(body.count).toBe(2);
    expect(body.items.map(x => x.number)).toEqual([101, 102]);
    expect(body.scanned).toBe(102);
    expect(w.gh.calls.filter(x => x.route === path).map(x => x.query.page)).toEqual(['1', '2']);
    expect(w.gh.calls.filter(x => x.route === path).map(x => x.query.type)).toEqual(['Bug', 'Bug']);
    expect(w.gh.invalid).toEqual([]);
  });

  it('does not silently turn a capped scan into an exhaustive result', async () => {
    const w = await world();
    w.gh.when(path).reply(200, Array.from({ length: 100 }, (_, n) => issue(n + 1, { pull_request: {} })));
    const { body } = await call(w, 'github_issue_list', { repo: 'hello', max: 2 });
    expect(body).toMatchObject({ count: 0, more_may_exist: true, scan_capped: true });
    expect(w.gh.calls.filter(x => x.route === path)).toHaveLength(10);
  });

  it('reads issue identity and never presents a PR as an issue', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/issues/{issue_number}').replySequence([
      { status: 200, body: issue(7) }, { status: 200, body: issue(7, { pull_request: {} }) }
    ]);
    const read = await call(w, 'github_issue_get', { repo: 'hello', number: 7 });
    expect(read.body).toMatchObject({ number: 7, title: 'Issue 7', labels: ['bug'] });
    const pr = await call(w, 'github_issue_get', { repo: 'hello', number: 7 });
    expect(pr.out.isError).toBe(true);
  });

  it('reads optional relationships with explicit incomplete availability', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/issues/{issue_number}').reply(200, issue(3));
    w.gh.when('GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues').reply(200, [issue(8, { author_association: 'NONE' })]);
    w.gh.when('GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by').reply(403, { message: 'Forbidden' });
    w.gh.when('GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocking').reply(200, []);
    const r = await call(w, 'github_issue_get', { repo: 'hello', number: 3, includeRelations: true });
    expect(r.body.relations.sub_issues.items).toMatchObject([{ number: 8, author_association: 'NONE', untrusted: true }]);
    expect(r.body.relations.blocked_by).toMatchObject({ available: false, reason: 'could_not_read' });
    expect(w.gh.invalid).toEqual([]);
  });

  it('reads conversation comments and timeline from their real endpoints', async () => {
    const w = await world();
    w.gh.when('GET /repos/{owner}/{repo}/issues/{issue_number}/comments').reply(200, [{ id: 20, body: 'Thanks', user: { login: 'owner' }, author_association: 'OWNER' }]);
    w.gh.when('GET /repos/{owner}/{repo}/issues/{issue_number}/timeline').reply(200, [{ id: 21, event: 'closed', actor: { login: 'owner' } }]);
    expect((await call(w, 'github_issue_list_comments', { repo: 'hello', number: 7 })).body.items[0]).toMatchObject({ id: 20, body: 'Thanks', author: 'owner' });
    expect((await call(w, 'github_issue_list_timeline', { repo: 'hello', number: 7 })).body.items[0]).toMatchObject({ id: 21, event: 'closed' });
    expect(w.gh.invalid).toEqual([]);
  });
});
