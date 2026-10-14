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
    w.gh.when('DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels').reply(204, null);
    const r = await call(w, 'github_issue_set_labels', { repo: 'hello', number: 7, mode: 'replace', labels: [] });
    expect(r.body.done).toBe(true);
    expect(writes(w)[0].method).toBe('DELETE');
    expect(writes(w)[0].route).toBe('DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels');
  });

  it('refuses new assignees outside own people until confirmed', async () => {
    const w = await makeWorld({});
    w.gh.when(GET).reply(200, issue());
    const r = await call(w, 'github_issue_set_assignees', { repo: 'hello', number: 7, mode: 'add', assignees: ['outside-user'] });
    expect(r.body).toMatchObject({ done: false, status: 'needs_confirmation' });
    expect(writes(w)).toEqual([]);
  });

  it('removes multiple labels in one provider request and leaves unrelated labels intact', async () => {
    const w = await makeWorld({});
    seq(w.gh, GET, [
      [200, issue({ labels: [{ name: 'old' }, { name: 'second' }, { name: 'keep' }] })],
      [200, issue({ labels: [{ name: 'old' }, { name: 'second' }, { name: 'keep' }] })],
      [200, issue({ labels: [{ name: 'keep' }] })]
    ]);
    w.gh.when('PUT /repos/{owner}/{repo}/issues/{issue_number}/labels').reply(200, [{ name: 'keep' }]);
    const r = await call(w, 'github_issue_set_labels', { repo: 'hello', number: 7, mode: 'remove', labels: ['old', 'second', 'old'] });
    expect(r.body.done).toBe(true);
    expect(writes(w)).toHaveLength(1);
    expect(writes(w)[0].route).toBe('PUT /repos/{owner}/{repo}/issues/{issue_number}/labels');
    expect(writes(w)[0].body.labels).toEqual(['keep']);
  });

  it('refuses empty add/remove before any provider request', async () => {
    for (const mode of ['add', 'remove']) {
      const w = await makeWorld({});
      const r = await call(w, 'github_issue_set_labels', { repo: 'hello', number: 7, mode, labels: [] });
      expect(r.out.isError).toBe(true);
      expect(w.gh.calls.filter(c => c.route === GET)).toHaveLength(0);
      expect(writes(w)).toEqual([]);
    }
  });

  it('detects label changes between preview and single-mutation removal', async () => {
    const w = await makeWorld({});
    seq(w.gh, GET, [
      [200, issue({ labels: [{ name: 'old' }, { name: 'keep' }] })],
      [200, issue({ labels: [{ name: 'other' }, { name: 'keep' }] })]
    ]);
    const r = await call(w, 'github_issue_set_labels', { repo: 'hello', number: 7, mode: 'remove', labels: ['old'] });
    expect(r.body?.done).not.toBe(true);
    expect(writes(w)).toEqual([]);
  });

  it('requires exact requested lock reason in provider readback', async () => {
    const w = await makeWorld({});
    seq(w.gh, GET, [
      [200, issue({ locked: false })],
      [200, issue({ locked: true, active_lock_reason: 'spam' })]
    ]);
    w.gh.when('PUT /repos/{owner}/{repo}/issues/{issue_number}/lock').reply(204, null);
    const r = await call(w, 'github_issue_lock', { repo: 'hello', number: 7, locked: true, reason: 'resolved' });
    expect(r.body).toMatchObject({ done: false, status: 'unconfirmed' });
    expect(writes(w)).toHaveLength(1);
  });

  it('refuses to silently overwrite the reason on an existing lock', async () => {
    const w = await makeWorld({});
    w.gh.when(GET).reply(200, issue({ locked: true, active_lock_reason: 'spam' }));
    const r = await call(w, 'github_issue_lock', { repo: 'hello', number: 7, locked: true, reason: 'resolved' });
    expect(r.body?.done).not.toBe(true);
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
