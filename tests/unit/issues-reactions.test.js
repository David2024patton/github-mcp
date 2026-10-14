import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import * as reactions from '../../src/tools/issues-reactions-write.js';

const def = { tool: reactions.tools[0], handler: reactions.handlers.github_issue_react };
const GET_ISSUE = 'GET /repos/{owner}/{repo}/issues/{issue_number}';
const GET_COMMENT = 'GET /repos/{owner}/{repo}/issues/comments/{comment_id}';
const ISSUE_LIST = 'GET /repos/{owner}/{repo}/issues/{issue_number}/reactions';
const COMMENT_LIST = 'GET /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions';
const POST_ISSUE = 'POST /repos/{owner}/{repo}/issues/{issue_number}/reactions';
const DELETE_COMMENT = 'DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions/{reaction_id}';
const item = (extra = {}) => ({ id: 19, content: 'heart', user: { login: 'example-owner' }, ...extra });
const issue = extra => ({ number: 7, user: { login: 'example-owner' }, ...extra });
const comment = extra => ({ id: 9, issue_url: 'https://api.github.com/repos/example-org/hello/issues/7',
  user: { login: 'example-owner' }, ...extra });
const seq = (gh, route, rows) => gh.when(route).replySequence(rows.map(([status, body]) => ({ status, body })));

runWriteContract({
  label: 'github_issue_react add', definition: def,
  args: { repo: 'hello', kind: 'issue', number: 7, mode: 'add', content: 'heart' }, needsConfirm: false,
  arrange(gh, outcome) {
    gh.when(GET_ISSUE).reply(200, issue());
    seq(gh, ISSUE_LIST, [[200, []], [200, outcome === 'ok' ? [item()] : []]]);
    gh.when(POST_ISSUE).reply(201, item());
  }
});
runWriteContract({
  label: 'github_issue_react remove', definition: def,
  args: { repo: 'hello', kind: 'issue_comment', commentId: 9, mode: 'remove', reactionId: 19, content: 'heart' }, needsConfirm: false,
  arrange(gh, outcome) {
    gh.when(GET_COMMENT).reply(200, comment());
    seq(gh, COMMENT_LIST, [[200, [item()]], [200, outcome === 'ok' ? [] : [item()]]]);
    gh.when(DELETE_COMMENT).reply(204, null);
  }
});

async function call(world, args) {
  const dispatcher = createDispatch({ credentials: world.credentials, gates: [], fetch: world.gh.fetch,
    now: world.ctx.now, sleep: async () => {} });
  const out = await dispatcher({ registry, name: 'github_issue_react', args, connection: world.connection, db: world.db });
  return { out, body: out.structuredContent ?? parse(out) };
}
const writes = gh => gh.calls.filter(c => !['GET','HEAD'].includes(c.method));
describe('reaction ownership, notification, and exact readback', () => {
  it('does not remove a reaction that is missing or on another resource', async () => {
    const w = await makeWorld({});
    w.gh.when(GET_COMMENT).reply(200, comment({ issue_url: 'https://api.github.com/repos/other/repo/issues/7' }));
    const r = await call(w, { repo: 'hello', kind: 'issue_comment', commentId: 9,
      mode: 'remove', reactionId: 19, content: 'heart' });
    expect(r.body.done).not.toBe(true);
    expect(writes(w.gh)).toEqual([]);
  });
  it('refuses a reaction ID with the wrong content instead of deleting it', async () => {
    const w = await makeWorld({});
    w.gh.when(GET_COMMENT).reply(200, comment());
    w.gh.when(COMMENT_LIST).reply(200, [item({ content: 'eyes' })]);
    const r = await call(w, { repo: 'hello', kind: 'issue_comment', commentId: 9,
      mode: 'remove', reactionId: 19, content: 'heart' });
    expect(r.body.done).not.toBe(true);
    expect(writes(w.gh)).toEqual([]);
  });
  it('requires confirmation before notifying an external issue author', async () => {
    const w = await makeWorld({});
    w.gh.when(GET_ISSUE).reply(200, issue({ user: { login: 'outside-person' } }));
    w.gh.when(ISSUE_LIST).reply(200, []);
    const r = await call(w, { repo: 'hello', kind: 'issue', number: 7, mode: 'add', content: 'heart' });
    expect(r.body).toMatchObject({ status: 'needs_confirmation', done: false });
    expect(r.body.preview).toContain('outside-person');
    expect(writes(w.gh)).toEqual([]);
  });
  it('uses exact review comment provenance and rejects a foreign review comment', async () => {
    const w = await makeWorld({});
    w.gh.when('GET /repos/{owner}/{repo}/pulls/comments/{comment_id}').reply(200, {
      id: 9, pull_request_url: 'https://api.github.com/repos/other/repo/pulls/7',
      user: { login: 'example-owner' }
    });
    const r = await call(w, { repo: 'hello', kind: 'review_comment', commentId: 9, mode: 'add', content: 'eyes' });
    expect(r.body.done).not.toBe(true);
    expect(writes(w.gh)).toEqual([]);
  });
  it('refuses malformed resource selectors without making provider requests', async () => {
    const w = await makeWorld({});
    const r = await call(w, { repo: 'hello', kind: 'issue_comment', number: 7, mode: 'add', content: 'heart' });
    expect(r.body.done).not.toBe(true);
    expect(w.gh.calls).toEqual([]);
  });
});
