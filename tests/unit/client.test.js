import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GITHUB_API_VERSION, githubFor, graphql, listAll, requestKey } from '../../src/github/client.js';
import { GithubClientError, formatDenver } from '../../src/github/errors.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { makeFakeGitHub } from '../../test/helpers/fake-github.js';

const CONNECTION = Object.freeze({
  client_id: 'client-1', default_account: 'example-org', accounts: Object.freeze(['example-org', 'example-user']),
  mode: 'preview', profile: 'everyday', listing: 'catalog'
});

async function setup({ connection = CONNECTION, budgetMs, clock = { t: Date.UTC(2026, 9, 10, 12, 0, 0) } } = {}) {
  const gh = makeFakeGitHub();
  const db = createFakeDb({ clock: () => clock.t });
  await db.initSchema();
  const sleeps = [];
  const asked = [];
  const ctx = {
    connection, db, fetch: gh.fetch, now: () => clock.t, budgetMs, retryAfterBaseValue: 1,
    sleep: async (ms) => { sleeps.push(ms); },
    credentials: { token: async (request) => { asked.push(request); return 'ghs_FAKEinstallationtoken'; } }
  };
  return { gh, db, ctx, sleeps, asked, clock };
}

describe('GitHub client: the pinned API version and credentials', () => {
  it('sends the pinned API version, a user agent and the token on reads, writes and GraphQL', async () => {
    const { gh, ctx } = await setup();
    gh.when('GET /repos/{owner}/{repo}').reply(200, { id: 1 });
    gh.when('POST /repos/{owner}/{repo}/issues').reply(201, { number: 3 });
    gh.when('POST /graphql').reply(200, { data: { viewer: { login: 'example-org' } } });
    const octokit = await githubFor(ctx, { owner: 'example-org' });
    await octokit.request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' });
    await octokit.request('POST /repos/{owner}/{repo}/issues', { owner: 'example-org', repo: 'hello', title: 'A title' });
    await graphql(octokit, 'query { viewer { login } }');
    expect(GITHUB_API_VERSION).toBe('2026-03-10');
    expect(gh.calls).toHaveLength(3);
    for (const call of gh.calls) {
      expect(call.headers['x-github-api-version']).toBe('2026-03-10');
      expect(call.headers['user-agent']).toMatch(/^robinson-github-mcp/);
      expect(call.headers.authorization).toBe('token ghs_FAKEinstallationtoken');
    }
    expect(gh.invalid).toEqual([]);
  });

  it('asks the credential source for the right account, kind and scope, with the account in its stored spelling', async () => {
    const { ctx, asked } = await setup();
    await githubFor(ctx, { owner: 'EXAMPLE-USER', cred: 'U', scope: { repositories: ['hello'] } });
    await githubFor(ctx, {});
    expect(asked).toEqual([
      { account: 'example-user', cred: 'U', scope: { repositories: ['hello'] }, profile: 'everyday' },
      { account: 'example-org', cred: 'I', scope: undefined, profile: 'everyday' }
    ]);
  });

  it('refuses an account outside the connection, a missing credential and an unknown credential kind', async () => {
    const { ctx } = await setup();
    await expect(githubFor(ctx, { owner: 'someone-else' })).rejects.toMatchObject({ name: 'GithubClientError', code: 'outside_scope' });
    await expect(githubFor({ ...ctx, credentials: { token: async () => '' } }, {})).rejects.toMatchObject({ code: 'no_credentials' });
    await expect(githubFor({ ...ctx, credentials: undefined }, {})).rejects.toMatchObject({ code: 'no_credentials' });
    await expect(githubFor(ctx, { cred: 'X' })).rejects.toThrow(TypeError);
  });

  it('encodes spaces, # and % in path parameters (audit G8)', async () => {
    const { gh, ctx } = await setup();
    gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, (req) => ({ got: req.params.path }));
    const octokit = await githubFor(ctx, {});
    const res = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', { owner: 'example-org', repo: 'hello', path: 'docs/a b#c%d.md' });
    expect(gh.calls[0].path).toBe('/repos/example-org/hello/contents/docs%2Fa%20b%23c%25d.md');
    expect(res.data.got).toBe('docs/a b#c%d.md');
    gh.when('GET /repos/{owner}/{repo}/branches/{branch}').reply(200, (req) => ({ got: req.params.branch }));
    await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', { owner: 'example-org', repo: 'hello', branch: 'feature/x y#1%' });
    expect(gh.calls[1].path).toBe('/repos/example-org/hello/branches/feature%2Fx%20y%231%25');
    expect(gh.calls[1].params.branch).toBe('feature/x y#1%');
  });

  it('only files under src/github import @octokit/*', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full); continue; }
        if (!/\.(m?js|cjs)$/.test(entry.name)) continue;
        if (/from\s+['"](?:@octokit\/|octokit['"])|import\(\s*['"]@octokit|require\(\s*['"]@octokit/.test(fs.readFileSync(full, 'utf8'))) offenders.push(path.relative('.', full));
      }
    };
    for (const dir of ['src', 'api']) walk(dir);
    expect(offenders.every((f) => f.startsWith(`src${path.sep}github${path.sep}`))).toBe(true);
    expect(offenders).toContain(path.join('src', 'github', 'client.js'));
    expect(offenders.filter((f) => !f.endsWith(path.join('github', 'client.js')))).toEqual([]);
  });
});

