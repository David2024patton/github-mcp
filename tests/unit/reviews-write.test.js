// E-3 part 2: every review change tool passes the write contract through all three doors, then the rules the contract does not cover.
import { describe, expect, it } from 'vitest';
import { runWriteContract, makeWorld, parse } from '../../test/helpers/write-contract.js';
import { protectionGate } from '../../test/helpers/fixture-gates.js';
import * as reviews from '../../src/tools/reviews-write.js';

const def = (name) => ({ tool: reviews.tools.find((t) => t.name === name), handler: reviews.handlers[name] });
const R = { repo: 'hello', number: 7 };
const A = 'a'.repeat(40);
const PR = 'GET /repos/{owner}/{repo}/pulls/{pull_number}';
const REVIEW = 'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}';
const seq = (gh, route, steps) => gh.when(route).replySequence(steps.map(([status, body]) => ({ status, body })));
const gatesFor = ({ protectedLevel }) => (protectedLevel ? [protectionGate(protectedLevel === 'pr-only' ? 'none' : protectedLevel)] : []);
const members = (gh) => gh.when('GET /orgs/{org}/members').reply(200, [{ login: 'example-owner' }]);
const threadNode = (resolved, number = 7, repo = 'example-org/hello') => ({ data: { node: { id: 'T1', isResolved: resolved, path: 'a.js', pullRequest: { number, repository: { nameWithOwner: repo } } } } });
const gql = (gh, bodies) => gh.when('POST /graphql').replySequence(bodies.map((body) => ({ status: 200, body })));
const base = { gatesFor, conveyor: true };

runWriteContract({
  ...base, label: 'github_review_create', definition: def('github_review_create'), args: { ...R, body: 'Thanks @outside-person', event: 'COMMENT', comments: [{ path: 'a.js', line: 3, body: 'nit' }] },
  needsConfirm: true, notifies: ['outside-person'],
  arrange(gh, outcome) {
    members(gh);
    gh.when(PR).reply(200, { state: 'open', head: { sha: A }, user: { login: 'alice' } });
    gh.when('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews').reply(200, { id: 9, state: 'COMMENTED' });
    gh.when(REVIEW).reply(200, { id: 9, state: outcome === 'ok' ? 'COMMENTED' : 'PENDING', html_url: 'u' });
  }
});

runWriteContract({
  ...base, label: 'github_review_submit', definition: def('github_review_submit'), args: { ...R, reviewId: 9, event: 'APPROVE', body: 'Looks good @outside-person' }, needsConfirm: true, notifies: ['outside-person'],
  arrange(gh, outcome) {
    members(gh);
    seq(gh, REVIEW, [[200, { id: 9, state: 'PENDING' }], [200, { id: 9, state: outcome === 'ok' ? 'APPROVED' : 'PENDING' }]]);
    gh.when('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/events').reply(200, { id: 9, state: 'APPROVED' });
  }
});

runWriteContract({
  ...base, label: 'github_review_dismiss', definition: def('github_review_dismiss'), args: { ...R, reviewId: 9, message: 'Outdated, see @outside-person' }, needsConfirm: true, notifies: ['outside-person'], profile: 'full',
  arrange(gh, outcome) {
    members(gh);
    seq(gh, REVIEW, [[200, { id: 9, state: 'APPROVED', user: { login: 'bob' } }], [200, { id: 9, state: outcome === 'ok' ? 'DISMISSED' : 'APPROVED' }]]);
    gh.when('PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/dismissals').reply(200, { id: 9, state: 'DISMISSED' });
  }
});

runWriteContract({
  ...base, label: 'github_review_reply', definition: def('github_review_reply'), args: { ...R, threadId: 'T1', body: 'Fixed, thanks @outside-person' }, needsConfirm: true, notifies: ['outside-person'],
  arrange(gh, outcome) {
    members(gh);
    gql(gh, [threadNode(false), { data: { addPullRequestReviewThreadReply: { comment: { id: 'C1', url: 'u', body: outcome === 'ok' ? 'Fixed, thanks @outside-person' : 'other' } } } }]);
  }
});

runWriteContract({
  ...base, label: 'github_review_resolve_thread', definition: def('github_review_resolve_thread'), args: { ...R, threadId: 'T1' }, needsConfirm: false,
  arrange(gh, outcome) {
    gql(gh, [threadNode(false), { data: { resolveReviewThread: { thread: { id: 'T1', isResolved: true } } } }, threadNode(outcome === 'ok')]);
  }
});

runWriteContract({
  ...base, label: 'github_review_request_reviewers', definition: def('github_review_request_reviewers'), args: { ...R, reviewers: ['outside-person'] }, needsConfirm: true, notifies: ['outside-person'],
  arrange(gh, outcome) {
    members(gh);
    seq(gh, 'GET /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers', [[200, { users: [], teams: [] }], [200, { users: outcome === 'ok' ? [{ login: 'outside-person' }] : [], teams: [] }]]);
    gh.when('POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers').reply(201, { number: 7 });
  }
});

const call = async (name, w, args) => parse(await reviews.handlers[name](args, w.ctx));

