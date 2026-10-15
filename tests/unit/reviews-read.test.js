import { describe, expect, it } from 'vitest';
import { createDispatch } from '../../src/tools/dispatch.js';
import { registry } from '../../src/tools/index.js';
import { makeWorld, parse } from '../../test/helpers/write-contract.js';

const R = { repo: 'hello', number: 7 };
async function run(world, name, args) {
  const dispatch = createDispatch({ credentials: world.credentials, gates: [], fetch: world.gh.fetch, now: world.ctx.now, sleep: async () => {} });
  const result = await dispatch({ registry, name, args, connection: world.connection, db: world.db });
  return { result, body: result.isError ? null : (result.structuredContent ?? parse(result)) };
}
const thread = (id, resolved, extra = {}) => ({ id, isResolved: resolved, isOutdated: false, path: 'a.js', line: 3, startLine: null, comments: { totalCount: 2, nodes: [{ author: { login: 'bob' }, body: 'please fix', authorAssociation: 'NONE', url: 'https://github.com/x/y/pull/7#r1' }] }, ...extra });

describe('review read tools (E-3)', () => {
  it('lists threads with resolved, outdated, location and the latest comment; can show only open ones', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('POST /graphql').reply(200, { data: { repository: { pullRequest: { reviewThreads: { totalCount: 2, nodes: [thread('T1', false), thread('T2', true, { isOutdated: true })] } } } } });
    const all = (await run(w, 'github_review_list_threads', R)).body;
    expect(all).toMatchObject({ total: 2, unresolved: 1, count: 2 });
    expect(all.items[0]).toMatchObject({ id: 'T1', resolved: false, outdated: false, path: 'a.js', line: 3, comments: 2, latest_comment: { author: 'bob', body: 'please fix' } });
    expect(all.items[1]).toMatchObject({ resolved: true, outdated: true });
    expect((await run(w, 'github_review_list_threads', { ...R, unresolvedOnly: true })).body.items.map((t) => t.id)).toEqual(['T1']);
    expect(w.gh.invalid).toEqual([]);
  });

  it('says when the pull request does not exist', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('POST /graphql').reply(200, { data: { repository: { pullRequest: null } } });
    const { result } = await run(w, 'github_review_list_threads', R);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('no pull request #7');
  });

  it('lists reviews and inline comments, filtering comments by file', async () => {
    const w = await makeWorld({ profile: 'read_only' });
    w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews').reply(200, [{ id: 1, user: { login: 'bob' }, state: 'APPROVED', submitted_at: '2026-10-11T00:00:00Z', commit_id: 'a'.repeat(40), body: 'ok', author_association: 'MEMBER' }]);
    w.gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}/comments').reply(200, [
      { id: 10, user: { login: 'bob' }, path: 'a.js', line: 3, side: 'RIGHT', body: 'x', author_association: 'NONE', created_at: 'd', html_url: 'u' },
      { id: 11, user: { login: 'bob' }, path: 'b.js', original_line: 9, side: 'RIGHT', body: 'y', author_association: 'NONE', created_at: 'd', html_url: 'u' }]);
    expect((await run(w, 'github_review_list', R)).body.items[0]).toMatchObject({ user: 'bob', state: 'APPROVED' });
    const comments = (await run(w, 'github_review_list_comments', { ...R, path: 'b.js' })).body;
    expect(comments.items.map((c) => [c.id, c.line])).toEqual([[11, 9]]);
    expect(w.gh.invalid).toEqual([]);
  });
});

describe('W-3 review origin and cursor evidence',()=>{
  it('validates root commit, original range and explicit cursor against the pinned GraphQL schema',async()=>{
    const w=await makeWorld({profile:'read_only'});
    w.gh.when('POST /graphql').reply(200,{data:{repository:{pullRequest:{reviewThreads:{totalCount:2,pageInfo:{hasNextPage:true,endCursor:'cursor-next'},nodes:[thread('T1',false,{originalLine:7,originalStartLine:5,diffSide:'RIGHT',root:{nodes:[{id:'ROOT',body:'original comment',authorAssociation:'NONE',originalCommit:{oid:'a'.repeat(40)}}]}})]}}}}});
    const {body}=await run(w,'github_review_list_threads',{...R,pageSize:1,after:'cursor-first'});
    expect(body).toMatchObject({more_exist:true,next_cursor:'cursor-next'});
    expect(body.items[0]).toMatchObject({original_line:7,original_start_line:5,side:'RIGHT',root_comment:{id:'ROOT',commit_sha:'a'.repeat(40),untrusted:true}});
    expect(w.gh.calls.find(c=>c.method==='POST').body.variables).toMatchObject({first:1,after:'cursor-first'});
    expect(w.gh.invalid).toEqual([]);
  });
});