describe('request keys (A8)', () => {
  const ctx = { connection: CONNECTION, now: () => Date.UTC(2026, 9, 10, 12, 3, 0) };
  const args = { owner: 'example-org', repo: 'hello', title: 'A title', labels: ['b', 'a'] };

  it('is stable for the same arguments whatever their order, and shaped rmcp_<tool>_<sha256>_<bucket>', () => {
    const key = requestKey(ctx, 'github_issue_create', args);
    expect(key).toMatch(/^rmcp_github_issue_create_[0-9a-f]{64}_\d+$/);
    expect(requestKey(ctx, 'github_issue_create', { labels: ['b', 'a'], title: 'A title', repo: 'hello', owner: 'example-org' })).toBe(key);
    expect(requestKey(ctx, 'github_issue_create', { ...args, owner: 'EXAMPLE-ORG' })).toBe(key);
  });

  it('ignores dryRun, confirm, fields and detail but not real arguments, tool or account', () => {
    const key = requestKey(ctx, 'github_issue_create', args);
    expect(requestKey(ctx, 'github_issue_create', { ...args, dryRun: true, confirm: true, fields: ['number'], detail: 'full' })).toBe(key);
    expect(requestKey(ctx, 'github_issue_create', { ...args, title: 'Another' })).not.toBe(key);
    expect(requestKey(ctx, 'github_issue_update', args)).not.toBe(key);
    expect(requestKey(ctx, 'github_issue_create', { ...args, owner: 'example-user' })).not.toBe(key);
  });

  it("uses the caller's requestKey instead of the arguments, and changes with it", () => {
    const one = requestKey(ctx, 'github_issue_create', { ...args, requestKey: 'my-retry-1' });
    expect(requestKey(ctx, 'github_issue_create', { ...args, title: 'Reworded', requestKey: 'my-retry-1' })).toBe(one);
    expect(requestKey(ctx, 'github_issue_create', { ...args, requestKey: 'my-retry-2' })).not.toBe(one);
    expect(one).not.toBe(requestKey(ctx, 'github_issue_create', args));
  });

  it('changes with the ten-minute bucket', () => {
    const later = { ...ctx, now: () => Date.UTC(2026, 9, 10, 12, 11, 0) };
    expect(requestKey(later, 'github_issue_create', args)).not.toBe(requestKey(ctx, 'github_issue_create', args));
    expect(requestKey({ ...ctx, now: () => Date.UTC(2026, 9, 10, 12, 9, 59) }, 'github_issue_create', args)).toBe(requestKey(ctx, 'github_issue_create', args));
  });
});

