import { describe, expect, it } from 'vitest';
import { runWriteContract, doorsFor, makeWorld, parse } from '../../test/helpers/write-contract.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import * as stacks from '../../src/tools/pulls-stacks.js';

const R = { repo: 'hello' };
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const pr = (number, base, head, sha) => ({
  number, state: 'open', merged_at: null, draft: false,
  base: { ref: base }, head: { ref: head, sha, repo: { full_name: 'example-org/hello' } }
});
const one = pr(1, 'main', 'feature/a', A);
const two = pr(2, 'feature/a', 'feature/b', B);
const three = pr(3, 'feature/b', 'feature/c', A);
const stack = (list = [one, two]) => ({ number: 42, open: true, base: { ref: 'main' }, pull_requests: list });
const def = (name) => ({ tool: stacks.tools.find((t) => t.name === name), handler: stacks.handlers[name] });
const seq = (gh, route, entries) => gh.when(route).replySequence(entries.map(([status, body]) => ({ status, body })));
const PR = 'GET /repos/{owner}/{repo}/pulls/{pull_number}';
const STACK = 'GET /repos/{owner}/{repo}/stacks/{stack_number}';
const sent = (gh) => gh.calls.filter((c) => c.method === 'POST');
const call = async (name, w, args) => parse(await doorsFor(def(name))[0].call(w, args));

runWriteContract({
  label: 'github_pr_stack_manage (create)', definition: def('github_pr_stack_manage'),
  args: { ...R, action: 'create', pullRequestNumbers: [1, 2] },
  needsConfirm: false, conveyor: true,
  arrange(gh, outcome) {
    seq(gh, PR, [[200, one], [200, two]]);
    gh.when('POST /repos/{owner}/{repo}/stacks').reply(201, stack());
    gh.when(STACK).reply(200, stack(outcome === 'ok' ? [one, two] : [one]));
  }
});

runWriteContract({
  label: 'github_pr_stack_manage (append)', definition: def('github_pr_stack_manage'),
  args: { ...R, action: 'add', stackNumber: 42, pullRequestNumbers: [3] },
  needsConfirm: false, conveyor: true,
  arrange(gh, outcome) {
    seq(gh, STACK, [[200, stack()], [200, stack(outcome === 'ok' ? [one, two, three] : [one, two])]]);
    gh.when(PR).reply(200, three);
    gh.when('POST /repos/{owner}/{repo}/stacks/{stack_number}/add').reply(200, stack([one, two, three]));
  }
});

runWriteContract({
  label: 'github_pr_stack_manage (unstack)', definition: def('github_pr_stack_manage'),
  args: { ...R, action: 'unstack', stackNumber: 42 },
  needsConfirm: false, conveyor: true,
  arrange(gh, outcome) {
    seq(gh, STACK, [[200, stack()], outcome === 'ok' ? [404, { message: 'Not Found' }] : [200, stack()]]);
    gh.when('POST /repos/{owner}/{repo}/stacks/{stack_number}/unstack').reply(204, '');
  }
});

describe('E-2 stack behavior', () => {
  const runRead = async (w, args) => {
    const dispatcher = createDispatch({ credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now });
    const result = await dispatcher({ registry, name: 'github_pr_list_stacks', args, connection: w.connection, db: w.db });
    return parse(result);
  };

  it('lists stacks in GitHub order with a bounded page and no invented totals', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/stacks').reply(200, [stack()]);
    const body = await runRead(w, { ...R, pullRequest: 2, max: 1, page: 3 });
    expect(body).toMatchObject({ count: 1, page: 3, next_page_possible: 4 });
    expect(body.items[0].pull_requests.map((p) => p.number)).toEqual([1, 2]);
    expect(w.gh.calls[0].query).toMatchObject({ pull_request: '2', per_page: '1', page: '3' });
    expect(w.gh.invalid).toEqual([]);
  });

  it('reads one stack by number and makes an unknown stack explicit', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    seq(w.gh, STACK, [[200, stack()], [404, { message: 'Not Found' }]]);
    expect((await runRead(w, { ...R, stackNumber: 42 })).pull_requests).toHaveLength(2);
    expect(await runRead(w, { ...R, stackNumber: 99 })).toMatchObject({ not_found: 99 });
  });

  it('refuses an inconsistent branch chain before creating a stack', async () => {
    const w = await makeWorld();
    seq(w.gh, PR, [[200, one], [200, pr(2, 'wrong/base', 'feature/b', B)]]);
    const out = await call('github_pr_stack_manage', w, { ...R, action: 'create', pullRequestNumbers: [1, 2], confirm: true });
    expect(out.status).toBe('rejected');
    expect(sent(w.gh)).toEqual([]);
  });

  it('refuses a stale expected head before mutation', async () => {
    const w = await makeWorld();
    seq(w.gh, PR, [[200, one], [200, two]]);
    const out = await call('github_pr_stack_manage', w, { ...R, action: 'create',
      pullRequestNumbers: [1, 2], expectedHeadShas: [A, A], confirm: true });
    expect(out.status).toBe('rejected');
    expect(sent(w.gh)).toEqual([]);
  });

  it('rejects duplicate PR numbers, malformed modes and mismatched expected-head counts', async () => {
    for (const args of [
      { action: 'create', pullRequestNumbers: [1, 1] },
      { action: 'create', pullRequestNumbers: [1] },
      { action: 'add', pullRequestNumbers: [1] },
      { action: 'unstack', stackNumber: 42, pullRequestNumbers: [1] },
      { action: 'create', pullRequestNumbers: [1, 2], expectedHeadShas: [A] }
    ]) {
      const w = await makeWorld();
      const out = await call('github_pr_stack_manage', w, { ...R, ...args, confirm: true });
      expect(['refused', 'rejected']).toContain(out.status);
      expect(w.gh.calls).toEqual([]);
    }
  });

  it('keeps a locked PR as a partial unstack rather than claiming every PR was removed', async () => {
    const w = await makeWorld();
    seq(w.gh, STACK, [[200, stack()], [200, stack([one])]]);
    w.gh.when('POST /repos/{owner}/{repo}/stacks/{stack_number}/unstack').reply(200, stack([one]));
    const out = await call('github_pr_stack_manage', w, { ...R, action: 'unstack', stackNumber: 42, confirm: true });
    expect(out).toMatchObject({ status: 'applied', result: { dissolved: false, removed_count: 1 } });
    expect(w.gh.invalid).toEqual([]);
  });
});
