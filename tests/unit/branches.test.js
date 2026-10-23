import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, doorsFor, parse } from '../../test/helpers/write-contract.js';
import { protectionGate } from '../../test/helpers/fixture-gates.js';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import * as branches from '../../src/tools/branches.js';

const def = (name) => ({ tool: branches.tools.find((t) => t.name === name), handler: branches.handlers[name] });
const R = { repo: 'hello' };
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const REPO = 'GET /repos/{owner}/{repo}';
const REF = 'GET /repos/{owner}/{repo}/git/ref/{ref}';
const seq = (gh, route, steps) => gh.when(route).replySequence(steps.map(([status, body]) => ({ status, body })));
const writes = (gh) => gh.calls.filter((c) => !['GET', 'HEAD'].includes(c.method));
const gone = [404, { message: 'Not Found' }];
const refAt = (sha) => [200, { object: { sha } }];
const defaultIs = (gh, name) => gh.when(REPO).reply(200, { default_branch: name });

runWriteContract({
  label: 'github_branch_create', definition: def('github_branch_create'), args: { ...R, branch: 'feat' }, needsConfirm: false, conveyor: true,
  gatesFor: ({ protectedLevel }) => (protectedLevel ? [protectionGate(protectedLevel === 'pr-only' ? 'none' : protectedLevel)] : []),
  arrange(gh, outcome) {
    defaultIs(gh, 'trunk');
    gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(200, { sha: A });
    seq(gh, REF, [gone, refAt(outcome === 'ok' ? A : B)]);
    gh.when('POST /repos/{owner}/{repo}/git/refs').reply(201, { ref: 'refs/heads/feat' });
  }
});

runWriteContract({
  label: 'github_branch_rename (default branch)', definition: def('github_branch_rename'), args: { ...R, branch: 'main', new_name: 'primary' }, needsConfirm: true, production: true, profile: 'full',
  arrange(gh, outcome) {
    defaultIs(gh, 'main');
    seq(gh, REF, [refAt(A), gone, refAt(outcome === 'ok' ? A : B)]);
    gh.when('POST /repos/{owner}/{repo}/branches/{branch}/rename').reply(201, {});
  }
});

runWriteContract({
  label: 'github_branch_delete (protected branch)', definition: def('github_branch_delete'), args: { ...R, branch: 'release' }, needsConfirm: true, production: true,
  arrange(gh, outcome) {
    defaultIs(gh, 'main');
    gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { protected: true });
    seq(gh, REF, outcome === 'ok' ? [refAt(A), gone, refAt(A), gone] : [refAt(A), refAt(A)]);
    gh.when('DELETE /repos/{owner}/{repo}/git/refs/{ref}').reply(204, '');
  }
});

runWriteContract({
  label: 'github_branch_merge (default branch)', definition: def('github_branch_merge'), args: { ...R, base: 'main', head: 'dev' }, needsConfirm: true, production: true,
  arrange(gh, outcome) {
    defaultIs(gh, 'main');
    seq(gh, REF, [refAt(A), refAt(outcome === 'ok' ? B : A)]);
    gh.when('GET /repos/{owner}/{repo}/compare/{basehead}').reply(200, { ahead_by: 2, behind_by: 0 });
    gh.when('POST /repos/{owner}/{repo}/merges').reply(201, { sha: B });
  }
});

runWriteContract({
  label: 'github_tag_create', definition: def('github_tag_create'), args: { ...R, tag: 'v1' }, needsConfirm: true, production: true, profile: 'full',
  arrange(gh, outcome) {
    defaultIs(gh, 'main');
    gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(200, { sha: A });
    seq(gh, REF, [gone, outcome === 'ok' ? refAt(A) : gone]);
    gh.when('POST /repos/{owner}/{repo}/git/refs').reply(201, {});
  }
});

runWriteContract({
  label: 'github_tag_delete', definition: def('github_tag_delete'), args: { ...R, tag: 'v1' }, needsConfirm: true, production: true, profile: 'full',
  arrange(gh, outcome) {
    seq(gh, REF, outcome === 'ok' ? [refAt(A), gone, refAt(A), gone] : [refAt(A), refAt(A)]);
    gh.when('DELETE /repos/{owner}/{repo}/git/refs/{ref}').reply(204, '');
  }
});

