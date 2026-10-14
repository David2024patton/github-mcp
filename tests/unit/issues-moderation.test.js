import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import * as issues from '../../src/tools/issues-write.js';

const def = name => ({ tool: issues.tools.find(t => t.name === name), handler: issues.handlers[name] });
const GET = 'GET /repos/{owner}/{repo}/issues/{issue_number}';
const COM = 'GET /repos/{owner}/{repo}/issues/comments/{comment_id}';
const origin = 'https://api.github.com/repos/example-org/hello/issues/7';
const issue = (extras = {}) => ({ id: 7, number: 7, title: 't', body: 'b', state: 'open', locked: false, labels: [{ name: 'old' }], assignees: [], ...extras });
const comment = (extras = {}) => ({ id: 9, body: 'before', issue_url: origin, ...extras });
const seq = (gh, path, entries) => gh.when(path).replySequence(entries.map(([status, body]) => ({ status, body })));

runWriteContract({
  label: 'github_issue_lock', definition: def('github_issue_lock'),
  args: { repo: 'hello', number: 7, locked: true }, needsConfirm: false,
  arrange(gh, outcome) {
    seq(gh, GET, [[200, issue()], [200, issue({ locked: outcome === 'ok' })]]);
    gh.when('PUT /repos/{owner}/{repo}/issues/{issue_number}/lock').reply(204, null);
  }
});
runWriteContract({
  label: 'github_issue_edit_comment', definition: def('github_issue_edit_comment'),
  args: { repo: 'hello', commentId: 9, body: 'updated' }, needsConfirm: false,
  arrange(gh, outcome) {
    seq(gh, COM, [[200, comment()], [200, comment({ body: outcome === 'ok' ? 'updated' : 'before' })]]);
    gh.when('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}').reply(200, comment({ body: 'updated' }));
  }
});
runWriteContract({
  label: 'github_issue_set_labels', definition: def('github_issue_set_labels'),
  args: { repo: 'hello', number: 7, mode: 'replace', labels: ['new'] }, needsConfirm: false,
  arrange(gh, outcome) {
    seq(gh, GET, [[200, issue()], [200, issue({ labels: [{ name: outcome === 'ok' ? 'new' : 'old' }] })]]);
    gh.when('PUT /repos/{owner}/{repo}/issues/{issue_number}/labels').reply(200, [{ name: 'new' }]);
  }
});
runWriteContract({
  label: 'github_issue_set_assignees', definition: def('github_issue_set_assignees'),
  args: { repo: 'hello', number: 7, mode: 'add', assignees: ['example-owner'] }, needsConfirm: false,
  arrange(gh, outcome) {
    seq(gh, GET, [[200, issue()], [200, issue({ assignees: outcome === 'ok' ? [{ login: 'example-owner' }] : [] })]]);
    gh.when('POST /repos/{owner}/{repo}/issues/{issue_number}/assignees').reply(201, {});
  }
});

async function call(w, name, args) {
  const dispatch = createDispatch({ credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now, sleep: async () => {} });
  const out = await dispatch({ registry, name, args, connection: w.connection, db: w.db });
  return { out, body: out.isError ? null : (out.structuredContent ?? parse(out)) };
}
const writes = w => w.gh.calls.filter(c => c.method !== 'GET' && c.method !== 'HEAD' && c.route !== 'POST /graphql');

describe('F-1 moderation and metadata exact semantics', () => {
  it('refuses editing comment that belongs to a different repo', async () => {
    const w = await makeWorld({});
    w.gh.when(COM).reply(200, comment({ issue_url: 'https://api.github.com/repos/other/repo/issues/7' }));
    const r = await call(w, 'github_issue_edit_comment', { repo: 'hello', commentId: 9, body: 'updated' });
    expect(r.body?.done).not.toBe(true);
    expect(writes(w)).toEqual([]);
  });

  it('replaces labels with an explicit empty array to clear all', async () => {
    const w = await makeWorld({});
    seq(w.gh, GET, [[200, issue()], [200, issue({ labels: [] })]]);
    w.gh.when('PUT /repos/{owner}/{repo}/issues/{issue_number}/labels').reply(200, []);
    const r = await call(w, 'github_issue_set_labels', { repo: 'hello', number: 7, mode: 'replace', labels: [] });
    expect(r.body.done).toBe(true);
    expect(writes(w)[0].body.labels).toEqual([]);
  });

  it('refuses new assignees outside own people until confirmed', async () => {
    const w = await makeWorld({});
    w.gh.when(GET).reply(200, issue());
    const r = await call(w, 'github_issue_set_assignees', { repo: 'hello', number: 7, mode: 'add', assignees: ['outside-user'] });
    expect(r.body).toMatchObject({ done: false, status: 'needs_confirmation' });
    expect(writes(w)).toEqual([]);
  });

  it('does not send DELETE to unlock an already unlocked issue', async () => {
    const w = await makeWorld({});
    seq(w.gh, GET, [[200, issue({ locked: false })], [200, issue({ locked: false })]]);
    const r = await call(w, 'github_issue_lock', { repo: 'hello', number: 7, locked: false });
    expect(r.body.done).toBe(true);
    expect(writes(w)).toEqual([]);
  });
});
