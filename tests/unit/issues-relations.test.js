import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import * as relationships from '../../src/tools/issues-relations-write.js';

const definitions = name => ({ tool: relationships.tools.find(t => t.name === name), handler: relationships.handlers[name] });
const ISSUE = 'GET /repos/{owner}/{repo}/issues/{issue_number}';
const SUB = 'GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues';
const BLOCK = 'GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by';
const POST_SUB = 'POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues';
const POST_BLOCK = 'POST /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by';
const makeIssue = (number, id) => ({ number, id, title: 'issue '+number, state: 'open', labels: [], assignees: [] });
const p = makeIssue(7,107), c = makeIssue(8,108);
const seq = (gh, route, steps) => gh.when(route).replySequence(steps.map(([status, body]) => ({ status, body })));

runWriteContract({
  label: 'github_issue_set_sub_issue', definition: definitions('github_issue_set_sub_issue'),
  args: { repo: 'hello', number: 7, childNumber: 8, mode: 'add' }, needsConfirm: false,
  arrange(gh, outcome) {
    seq(gh, ISSUE, [[200, p], [200, c]]);
    seq(gh, SUB, [[200, []], [200, outcome === 'ok' ? [c] : []]]);
    gh.when(POST_SUB).reply(201, c);
  }
});
runWriteContract({
  label: 'github_issue_set_dependency', definition: definitions('github_issue_set_dependency'),
  args: { repo: 'hello', number: 7, blockingNumber: 8, mode: 'add' }, needsConfirm: false,
  arrange(gh, outcome) {
    seq(gh, ISSUE, [[200, p], [200, c]]);
    seq(gh, BLOCK, [[200, []], [200, outcome === 'ok' ? [c] : []]]);
    gh.when(POST_BLOCK).reply(201, {});
  }
});

async function call(w, name, args) {
  const dispatch = createDispatch({ credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now, sleep: async () => {} });
  const out = await dispatch({ registry, name, args, connection: w.connection, db: w.db });
  return { out, body: out.isError ? null : (out.structuredContent ?? parse(out)) };
}
const writes = w => w.gh.calls.filter(x => !['GET','HEAD'].includes(x.method) && x.route !== 'POST /graphql');

describe('F-1 exact issue relationship ownership and idempotency', () => {
  it('sends the GitHub database ID read from the exact same-repo child, not the issue number', async () => {
    const w = await makeWorld({});
    seq(w.gh, ISSUE, [[200, p], [200, c]]);
    seq(w.gh, SUB, [[200, []], [200, [c]]]);
    w.gh.when(POST_SUB).reply(201, c);
    const r = await call(w, 'github_issue_set_sub_issue', { repo: 'hello', number: 7, childNumber: 8, mode: 'add' });
    expect(r.body.done).toBe(true);
    expect(writes(w)).toHaveLength(1);
    expect(writes(w)[0].body.sub_issue_id).toBe(108);
    expect(w.gh.invalid).toEqual([]);
  });
  it('no-ops when the requested child is already attached, without an extra write', async () => {
    const w = await makeWorld({});
    seq(w.gh, ISSUE, [[200, p], [200, c]]);
    w.gh.when(SUB).reply(200, [c]);
    const r = await call(w, 'github_issue_set_sub_issue', { repo: 'hello', number: 7, childNumber: 8, mode: 'add' });
    expect(r.body.done).toBe(true);
    expect(writes(w)).toEqual([]);
  });
  it('refuses an inaccessible or unverified child before posting', async () => {
    const w = await makeWorld({});
    seq(w.gh, ISSUE, [[200, p], [404, { message: 'Not Found' }]]);
    const r = await call(w, 'github_issue_set_sub_issue', { repo: 'hello', number: 7, childNumber: 8, mode: 'add' });
    expect(r.body?.done).not.toBe(true);
    expect(writes(w)).toEqual([]);
  });
  it('rejects cycles through directly self-parented or self-blocking issues without GitHub calls', async () => {
    for (const [name,key] of [['github_issue_set_sub_issue','childNumber'],['github_issue_set_dependency','blockingNumber']]) {
      const w = await makeWorld({});
      const r = await call(w,name,{ repo: 'hello', number: 7, [key]:7, mode:'add' });
      expect(r.out.isError).toBe(true);
      expect(w.gh.calls).toEqual([]);
    }
  });
  it('removes a blocking dependency by the provider issue ID and proves its absence', async () => {
    const w = await makeWorld({});
    seq(w.gh, ISSUE, [[200, p], [200, c]]);
    seq(w.gh, BLOCK, [[200, [c]], [200, []]]);
    w.gh.when('DELETE /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by/{issue_id}').reply(204, null);
    const r = await call(w, 'github_issue_set_dependency', { repo: 'hello', number: 7, blockingNumber: 8, mode: 'remove' });
    expect(r.body.done).toBe(true);
    expect(writes(w)).toHaveLength(1);
    expect(writes(w)[0].params.issue_id).toBe('108');
  });
});
