// D-3: rules of the branch and tag tools that the write contract does not cover.
import { describe, expect, it } from 'vitest';
import { handlers } from '../../src/tools/branches.js';
import { createGates } from '../../src/tools/gates.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const run = async (name, w, args) => parse(await handlers[name](args, w.ctx));
const A = 'a'.repeat(40);
const REF = 'GET /repos/{owner}/{repo}/git/ref/{ref}';
const facts = (gh, defaultBranch = 'main') => {
  gh.when('GET /repos/{owner}/{repo}').reply(200, { default_branch: defaultBranch, full_name: 'example-org/hello' });
  gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, { name: 'x', protected: false });
  gh.when('GET /repos/{owner}/{repo}/rules/branches/{branch}').reply(200, []);
};

describe('branch and tag rules', () => {
  it('never deletes the default branch, even on a production connection with confirm', async () => {
    const w = await makeWorld({ mode: 'production', gates: createGates() });
    facts(w.gh);
    w.gh.when(REF).reply(200, { ref: 'refs/heads/main', object: { sha: A, type: 'commit' } });
    const out = await run('github_branch_delete', w, { repo: 'hello', branch: 'main', confirm: true });
    expect(out.status).not.toBe('applied');
    expect(w.gh.calls.filter((c) => c.method === 'DELETE')).toEqual([]);
  });

  it('starts a new branch from the repository\'s real default branch, not a guessed "main"', async () => {
    const w = await makeWorld({ gates: createGates() });
    facts(w.gh, 'trunk');
    w.gh.when(REF).replySequence([{ status: 404, body: { message: 'Not Found' } }, { status: 200, body: { ref: 'refs/heads/f', object: { sha: A, type: 'commit' } } }]);
    w.gh.when('GET /repos/{owner}/{repo}/commits/{ref}').reply(200, { sha: A });
    w.gh.when('POST /repos/{owner}/{repo}/git/refs').reply(201, { ref: 'refs/heads/f', object: { sha: A } });
    const out = await run('github_branch_create', w, { repo: 'hello', branch: 'f' });
    expect(out.status).toBe('applied');
    expect(w.gh.calls.find((c) => /commits/.test(JSON.stringify(c))).params.ref).toBe('trunk');
  });

  it('creating a tag is a production change: refused on a preview connection', async () => {
    const w = await makeWorld({ profile: 'full', gates: createGates() });
    facts(w.gh);
    const out = await run('github_tag_create', w, { repo: 'hello', tag: 'v1', from: A, confirm: true });
    expect(out).toMatchObject({ status: 'refused_by_guard', refusedBy: 'mode' });
  });

  it('branch list sends no empty "protected" filter unless asked', async () => {
    const w = await makeWorld({ gates: createGates() });
    w.gh.when('GET /repos/{owner}/{repo}/branches').reply(200, [{ name: 'main', protected: true, commit: { sha: A } }]);
    await handlers.github_branch_list({ repo: 'hello' }, w.ctx);
    const call = w.gh.calls.find((c) => c.method === 'GET' && JSON.stringify(c).includes('branches'));
    expect(call.query ?? {}).not.toHaveProperty('protected');
  });
});
