import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import { protectionGate } from '../../test/helpers/fixture-gates.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import * as pulls from '../../src/tools/pulls-write.js';

const def = (name) => ({ tool: pulls.tools.find((t) => t.name === name), handler: pulls.handlers[name] });
const R = { repo: 'hello' };
const A = 'a'.repeat(40);
const PRS = 'GET /repos/{owner}/{repo}/pulls/{pull_number}';
const seq = (gh, route, steps) => gh.when(route).replySequence(steps.map(([status, body]) => ({ status, body })));
const pr = (extra = {}) => ({ number: 7, node_id: 'PR_x', title: 'Old', body: 'old body', state: 'open', draft: false, merged: false, head: { ref: 'feat', sha: A }, base: { ref: 'main' }, html_url: 'u', ...extra });
const conveyor = ({ protectedLevel }) => (protectedLevel ? [protectionGate(protectedLevel === 'pr-only' ? 'none' : protectedLevel)] : []);

runWriteContract({
  label: 'github_pr_create', definition: def('github_pr_create'), args: { ...R, head: 'feat', title: 'T', body: 'b' }, needsConfirm: false, conveyor: true, gatesFor: conveyor,
  arrange(gh, outcome) {
    gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main' });
    gh.when('GET /repos/{owner}/{repo}/pulls').reply(200, []);
    gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200, { object: { sha: A } });
    gh.when('POST /repos/{owner}/{repo}/pulls').reply(201, pr());
    gh.when(PRS).reply(200, pr({ head: { ref: outcome === 'ok' ? 'feat' : 'other', sha: A } }));
  }
});
runWriteContract({
  label: 'github_pr_update', definition: def('github_pr_update'), args: { ...R, number: 7, title: 'New' }, needsConfirm: false, conveyor: true, gatesFor: conveyor,
  arrange(gh, outcome) {
    seq(gh, PRS, [[200, pr()], [200, pr({ title: outcome === 'ok' ? 'New' : 'Old' })]]);
    gh.when('PATCH /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, pr());
  }
});
runWriteContract({
  label: 'github_pr_close', definition: def('github_pr_close'), args: { ...R, number: 7 }, needsConfirm: true, conveyor: true, gatesFor: conveyor,
  arrange(gh, outcome) {
    seq(gh, PRS, [[200, pr()], [200, pr({ state: outcome === 'ok' ? 'closed' : 'open' })]]);
    gh.when('PATCH /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, pr());
  }
});
runWriteContract({
  label: 'github_pr_set_draft', definition: def('github_pr_set_draft'), args: { ...R, number: 7, draft: true }, needsConfirm: false, conveyor: true, gatesFor: conveyor,
  arrange(gh, outcome) {
    seq(gh, PRS, [[200, pr()], [200, pr({ draft: outcome === 'ok' })]]);
    gh.when('POST /graphql').reply(200, { data: { convertPullRequestToDraft: { pullRequest: { isDraft: true } } } });
  }
});
runWriteContract({
  label: 'github_pr_update_branch', definition: def('github_pr_update_branch'), args: { ...R, number: 7, expectedHeadSha: A }, needsConfirm: false, conveyor: true, gatesFor: conveyor,
  arrange(gh, outcome) {
    seq(gh, PRS, outcome === 'ok' ? [[200, pr()], [200, pr()]] : [[200, pr()], [404, { message: 'Not Found' }]]);
    gh.when('PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch').reply(202, { message: 'Updating pull request branch.' });
  }
});

async function call(w, name, args) {
  const dispatch = createDispatch({ credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now, sleep: async () => {} });
  const result = await dispatch({ registry, name, args, connection: w.connection, db: w.db });
  return { result, body: parse(result) };
}
const writes = (gh) => gh.calls.filter((c) => !['GET', 'HEAD'].includes(c.method));

describe('pull request changes (E-1b)', () => {
  it('returns the open pull request instead of failing when one exists for the same head and base', async () => {
    const w = await makeWorld({});
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main' });
    w.gh.when('GET /repos/{owner}/{repo}/pulls').reply(200, [pr()]);
    w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200, { object: { sha: A } });
    w.gh.when(PRS).reply(200, pr());
    const { body } = await call(w, 'github_pr_create', { ...R, head: 'feat', title: 'T' });
    expect(body).toMatchObject({ done: true, result: { number: 7, replayed: true } });
    expect(writes(w.gh)).toEqual([]);
    expect(w.gh.calls.find((c) => c.route === 'GET /repos/{owner}/{repo}/pulls').query).toMatchObject({ head: 'example-org:feat', base: 'main', state: 'open' });
  });
  it('adds the recording footer, uses the real default branch and sends draft', async () => {
    const w = await makeWorld({});
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'trunk' });
    w.gh.when('GET /repos/{owner}/{repo}/pulls').reply(200, []);
    w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200, { object: { sha: A } });
    w.gh.when('POST /repos/{owner}/{repo}/pulls').reply(201, pr({ draft: true, base: { ref: 'trunk' } }));
    w.gh.when(PRS).reply(200, pr({ draft: true, base: { ref: 'trunk' } }));
    const { body } = await call(w, 'github_pr_create', { ...R, head: 'feat', title: 'T', body: 'hello', draft: true });
    expect(body.done).toBe(true);
    const sent = writes(w.gh)[0].body;
    expect(sent).toMatchObject({ base: 'trunk', head: 'feat', draft: true });
    expect(sent.body).toBe(`hello\n\n${pulls.FOOTER}`);
    expect(w.gh.invalid).toEqual([]);
  });
  it('refuses when the head branch does not exist, and when head equals base', async () => {
    const w = await makeWorld({});
    w.gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: 'main' });
    w.gh.when('GET /repos/{owner}/{repo}/pulls').reply(200, []);
    w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(404, { message: 'Not Found' });
    const { body } = await call(w, 'github_pr_create', { ...R, head: 'nope', title: 'T' });
    expect(body.done).toBe(false);
    expect(writes(w.gh)).toEqual([]);
    const same = await call(await makeWorld({}), 'github_pr_create', { ...R, head: 'main', base: 'main', title: 'T' });
    expect(same.result.isError).toBe(true);
  });
  it('a retarget previews how many commits the pull request will then carry', async () => {
    const w = await makeWorld({});
    w.gh.when(PRS).reply(200, pr());
    w.gh.when('GET /repos/{owner}/{repo}/compare/{basehead}').reply(200, { ahead_by: 3, behind_by: 0 });
    const { body } = await call(w, 'github_pr_update', { ...R, number: 7, base: 'release', dryRun: true });
    expect(body.preview).toContain('carry 3 commits');
    expect(w.gh.calls.find((c) => c.route === 'GET /repos/{owner}/{repo}/compare/{basehead}').params.basehead).toBe(`release...${A}`);
    expect(writes(w.gh)).toEqual([]);
  });
  it('update needs something to change and will not touch a merged pull request', async () => {
    const empty = await call(await makeWorld({}), 'github_pr_update', { ...R, number: 7 });
    expect(empty.result.isError).toBe(true);
    const w = await makeWorld({});
    w.gh.when(PRS).reply(200, pr({ merged: true, state: 'closed' }));
    const { body } = await call(w, 'github_pr_update', { ...R, number: 7, title: 'x' });
    expect(body.done).toBe(false);
    expect(writes(w.gh)).toEqual([]);
  });
  it('the undo of a title change restores the old title', async () => {
    const w = await makeWorld({});
    seq(w.gh, PRS, [[200, pr()], [200, pr({ title: 'New' })]]);
    w.gh.when('PATCH /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, pr());
    const { body } = await call(w, 'github_pr_update', { ...R, number: 7, title: 'New' });
    expect(body.done).toBe(true);
    expect((await w.db.getChange(1)).inverse).toMatchObject({ tool: 'github_pr_update', args: { number: 7, title: 'Old' } });
  });
  it('set_draft changes nothing when it is already in the wanted state', async () => {
    const w = await makeWorld({});
    w.gh.when(PRS).reply(200, pr({ draft: true }));
    const { body } = await call(w, 'github_pr_set_draft', { ...R, number: 7, draft: true });
    expect(body).toMatchObject({ done: true, result: { draft: true } });
    expect(w.gh.graphql).toEqual([]);
  });
  it('ready-for-review uses the other mutation, validated against the schema', async () => {
    const w = await makeWorld({});
    seq(w.gh, PRS, [[200, pr({ draft: true })], [200, pr({ draft: false })]]);
    w.gh.when('POST /graphql').reply(200, { data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } });
    const { body } = await call(w, 'github_pr_set_draft', { ...R, number: 7, draft: false });
    expect(body.done).toBe(true);
    expect(w.gh.graphql[0].query).toContain('markPullRequestReadyForReview');
    expect(w.gh.graphql[0].variables).toEqual({ id: 'PR_x' });
    expect(w.gh.invalid).toEqual([]);
  });
  it('update_branch refuses when new commits arrived since the head was read', async () => {
    const w = await makeWorld({});
    w.gh.when(PRS).reply(200, pr({ head: { ref: 'feat', sha: 'b'.repeat(40) } }));
    const { body } = await call(w, 'github_pr_update_branch', { ...R, number: 7, expectedHeadSha: A });
    expect(body.done).toBe(false);
    expect(JSON.stringify(body)).toContain('New commits arrived');
    expect(writes(w.gh)).toEqual([]);
  });
  it('update_branch sends the expected head to GitHub', async () => {
    const w = await makeWorld({});
    w.gh.when(PRS).reply(200, pr());
    w.gh.when('PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch').reply(202, { message: 'ok' });
    const { body } = await call(w, 'github_pr_update_branch', { ...R, number: 7, expectedHeadSha: A });
    expect(body.done).toBe(true);
    expect(writes(w.gh)[0].body).toEqual({ expected_head_sha: A });
    expect(w.gh.invalid).toEqual([]);
  });
  it('close refuses an already closed pull request', async () => {
    const w = await makeWorld({});
    w.gh.when(PRS).reply(200, pr({ state: 'closed' }));
    const { body } = await call(w, 'github_pr_close', { ...R, number: 7, confirm: true });
    expect(body.done).toBe(false);
    expect(writes(w.gh)).toEqual([]);
  });
  it('a body that mentions an outsider needs confirmation', async () => {
    const w = await makeWorld({});
    w.gh.when(PRS).reply(200, pr());
    w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}/commits').reply(200, []);
    const { body } = await call(w, 'github_pr_update', { ...R, number: 7, body: 'cc @some-stranger please look' });
    expect(body.status).toBe('needs_confirmation');
    expect(writes(w.gh)).toEqual([]);
  });
});
