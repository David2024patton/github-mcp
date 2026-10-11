// D-2 part 2: the rules of the file, commit and ref write tools that the write contract does not cover.
import { describe, expect, it } from 'vitest';
import { handlers } from '../../src/tools/code-write.js';
import { createGates } from '../../src/tools/gates.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const run = async (name, w, args) => parse(await handlers[name](args, w.ctx));
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const CONTENT = 'GET /repos/{owner}/{repo}/contents/{path}';
const b64 = (text) => Buffer.from(text).toString('base64');
const file = (extra = {}) => ({ type: 'file', path: 'README.md', sha: A, size: 5, encoding: 'base64', content: b64('hello'), ...extra });

describe('write rules beyond the contract', () => {
  const world = (extra = {}) => makeWorld({ profile: 'full', gates: createGates(), ...extra });
  const branchFacts = (gh, defaultBranch = 'main') => {
    gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: defaultBranch, node_id: 'R_node' });
    gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { protected: false });
    gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
  };

  it('refuses a file that changed since the caller read it, and names the new version', async () => {
    const w = await world();
    branchFacts(w.gh);
    w.gh.when(CONTENT).reply(200, file({ sha: B }));
    const out = await run('github_content_put_file', w, { repo: 'hello', path: 'README.md', branch: 'feature', message: 'm', content: 'new', expectedSha: A, confirm: true });
    expect(out).toMatchObject({ status: 'rejected', error: expect.stringContaining('changed since you read it') });
    expect(out.error).toContain('bbbbbbb');
    expect(w.gh.calls.filter((c) => c.method === 'PUT')).toEqual([]);
  });

  it('sends the current version with an update, and the inverse restores the previous content (not just a delete)', async () => {
    const w = await world();
    branchFacts(w.gh);
    w.gh.when(CONTENT).replySequence([{ status: 200, body: file() }, { status: 200, body: file({ sha: B, content: b64('new') }) }]);
    w.gh.when('PUT /repos/{owner}/{repo}/contents/{path}').reply(200, { content: {}, commit: { sha: B } });
    const out = await run('github_content_put_file', w, { repo: 'hello', path: 'README.md', branch: 'feature', message: 'm', content: 'new', confirm: true });
    expect(out.status).toBe('applied');
    expect(w.gh.calls.find((c) => c.method === 'PUT').body).toMatchObject({ sha: A, branch: 'feature', content: b64('new') });
    const row = await w.db.getChange(1);
    expect(row.inverse).toMatchObject({ tool: 'github_content_put_file', args: { path: 'README.md', encoding: 'base64', content: b64('hello'), expectedSha: B } });
  });

  it('a created file\'s inverse is a delete of that file', async () => {
    const w = await world();
    branchFacts(w.gh);
    w.gh.when(CONTENT).replySequence([{ status: 404, body: {} }, { status: 200, body: file({ sha: B, content: b64('new') }) }]);
    w.gh.when('PUT /repos/{owner}/{repo}/contents/{path}').reply(201, { content: {}, commit: { sha: B } });
    await run('github_content_put_file', w, { repo: 'hello', path: 'README.md', branch: 'feature', message: 'm', content: 'new', confirm: true });
    expect((await w.db.getChange(1)).inverse).toMatchObject({ tool: 'github_content_delete_file', args: { path: 'README.md', branch: 'feature', expectedSha: B } });
  });

  it('refuses a folder where a file was named', async () => {
    const w = await world();
    branchFacts(w.gh);
    w.gh.when(CONTENT).reply(200, [{ name: 'a', type: 'file' }]);
    expect(await run('github_content_put_file', w, { repo: 'hello', path: 'docs', branch: 'feature', message: 'm', content: 'x', confirm: true })).toMatchObject({ status: 'rejected', error: expect.stringContaining('is a folder') });
  });

  it('a commit to the default branch is production, so a preview connection is refused', async () => {
    const w = await world();
    branchFacts(w.gh);
    w.gh.when(CONTENT).reply(404, {});
    const out = await run('github_content_put_file', w, { repo: 'hello', path: 'a.md', branch: 'main', message: 'm', content: 'x', confirm: true });
    expect(out).toMatchObject({ status: 'refused_by_guard', refusedBy: 'mode' });
    expect(out.production).toContain('default branch');
  });

  it('push_files sends the head it read as expectedHeadOid and refuses a branch that moved', async () => {
    const w = await world();
    branchFacts(w.gh);
    w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').replySequence([{ status: 200, body: { object: { sha: A } } }, { status: 200, body: { object: { sha: B } } }]);
    w.gh.when('POST /graphql').reply(200, { data: { createCommitOnBranch: { commit: { oid: B, url: 'u' } } } });
    const out = await run('github_content_push_files', w, { repo: 'hello', branch: 'feature', message: 'Headline\n\nBody text', files: [{ path: 'x/y z.txt', content: 'hi' }], expectedHeadOid: A, confirm: true });
    expect(out).toMatchObject({ status: 'applied', result: { commit: B, signed_by: 'GitHub' } });
    const sent = w.gh.graphql[0].variables.input;
    expect(sent).toMatchObject({ expectedHeadOid: A, branch: { repositoryNameWithOwner: 'example-org/hello', branchName: 'feature' }, message: { headline: 'Headline', body: 'Body text' },
      fileChanges: { additions: [{ path: 'x/y z.txt', contents: b64('hi') }] } });
    expect(w.gh.invalid).toEqual([]);
    const moved = await world();
    branchFacts(moved.gh);
    moved.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(200, { object: { sha: B } });
    expect(await run('github_content_push_files', moved, { repo: 'hello', branch: 'feature', message: 'm', files: [{ path: 'a', content: 'b' }], expectedHeadOid: A, confirm: true }))
      .toMatchObject({ status: 'rejected', error: expect.stringContaining('moved since you read it') });
    expect(moved.gh.graphql).toEqual([]);
  });

  it('push_files refuses duplicates, empty pushes and a missing branch', async () => {
    const w = await world();
    expect(await run('github_content_push_files', w, { repo: 'hello', branch: 'feature', message: 'm' })).toMatchObject({ status: 'refused', error: expect.stringContaining('at least one file') });
    expect(await run('github_content_push_files', w, { repo: 'hello', branch: 'feature', message: 'm', files: [{ path: 'a', content: '1' }], deletePaths: ['a'] })).toMatchObject({ error: expect.stringContaining('more than once') });
    branchFacts(w.gh);
    w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').reply(404, {});
    expect(await run('github_content_push_files', w, { repo: 'hello', branch: 'nope', message: 'm', files: [{ path: 'a', content: '1' }], confirm: true })).toMatchObject({ status: 'rejected', error: expect.stringContaining('does not exist') });
  });

  describe('github_git_update_ref', () => {
    const arrange = (gh, { ahead = 0, branch = 'feature' } = {}) => {
      branchFacts(gh);
      gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').replySequence([{ status: 200, body: { object: { sha: A } } }, { status: 200, body: { object: { sha: B } } }]);
      gh.when('GET /repos/{owner}/{repo}/compare/{basehead}').reply(200, { ahead_by: ahead });
      gh.when('POST /graphql').reply(200, { data: { updateRefs: { clientMutationId: null } } });
      return branch;
    };
    it('sends the head it saw as beforeOid and is recorded with an undo that moves it back', async () => {
      const w = await world();
      arrange(w.gh);
      const out = await run('github_git_update_ref', w, { repo: 'hello', branch: 'feature', sha: B, confirm: true });
      expect(out).toMatchObject({ status: 'applied', result: { was: A, now: B } });
      expect(w.gh.graphql[0].variables.input).toEqual({ repositoryId: 'R_node', refUpdates: [{ name: 'refs/heads/feature', afterOid: B, beforeOid: A, force: false }] });
      expect((await w.db.getChange(1)).inverse).toMatchObject({ tool: 'github_git_update_ref', args: { branch: 'feature', sha: A, force: true, expectedHeadOid: B } });
      expect(w.gh.invalid).toEqual([]);
    });
    it('shows how many commits a move would drop, and refuses it without force', async () => {
      const w = await world();
      arrange(w.gh, { ahead: 3 });
      const preview = await run('github_git_update_ref', w, { repo: 'hello', branch: 'feature', sha: B, dryRun: true });
      expect(preview.preview).toContain('3 commit(s) would be dropped');
      const refused = await run('github_git_update_ref', arrangeAgain(w), { repo: 'hello', branch: 'feature', sha: B, confirm: true });
      expect(refused).toMatchObject({ status: 'rejected', error: expect.stringContaining('force: true') });
      expect(w.gh.graphql).toEqual([]);
    });
    it('a forced move is sent with force and a moved branch is refused', async () => {
      const w = await world();
      arrange(w.gh, { ahead: 2 });
      const out = await run('github_git_update_ref', w, { repo: 'hello', branch: 'feature', sha: B, force: true, confirm: true });
      expect(out.status).toBe('applied');
      expect(w.gh.graphql[0].variables.input.refUpdates[0].force).toBe(true);
      const moved = await world();
      arrange(moved.gh);
      expect(await run('github_git_update_ref', moved, { repo: 'hello', branch: 'feature', sha: B, expectedHeadOid: B, confirm: true })).toMatchObject({ status: 'rejected', error: expect.stringContaining('moved since') });
    });
    it('a forced move of the default branch is production and refused on a preview connection', async () => {
      const w = await world();
      arrange(w.gh, { ahead: 2 });
      const out = await run('github_git_update_ref', w, { repo: 'hello', branch: 'main', sha: B, force: true, confirm: true });
      expect(out).toMatchObject({ status: 'refused_by_guard', refusedBy: 'mode' });
      expect(w.gh.graphql).toEqual([]);
    });
  });

  it('a commit comment needs a path for a line', async () => {
    const w = await world();
    expect(await run('github_commit_comment', w, { repo: 'hello', sha: A, body: 'hi', line: 4 })).toMatchObject({ status: 'refused', error: expect.stringContaining('line needs a path') });
  });
});


// The same world again, with the fake GitHub's reply sequences restarted (a second call in a test needs the same facts again).
function arrangeAgain(w) {
  w.gh.when('GET /repos/{owner}/{repo}/git/ref/{ref}').replySequence([{ status: 200, body: { object: { sha: A } } }, { status: 200, body: { object: { sha: B } } }]);
  return w;
}