describe('listAll', () => {
  const page = (n, from, count) => ({
    status: 200, body: Array.from({ length: count }, (_x, i) => ({ id: from + i })),
    headers: n < 3 ? { link: `<https://api.github.com/repos/example-org/hello/issues?per_page=100&page=${n + 1}>; rel="next"` } : {}
  });

  it('follows Link headers to the last page', async () => {
    const { gh, ctx } = await setup();
    gh.when('GET /repos/{owner}/{repo}/issues').replySequence([page(1, 0, 100), page(2, 100, 100), page(3, 200, 7)]);
    const octokit = await githubFor(ctx, {});
    const { items, capped } = await listAll(octokit, 'GET /repos/{owner}/{repo}/issues', { owner: 'example-org', repo: 'hello' });
    expect(items).toHaveLength(207);
    expect(capped).toBe(false);
    expect(gh.calls[0].query.per_page).toBe('100');
  });

  it('stops at the cap and says so', async () => {
    const { gh, ctx } = await setup();
    gh.when('GET /repos/{owner}/{repo}/issues').replySequence([page(1, 0, 100), page(2, 100, 100), page(3, 200, 7)]);
    const octokit = await githubFor(ctx, {});
    const { items, capped } = await listAll(octokit, 'GET /repos/{owner}/{repo}/issues', { owner: 'example-org', repo: 'hello' }, { max: 150 });
    expect(items).toHaveLength(150);
    expect(items.at(-1)).toEqual({ id: 149 });
    expect(capped).toBe(true);
    expect(gh.calls).toHaveLength(2);
  });

  it('bounds a misbehaving server that repeatedly links empty pages',async()=>{
    const {gh,ctx}=await setup();
    gh.when('GET /repos/{owner}/{repo}/issues').reply(200,[],
      {link:'<https://api.github.com/repos/example-org/hello/issues?per_page=100&page=2>; rel="next"'});
    const octokit=await githubFor(ctx,{});
    const out=await listAll(octokit,'GET /repos/{owner}/{repo}/issues',
      {owner:'example-org',repo:'hello'},{max:100});
    expect(out).toEqual({items:[],capped:true});
    expect(gh.calls).toHaveLength(2);
    expect(gh.invalid).toEqual([]);
  });
  it('does not mistake slowly advancing linked pages for a complete inventory',async()=>{
    const {gh,ctx}=await setup();
    gh.when('GET /repos/{owner}/{repo}/issues').reply(200,[{id:1}],
      {link:'<https://api.github.com/repos/example-org/hello/issues?per_page=100&page=2>; rel="next"'});
    const out=await listAll(await githubFor(ctx,{}),'GET /repos/{owner}/{repo}/issues',
      {owner:'example-org',repo:'hello'},{max:100});
    expect(out.capped).toBe(true);
    expect(out.items).toHaveLength(2);
    expect(gh.calls).toHaveLength(2);
  });
  it('rejects an invalid pagination cap without contacting GitHub',async()=>{
    const {gh,ctx}=await setup();
    const o=await githubFor(ctx,{});
    await expect(listAll(o,'GET /repos/{owner}/{repo}/issues',
      {owner:'example-org',repo:'hello'},{max:0})).rejects.toThrow(/Pagination cap/);
    await expect(listAll(o,'GET /repos/{owner}/{repo}/issues',
      {owner:'example-org',repo:'hello'},{max:10_001})).rejects.toThrow(/Pagination cap/);
    expect(gh.calls).toHaveLength(0);
  });

  it('is not capped when the list ends exactly at the cap', async () => {
    const { gh, ctx } = await setup();
    gh.when('GET /repos/{owner}/{repo}/issues').replySequence([{ status: 200, body: Array.from({ length: 100 }, (_x, i) => ({ id: i })) }]);
    const octokit = await githubFor(ctx, {});
    const { items, capped } = await listAll(octokit, 'GET /repos/{owner}/{repo}/issues', { owner: 'example-org', repo: 'hello' }, { max: 100 });
    expect([items.length, capped]).toEqual([100, false]);
  });
});

