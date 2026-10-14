import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import * as issues from '../../src/tools/issues-write.js';

const def = name => ({ tool: issues.tools.find(t => t.name === name), handler: issues.handlers[name] });
const issue = (extras = {}) => ({ id: 107, number: 7, title: 'Original', state: 'open',
  body: 'Original body', labels: [], assignees: [], html_url: 'https://github.com/example-org/hello/issues/7', ...extras });
const get = 'GET /repos/{owner}/{repo}/issues/{issue_number}';
const comment = 'GET /repos/{owner}/{repo}/issues/comments/{comment_id}';
const seq = (gh, route, entries) => gh.when(route).replySequence(entries.map(([status, body]) => ({ status, body })));

runWriteContract({
  label: 'github_issue_create', definition: def('github_issue_create'),
  args: { repo: 'hello', title: 'New issue', body: '' }, needsConfirm: false,
  arrange(gh, outcome) {
    gh.when('GET /repos/{owner}/{repo}').reply(200, { has_issues: true });
    gh.when('POST /repos/{owner}/{repo}/issues').reply(201, issue({ title: 'New issue', body: '' }));
    gh.when(get).reply(200, issue({ title: outcome === 'ok' ? 'New issue' : 'Mismatch', body: '' }));
  }
});
runWriteContract({
  label: 'github_issue_update', definition: def('github_issue_update'),
  args: { repo: 'hello', number: 7, body: '' }, needsConfirm: false,
  arrange(gh, outcome) {
    seq(gh, get, [[200, issue()], [200, issue({ body: outcome === 'ok' ? '' : 'Original body' })]]);
    gh.when('PATCH /repos/{owner}/{repo}/issues/{issue_number}').reply(200, issue());
  }
});
runWriteContract({
  label: 'github_issue_comment', definition: def('github_issue_comment'),
  args: { repo: 'hello', number: 7, body: 'Message' }, needsConfirm: false,
  arrange(gh, outcome) {
    gh.when(get).reply(200, issue());
    gh.when('POST /repos/{owner}/{repo}/issues/{issue_number}/comments').reply(201, { id: 19 });
    gh.when(comment).reply(200, { id: 19, body: outcome === 'ok' ? 'Message' : 'Different', user: { login: 'example-owner' } });
  }
});

async function call(w, name, args) {
  const dispatcher = createDispatch({ credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now, sleep: async () => {} });
  const out = await dispatcher({ registry, name, args, connection: w.connection, db: w.db });
  return { out, body: out.isError ? null : (out.structuredContent ?? parse(out)) };
}
const writes = gh => gh.calls.filter(c => c.method !== 'GET' && c.method !== 'HEAD' && c.route !== 'POST /graphql');

describe('F-1 issue write semantics', () => {
  it('clears an existing body when empty string is supplied', async () => {
    const w = await makeWorld({});
    seq(w.gh, get, [[200, issue()], [200, issue({ body: '' })]]);
    w.gh.when('PATCH /repos/{owner}/{repo}/issues/{issue_number}').reply(200, issue({ body: '' }));
    const r = await call(w, 'github_issue_update', { repo: 'hello', number: 7, body: '' });
    expect(r.body.done).toBe(true);
    expect(writes(w.gh)[0].body).toMatchObject({ body: '' });
    expect(w.gh.invalid).toEqual([]);
  });

  it('refuses to update a PR through the issue endpoint', async () => {
    const w = await makeWorld({});
    w.gh.when(get).reply(200, issue({ pull_request: { url: 'pr' } }));
    const r = await call(w, 'github_issue_update', { repo: 'hello', number: 7, title: 'Changed' });
    expect(r.body?.done).not.toBe(true);
    expect(writes(w.gh)).toEqual([]);
  });

  it('classifies outsider issue mentions before posting any content', async () => {
    const w = await makeWorld({});
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { has_issues: true });
    const r = await call(w, 'github_issue_create', { repo: 'hello', title: 'Please check @not-our-team' });
    expect(r.body).toMatchObject({ done: false, status: 'needs_confirmation' });
    expect(writes(w.gh)).toEqual([]);
  });

  it('confirms create type, milestone and cleared body only after exact provider readback', async () => {
    for (const [milestoneReadback, confirmed] of [[{ number: 2 }, true], [null, false]]) {
      const w = await makeWorld({});
      w.gh.when('GET /repos/{owner}/{repo}').reply(200, { has_issues: true });
      w.gh.when('POST /repos/{owner}/{repo}/issues').reply(201, issue({ title: 'Created' }));
      w.gh.when(get).reply(200, issue({ title: 'Created', body: null, milestone: milestoneReadback, type: { name: 'Bug' } }));
      const result = await call(w, 'github_issue_create', { repo: 'hello', title: 'Created', body: '', type: 'Bug', milestone: 2 });
      expect(result.body.done).toBe(confirmed);
      expect(result.body.status).toBe(confirmed ? 'applied' : 'unconfirmed');
      const sent = writes(w.gh)[0].body;
      expect(sent).toMatchObject({ type: 'Bug', milestone: 2, body: '' });
    }
  });

  it('clears milestone with null and accepts null as cleared body', async () => {
    const w = await makeWorld({});
    seq(w.gh, get, [[200, issue({ milestone: { number: 3 } })], [200, issue({ milestone: null, body: null })]]);
    w.gh.when('PATCH /repos/{owner}/{repo}/issues/{issue_number}').reply(200, issue({ milestone: null }));
    const r = await call(w, 'github_issue_update', { repo: 'hello', number: 7, body: '', milestone: null });
    expect(r.body.done).toBe(true);
    expect(writes(w.gh)[0].body).toMatchObject({ body: '', milestone: null });
  });

  it('closes a duplicate with its canonical issue and preserves type readback', async () => {
    const w = await makeWorld({});
    seq(w.gh, get, [[200, issue()], [200, issue({ state: 'closed', state_reason: 'duplicate', type: { name: 'Task' } })]]);
    w.gh.when('PATCH /repos/{owner}/{repo}/issues/{issue_number}').reply(200, issue());
    const r = await call(w, 'github_issue_update', { repo: 'hello', number: 7, state: 'closed', stateReason: 'duplicate', duplicateIssueId: 99, type: 'Task' });
    expect(r.body.done).toBe(true);
    expect(writes(w.gh)[0].body).toMatchObject({ state_reason: 'duplicate', duplicate_issue_id: 99, type: 'Task' });
  });

  it('preserves omitted body/milestone rather than implicitly clearing either', async () => {
    const w = await makeWorld({});
    seq(w.gh, get, [[200, issue()], [200, issue({ title: 'Changed' })]]);
    w.gh.when('PATCH /repos/{owner}/{repo}/issues/{issue_number}').reply(200, issue({ title: 'Changed' }));
    const r = await call(w, 'github_issue_update', { repo: 'hello', number: 7, title: 'Changed' });
    expect(r.body.done).toBe(true);
    const sent = writes(w.gh)[0].body;
    expect(sent.title).toBe('Changed');
    expect(sent).not.toHaveProperty('body');
    expect(sent).not.toHaveProperty('milestone');
  });
});