describe('branches and tags: extra checks (BATCH-D §4 D-3)', () => {
  const call = async (name, w, args) => parse(await doorsFor(def(name))[0].call(w, args));

  it('branch_create starts from the repository\'s real default branch, never a guessed main (audit G4)', async () => {
    const w = await makeWorld();
    defaultIs(w.gh, 'trunk');
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(200, { sha: A });
    seq(w.gh, REF, [gone, refAt(A)]);
    w.gh.when('POST /repos/{owner}/{repo}/git/refs').reply(201, {});
    const out = await call('github_branch_create', w, { ...R, branch: 'feat' });
    expect(out.status).toBe('applied');
    expect(w.gh.calls.find((c) => c.route.endsWith('/commits/{ref}')).params.ref).toBe('trunk');
    expect(writes(w.gh)[0].body).toEqual({ ref: 'refs/heads/feat', sha: A });
    expect(out.summary).toContain('from trunk');
  });

  it('branch_create can start from a tag or commit, and says plainly when the start does not exist', async () => {
    const w = await makeWorld();
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(404, { message: 'Not Found' });
    seq(w.gh, REF, [gone]);
    const out = await call('github_branch_create', w, { ...R, branch: 'feat', from: 'v9', confirm: true });
    expect(out.status).toBe('rejected');
    expect(out.error).toBeDefined();
    expect(writes(w.gh)).toEqual([]);
  });

  it('the default branch can never be deleted, even on a production connection with confirm', async () => {
    const w = await makeWorld({ mode: 'production' });
    defaultIs(w.gh, 'main');
    w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { protected: false });
    seq(w.gh, REF, [refAt(A)]);
    const out = await call('github_branch_delete', w, { ...R, branch: 'main', confirm: true });
    expect(out.status).toBe('rejected');
    expect(out.error).toContain('default branch');
    expect(writes(w.gh)).toEqual([]);
  });

  it('a deleted branch can be recreated from the recorded commit', async () => {
    const w = await makeWorld({ mode: 'production' });
    defaultIs(w.gh, 'main');
    w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { protected: true });
    seq(w.gh, REF, [refAt(A), gone]);
    w.gh.when('DELETE /repos/{owner}/{repo}/git/refs/{ref}').reply(204, '');
    await call('github_branch_delete', w, { ...R, branch: 'release', confirm: true });
    expect((await w.db.getChange(1)).inverse).toMatchObject({ tool: 'github_branch_create', args: { branch: 'release', from: A } });
  });

  it('an unprotected feature branch can be deleted without production', async () => {
    const w = await makeWorld();
    defaultIs(w.gh, 'main');
    w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { protected: false });
    w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
    seq(w.gh, REF, [refAt(A), gone]);
    w.gh.when('DELETE /repos/{owner}/{repo}/git/refs/{ref}').reply(204, '');
    expect(await call('github_branch_delete', w, { ...R, branch: 'feat', confirm: true })).toMatchObject({ status: 'applied' });
    expect(decodeURIComponent(writes(w.gh)[0].params.ref)).toBe('heads/feat');
  });

  it('invalid names are refused before anything is read', async () => {
    const w = await makeWorld();
    expect((await call('github_branch_create', w, { ...R, branch: 'bad name' })).status).toBe('refused');
    expect((await call('github_tag_create', await makeWorld({ profile: 'full' }), { ...R, tag: 'a..b' })).status).toBe('refused');
    expect(w.gh.calls).toEqual([]);
  });

  it('an annotated tag creates the tag object first, then the ref pointing at it', async () => {
    const w = await makeWorld({ mode: 'production', profile: 'full' });
    defaultIs(w.gh, 'main');
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(200, { sha: A });
    seq(w.gh, REF, [gone, refAt(B)]);
    w.gh.when('POST /repos/{owner}/{repo}/git/tags').reply(201, { sha: B });
    w.gh.when('POST /repos/{owner}/{repo}/git/refs').reply(201, {});
    const out = await call('github_tag_create', w, { ...R, tag: 'v2', message: 'Release 2', confirm: true });
    expect(out.status).toBe('applied');
    const sent = writes(w.gh);
    expect(sent[0].body).toMatchObject({ tag: 'v2', message: 'Release 2', object: A, type: 'commit' });
    expect(sent[1].body).toEqual({ ref: 'refs/tags/v2', sha: B });
    expect(w.gh.invalid).toEqual([]);
    expect((await w.db.getChange(1)).inverse).toMatchObject({ tool: 'github_tag_delete', args: { tag: 'v2' } });
  });

  it('merging into a branch that is not production needs no confirmation and reports "nothing to merge" for a 204', async () => {
    const w = await makeWorld();
    defaultIs(w.gh, 'main');
    w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { protected: false });
    w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
    seq(w.gh, REF, [refAt(A), refAt(A)]);
    w.gh.when('GET /repos/{owner}/{repo}/compare/{basehead}').reply(200, { ahead_by: 0, behind_by: 0 });
    w.gh.when('POST /repos/{owner}/{repo}/merges').reply(204, '');
    const out = await call('github_branch_merge', w, { ...R, base: 'feat', head: 'dev' });
    expect(out).toMatchObject({ status: 'applied', result: { result: expect.stringContaining('nothing to merge') } });
  });

  describe('reads', () => {
    const run = async (w, name, args) => {
      const result = await createDispatch({ credentials: w.credentials, gates: [], fetch: w.gh.fetch, now: w.ctx.now }).call(null, { registry, name, args, connection: w.connection, db: w.db });
      return result.structuredContent ?? parse(result);
    };
    it('branch_list never sends an empty protected= (audit G9) and sends it only when asked', async () => {
      const w = await makeWorld({ profile: 'read_only' });
      w.gh.when('GET /repos/{owner}/{repo}/branches').reply(200, [{ name: 'main', protected: true, commit: { sha: A } }]);
      const all = await run(w, 'github_branch_list', R);
      expect(all.items[0]).toMatchObject({ name: 'main', protected: true, sha: A });
      expect(w.gh.calls[0].query).not.toHaveProperty('protected');
      await run(w, 'github_branch_list', { ...R, protected: false });
      expect(w.gh.calls[1].query).toMatchObject({ protected: 'false' });
      expect(w.gh.invalid).toEqual([]);
    });
    it('branch_get shows the head, whether it is the default and the rules that apply', async () => {
      const w = await makeWorld({ profile: 'read_only' });
      w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { name: 'main', protected: true, commit: { sha: A, commit: { message: 'Top\n\nmore', author: { date: '2026-10-10T10:00:00Z' } }, author: { login: 'octo' } } });
      defaultIs(w.gh, 'main');
      w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, [{ type: 'pull_request', ruleset_id: 3 }]);
      expect(await run(w, 'github_branch_get', { ...R, branch: 'main' })).toMatchObject({ is_default: true, protected: true, head: A, message: 'Top', rules: [{ type: 'pull_request' }] });
    });
    it('branch_get treats GitHub\'s exact plan-limit answer as no rules, and any other failure as unknown', async () => {
      const w = await makeWorld({ profile: 'read_only' });
      w.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { name: 'feat', protected: false, commit: { sha: A, commit: { message: 'x', author: { date: '2026-10-10T10:00:00Z' } } } });
      defaultIs(w.gh, 'main');
      w.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(403, { message: 'Upgrade to GitHub Pro or make this repository public to enable this feature.' });
      expect(await run(w, 'github_branch_get', { ...R, branch: 'feat' })).toMatchObject({ rules: [], rules_note: expect.stringContaining('GitHub plan') });
      const w2 = await makeWorld({ profile: 'read_only' });
      w2.gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { name: 'feat', protected: false, commit: { sha: A, commit: { message: 'x', author: { date: '2026-10-10T10:00:00Z' } } } });
      defaultIs(w2.gh, 'main');
      w2.gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(403, { message: 'Resource not accessible by integration' });
      const other = await run(w2, 'github_branch_get', { ...R, branch: 'feat' });
      expect(other.rules).toEqual({ unknown: 'The rules for this branch could not be read.' });
      expect(other).not.toHaveProperty('rules_note');
    });
    it('tag_list returns each tag with its commit', async () => {
      const w = await makeWorld({ profile: 'read_only' });
      w.gh.when('GET /repos/{owner}/{repo}/tags').reply(200, [{ name: 'v1', commit: { sha: A } }]);
      expect((await run(w, 'github_tag_list', R)).items).toEqual([{ name: 'v1', sha: A }]);
    });
  });
});