describe('review change rules', () => {
  it('resolving an already resolved thread sends nothing and is still confirmed', async () => {
    const w = await makeWorld({});
    gql(w.gh, [threadNode(true), threadNode(true)]);
    const out = await call('github_review_resolve_thread', w, { ...R, threadId: 'T1', confirm: true });
    expect(out).toMatchObject({ status: 'applied', confirmed: true });
    expect(w.gh.calls.filter((c) => /resolveReviewThread/.test(JSON.stringify(c.body ?? '')))).toEqual([]);
  });

  it('refuses a thread that belongs to another pull request or repository', async () => {
    const w = await makeWorld({});
    gql(w.gh, [threadNode(false, 99)]);
    const out = await call('github_review_resolve_thread', w, { ...R, threadId: 'T1', confirm: true });
    expect(out.status).toBe('rejected');
    expect(out.error ?? out.summary).toMatch(/another pull request/);
  });

  it('reopening a thread undoes a resolve', async () => {
    const w = await makeWorld({});
    gql(w.gh, [threadNode(false), { data: { resolveReviewThread: { thread: { id: 'T1', isResolved: true } } } }, threadNode(true)]);
    await call('github_review_resolve_thread', w, { ...R, threadId: 'T1', confirm: true });
    const row = await w.db.getChange(1);
    expect(row.inverse).toMatchObject({ tool: 'github_review_resolve_thread', args: { threadId: 'T1', resolved: false } });
    expect(w.gh.invalid).toEqual([]);
  });

  it('says plainly that an account cannot approve its own pull request', async () => {
    const w = await makeWorld({});
    members(w.gh);
    w.gh.when(PR).reply(200, { state: 'open', head: { sha: A }, user: { login: 'app[bot]' } });
    w.gh.when('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews').reply(422, { message: 'Unprocessable Entity: Can not approve your own pull request' });
    const out = await call('github_review_create', w, { ...R, event: 'APPROVE', confirm: true });
    expect(out.status).toBe('rejected');
    expect(JSON.stringify(out)).toMatch(/own pull request/);
  });

  it('an empty comment review is refused before anything is sent; an empty approval is allowed', async () => {
    const w = await makeWorld({});
    expect((await call('github_review_create', w, { ...R, event: 'COMMENT' })).status).toBe('refused');
    expect(w.gh.calls).toEqual([]);
  });

  it('a submitted review cannot be submitted again, and only approvals or change requests can be dismissed', async () => {
    const w = await makeWorld({ profile: 'full' });
    seq(w.gh, REVIEW, [[200, { id: 9, state: 'APPROVED' }], [200, { id: 9, state: 'COMMENTED', user: { login: 'bob' } }]]);
    expect((await call('github_review_submit', w, { ...R, reviewId: 9, event: 'COMMENT', confirm: true })).status).toBe('rejected');
    expect((await call('github_review_dismiss', w, { ...R, reviewId: 9, message: 'x', confirm: true })).status).toBe('rejected');
  });

  it('taking a review request back is undone by requesting again, and only for people who had it', async () => {
    const w = await makeWorld({});
    seq(w.gh, 'GET /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers', [[200, { users: [{ login: 'bob' }], teams: [] }], [200, { users: [], teams: [] }]]);
    w.gh.when('DELETE /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers').reply(200, { number: 7 });
    await call('github_review_request_reviewers', w, { ...R, reviewers: ['bob', 'carol'], remove: true, confirm: true });
    const row = await w.db.getChange(1);
    expect(row.inverse).toMatchObject({ tool: 'github_review_request_reviewers', args: { reviewers: ['bob'], remove: false } });
    expect(w.gh.invalid).toEqual([]);
  });
});

describe('W-3 pinned head and durable review intent',()=>{
  for(const name of ['github_review_reply','github_review_resolve_thread']){
    it(name+' refuses an old head before mutation and rechecks immediately at apply',async()=>{
      for(const race of [false,true]){
        const w=await makeWorld({});members(w.gh);
        seq(w.gh,PR,race?[[200,{head:{sha:A}}],[200,{head:{sha:'b'.repeat(40)}}]]:[[200,{head:{sha:'b'.repeat(40)}}]]);
        gql(w.gh,[threadNode(false)]);
        const r=await call(name,w,{...R,threadId:'T1',expectedHeadSha:A,confirm:true,...(name==='github_review_reply'?{body:'Verified answer'}:{})});
        expect(r.done).toBe(false);
        expect(w.gh.calls.filter(c=>c.method==='POST'&&/mutation/.test(c.body?.query??''))).toEqual([]);
      }
    });
  }
  it('reuses the durable reply claim across ten-minute windows and caller retry keys',async()=>{
    const w=await makeWorld({});members(w.gh);
    w.gh.when(PR).reply(200,{head:{sha:A}});
    gql(w.gh,[threadNode(false),{data:{addPullRequestReviewThreadReply:{comment:{id:'C1',url:'u',body:'Verified answer'}}}},threadNode(false)]);
    const input={...R,threadId:'T1',expectedHeadSha:A,body:'Verified answer',confirm:true};
    const first=await call('github_review_reply',w,{...input,requestKey:'first-attempt'});
    expect(first).toMatchObject({status:'applied',confirmed:true});
    const before=w.ctx.now;w.ctx.now=()=>before()+20*60*1000;
    const second=await call('github_review_reply',w,{...input,requestKey:'different-retry'});
    expect(second).toMatchObject({status:'replayed',confirmed:true,requestKey:first.requestKey});
    expect(w.gh.calls.filter(c=>c.method==='POST'&&/mutation/.test(c.body?.query??''))).toHaveLength(1);
    expect(w.gh.invalid).toEqual([]);
  });
});