describe('rate discipline (A9)', () => {
  const secondary = (retryAfter) => ({
    status: 403, body: { message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' },
    headers: { 'retry-after': String(retryAfter) }
  });

  it('honours retry-after when it fits in the time budget, then succeeds', async () => {
    const { gh, ctx } = await setup({ budgetMs: 20_000 });
    gh.when('GET /repos/{owner}/{repo}').replySequence([secondary(1), { status: 200, body: { id: 1 } }]);
    const octokit = await githubFor(ctx, {});
    const res = await octokit.request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' });
    expect(res.data).toEqual({ id: 1 });
    expect(gh.calls).toHaveLength(2);
  });

  it('answers rate_limited with the reset time in UTC (the default zone) when the wait is longer than the budget', async () => {
    const { gh, ctx, db, clock } = await setup({ budgetMs: 20_000 });
    gh.when('GET /repos/{owner}/{repo}').replySequence([secondary(90)]);
    const octokit = await githubFor(ctx, {});
    const error = await octokit.request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' }).catch((e) => e);
    expect(error).toBeInstanceOf(GithubClientError);
    expect(error.code).toBe('rate_limited');
    const until = new Date(clock.t + 90_000);
    expect(error.details).toMatchObject({ reason: 'github_limit', resource: 'core', reset_at: until.toISOString(), reset_display: formatDenver(until) });
    expect(error.message).toContain('Oct 10, 2026, 12:01 PM UTC');
    expect(gh.calls).toHaveLength(1); // no retry: 90 s does not fit in 20 s
    // The next request refuses without calling GitHub.
    const again = await (await githubFor(ctx, {})).request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' }).catch((e) => e);
    expect(again.code).toBe('rate_limited');
    expect(gh.calls).toHaveLength(1);
    expect((await db.getRateState('example-org', 'core')).blocked_until).not.toBeNull();
    clock.t += 91_000; // once the time has passed, GitHub is called again
    gh.when('GET /repos/{owner}/{repo}').reply(200, { id: 1 });
    expect((await (await githubFor(ctx, {})).request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' })).status).toBe(200);
  });

  it('records a primary-limit block from the headers and refuses until the reset', async () => {
    const { gh, ctx, clock } = await setup();
    const reset = Math.floor(clock.t / 1000) + 600;
    gh.when('GET /repos/{owner}/{repo}').replySequence([{ status: 200, body: {}, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset), 'x-ratelimit-resource': 'core' } }]);
    await (await githubFor(ctx, {})).request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' });
    const blocked = await (await githubFor(ctx, {})).request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' }).catch((e) => e);
    expect(blocked.code).toBe('rate_limited');
    expect(blocked.details.reset_at).toBe(new Date(reset * 1000 + 1000).toISOString());
    expect(gh.calls).toHaveLength(1);
  });

  it('keeps separate limits per account and per resource (a blocked search does not block core)', async () => {
    const { gh, ctx, db } = await setup();
    await db.recordRateState({ account: 'example-org', resource: 'search', remaining: 0, resetAt: new Date(ctx.now() + 60_000), blockedUntil: new Date(ctx.now() + 60_000) });
    gh.when('GET /repos/{owner}/{repo}').reply(200, {});
    gh.when('GET /search/issues').reply(200, { total_count: 0, items: [] });
    const octokit = await githubFor(ctx, {});
    await octokit.request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' });
    await expect(octokit.request('GET /search/issues', { q: 'is:open' })).rejects.toMatchObject({ code: 'rate_limited' });
    const other = await githubFor(ctx, { owner: 'example-user' });
    expect((await other.request('GET /search/issues', { q: 'is:open' })).status).toBe(200);
  });

  it('spaces writes one second apart per installation and never spaces reads', async () => {
    const { gh, ctx, sleeps } = await setup();
    gh.when('POST /repos/{owner}/{repo}/issues').reply(201, { number: 1 });
    gh.when('GET /repos/{owner}/{repo}').reply(200, {});
    const octokit = await githubFor(ctx, {});
    for (let i = 0; i < 3; i++) await octokit.request('POST /repos/{owner}/{repo}/issues', { owner: 'example-org', repo: 'hello', title: `t${i}` });
    await octokit.request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' });
    expect(sleeps).toEqual([1000, 2000]); // first write immediate; the fixed test clock never advances, so the queue grows
  });

  it('refuses a write when the queue for that installation is already too long', async () => {
    const { gh, ctx } = await setup();
    gh.when('POST /repos/{owner}/{repo}/issues').reply(201, { number: 1 });
    const octokit = await githubFor(ctx, {});
    let refused = null;
    for (let i = 0; i < 10 && !refused; i++) {
      refused = await octokit.request('POST /repos/{owner}/{repo}/issues', { owner: 'example-org', repo: 'hello', title: `t${i}` }).then(() => null, (e) => e);
    }
    expect(refused).toMatchObject({ code: 'rate_limited', details: { reason: 'write_queue_busy' } });
    expect(gh.calls.length).toBe(6); // slots at +0..+5 s fit in the 5 s maximum wait; the 7th claim is refused
  });

  it('never replays a write after a server error, but retries a read', async () => {
    const { gh, ctx } = await setup();
    gh.when('POST /repos/{owner}/{repo}/issues').reply(502, { message: 'Bad gateway' });
    gh.when('GET /repos/{owner}/{repo}').replySequence([{ status: 502, body: {} }, { status: 200, body: { id: 1 } }]);
    const octokit = await githubFor(ctx, {});
    await expect(octokit.request('POST /repos/{owner}/{repo}/issues', { owner: 'example-org', repo: 'hello', title: 'x' })).rejects.toMatchObject({ status: 502 });
    expect(gh.calls).toHaveLength(1);
    const res = await octokit.request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' });
    expect(res.data).toEqual({ id: 1 });
    expect(gh.calls).toHaveLength(3);
  });

  it('treats a GraphQL mutation as a write (spaced, never replayed) and a query as a read', async () => {
    const { gh, ctx, sleeps } = await setup();
    gh.when('POST /graphql').reply(502, { message: 'Bad gateway' });
    const octokit = await githubFor(ctx, {});
    await graphql(octokit, 'query { viewer { login } }').catch(() => {});
    const readCalls = gh.calls.length;
    expect(readCalls).toBe(3); // retried twice like any read
    expect(sleeps).toEqual([]);
    await graphql(octokit, 'mutation($i: AddStarInput!) { addStar(input: $i) { clientMutationId } }', { i: { starrableId: 'X' } }).catch(() => {});
    expect(gh.calls.length - readCalls).toBe(1);
    expect(gh.invalid).toEqual([]);
  });

  it('does not turn an ordinary permission error (403) into rate_limited', async () => {
    const { gh, ctx } = await setup();
    gh.when('GET /repos/{owner}/{repo}').reply(403, { message: 'Resource not accessible by integration' });
    const error = await (await githubFor(ctx, {})).request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' }).catch((e) => e);
    expect(error.status).toBe(403);
    expect(error.code).toBeUndefined();
  });
});

describe('ETag cache (A9)', () => {
  it('sends If-None-Match from the cache and returns the cached body on 304', async () => {
    const { gh, ctx } = await setup();
    gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').replySequence([
      { status: 200, body: { number: 7, state: 'open' }, headers: { etag: 'W/"abc"' } },
      { status: 304, headers: { etag: 'W/"abc"' } }
    ]);
    const get = async () => (await githubFor(ctx, {})).request('GET /repos/{owner}/{repo}/pulls/{pull_number}',
      { owner: 'example-org', repo: 'hello', pull_number: 7, request: { etag: true } });
    const first = await get();
    expect(first.data).toEqual({ number: 7, state: 'open' });
    expect(gh.calls[0].headers['if-none-match']).toBeUndefined();
    const second = await get();
    expect(gh.calls[1].headers['if-none-match']).toBe('W/"abc"');
    expect(second).toMatchObject({ status: 200, notModified: true, data: { number: 7, state: 'open' } });
  });

  it('does not cache unless asked, and a changed resource replaces the cached body', async () => {
    const { gh, ctx, db } = await setup();
    gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').replySequence([
      { status: 200, body: { v: 1 }, headers: { etag: 'W/"1"' } }, { status: 200, body: { v: 2 }, headers: { etag: 'W/"2"' } }
    ]);
    const octokit = await githubFor(ctx, {});
    await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', { owner: 'example-org', repo: 'hello', pull_number: 7 });
    expect(await db.getEtag('example-org', '/repos/example-org/hello/pulls/7')).toBeNull();
    await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', { owner: 'example-org', repo: 'hello', pull_number: 7, request: { etag: true } });
    expect((await db.getEtag('example-org', '/repos/example-org/hello/pulls/7')).body).toEqual({ v: 2 });
  });
});

describe('credentials never leak into errors', () => {
  it('error messages and details contain no token', async () => {
    const { gh, ctx } = await setup();
    gh.when('GET /repos/{owner}/{repo}').replySequence([{ status: 403, body: { message: 'secondary rate limit' }, headers: { 'retry-after': '600' } }]);
    const error = await (await githubFor(ctx, {})).request('GET /repos/{owner}/{repo}', { owner: 'example-org', repo: 'hello' }).catch((e) => e);
    expect(JSON.stringify({ m: error.message, d: error.details })).not.toContain('FAKEinstallationtoken');
  });
});
