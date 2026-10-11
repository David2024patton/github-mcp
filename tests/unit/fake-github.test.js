import { describe, expect, it } from 'vitest';
import { makeFakeGitHub } from '../../test/helpers/fake-github.js';

const API = 'https://api.github.com';
const send = (gh, method, path, { body, headers = {} } = {}) => gh.fetch(`${API}${path}`, {
  method, headers, body: body === undefined ? undefined : JSON.stringify(body)
});

describe('fake GitHub', () => {
  it('matches a route template and extracts path parameters', async () => {
    const gh = makeFakeGitHub();
    gh.when('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge').reply(200, { merged: true, sha: 'abc' });
    const res = await send(gh, 'PUT', '/repos/octo/hello/pulls/7/merge', { body: { sha: 'abc', merge_method: 'merge' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ merged: true, sha: 'abc' });
    expect(gh.calls).toHaveLength(1);
    expect(gh.calls[0]).toMatchObject({
      method: 'PUT',
      route: 'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge',
      path: '/repos/octo/hello/pulls/7/merge',
      params: { owner: 'octo', repo: 'hello', pull_number: '7' }
    });
  });

  it('decodes an encoded file path that spans segments', async () => {
    const gh = makeFakeGitHub();
    gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, { type: 'file' });
    await send(gh, 'GET', '/repos/octo/hello/contents/docs/a%20b.md?ref=main');
    expect(gh.calls[0].route).toBe('GET /repos/{owner}/{repo}/contents/{path}');
    expect(gh.calls[0].params.path).toBe('docs/a b.md');
    expect(gh.calls[0].query).toEqual({ ref: 'main' });
  });

  it('records the parsed body and lower-cased headers', async () => {
    const gh = makeFakeGitHub();
    gh.when('POST /repos/{owner}/{repo}/pulls').reply(201, { number: 1 });
    await send(gh, 'POST', '/repos/octo/hello/pulls', {
      body: { title: 'T', head: 'ai/x', base: 'main' },
      headers: { 'X-GitHub-Api-Version': '2026-03-10', Authorization: 'token ghs_FAKEtoken' }
    });
    expect(gh.calls[0].body).toEqual({ title: 'T', head: 'ai/x', base: 'main' });
    expect(gh.calls[0].headers['x-github-api-version']).toBe('2026-03-10');
  });

  it('builds a reply from the request when given a function', async () => {
    const gh = makeFakeGitHub();
    gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, (req) => ({ number: Number(req.params.pull_number) }));
    expect(await (await send(gh, 'GET', '/repos/octo/hello/pulls/42')).json()).toEqual({ number: 42 });
  });

  it('answers 404 for an unknown route and records it as unmatched', async () => {
    const gh = makeFakeGitHub();
    const res = await send(gh, 'GET', '/repos/octo/hello/not-a-real-endpoint');
    expect(res.status).toBe(404);
    expect(gh.unmatched).toHaveLength(1);
    expect(gh.calls[0]).toMatchObject({ unmatched: true, route: null, method: 'GET', path: '/repos/octo/hello/not-a-real-endpoint' });
  });

  it('refuses to configure a route it does not know', () => {
    expect(() => makeFakeGitHub().when('GET /repos/{owner}/{repo}/nonsense')).toThrow(/does not know route/);
  });

  it('answers 501 for a known route with no configured reply instead of inventing data', async () => {
    const gh = makeFakeGitHub();
    expect((await send(gh, 'GET', '/user')).status).toBe(501);
    expect(gh.calls[0].route).toBe('GET /user');
  });

  it('records GraphQL documents and variables', async () => {
    const gh = makeFakeGitHub();
    gh.when('POST /graphql').reply(200, { data: { viewer: { login: 'octo' } } });
    await send(gh, 'POST', '/graphql', { body: { query: 'query($n:Int!){ repository(owner: "o", name: "r") { issues(first: $n) { totalCount } } }', variables: { n: 1 } } });
    expect(gh.graphql).toEqual([{ query: 'query($n:Int!){ repository(owner: "o", name: "r") { issues(first: $n) { totalCount } } }', variables: { n: 1 } }]);
  });

  it('accepts extra route templates (A-4 passes the vendored list)', async () => {
    const gh = makeFakeGitHub({ routes: ['DELETE /repos/{owner}/{repo}/git/refs/{ref}'] });
    gh.when('DELETE /repos/{owner}/{repo}/git/refs/{ref}').reply(204);
    expect((await send(gh, 'DELETE', '/repos/octo/hello/git/refs/heads%2Fai%2Fx')).status).toBe(204);
    expect(gh.calls[0].params.ref).toBe('heads/ai/x');
  });

  it('knows every operation of the vendored description, most specific route first', async () => {
    const gh = makeFakeGitHub();
    expect(gh.routes.length).toBeGreaterThan(1200);
    gh.when('GET /repos/{owner}/{repo}/pulls/comments').reply(200, []);
    gh.when('GET /repos/{owner}/{repo}/pulls/{pull_number}').reply(200, { number: 5 });
    expect((await send(gh, 'GET', '/repos/octo/hello/pulls/comments')).status).toBe(200);
    expect(gh.calls[0].route).toBe('GET /repos/{owner}/{repo}/pulls/comments');
    await send(gh, 'GET', '/repos/octo/hello/pulls/5');
    expect(gh.calls[1].route).toBe('GET /repos/{owner}/{repo}/pulls/{pull_number}');
    expect(gh.invalid).toEqual([]);
  });

  it('rejects a request body that does not match the operation (wrong value, unknown field, missing field)', async () => {
    const gh = makeFakeGitHub();
    gh.when('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge').reply(200, { merged: true });
    gh.when('POST /repos/{owner}/{repo}/pulls').reply(201, { number: 1 });
    const bad = await send(gh, 'PUT', '/repos/octo/hello/pulls/7/merge', { body: { sha: 'abc', merge_method: 'zip' } });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(await bad.json())).toContain('merge_method');
    const noTitle = await send(gh, 'POST', '/repos/octo/hello/pulls', { body: { head: 'a', base: 'main', bypass_rules: true } });
    expect(noTitle.status).toBe(422);
    expect(gh.invalid).toHaveLength(2);
    expect(gh.invalid[0].invalid.join(' ')).toMatch(/merge_method/);
    expect(gh.invalid[1].invalid.join(' ')).toMatch(/bypass_rules/);
  });

  it('rejects an unknown query parameter and accepts a valid one', async () => {
    const gh = makeFakeGitHub();
    gh.when('GET /repos/{owner}/{repo}/pulls').reply(200, []);
    expect((await send(gh, 'GET', '/repos/octo/hello/pulls?state=open&per_page=100')).status).toBe(200);
    const bad = await send(gh, 'GET', '/repos/octo/hello/pulls?stat=open');
    expect(bad.status).toBe(422);
    expect(gh.invalid).toHaveLength(1);
  });

  it('validates GraphQL against the vendored schema and answers with GraphQL errors', async () => {
    const gh = makeFakeGitHub();
    gh.when('POST /graphql').reply(200, { data: { viewer: { login: 'octo' } } });
    const ok = await (await send(gh, 'POST', '/graphql', { body: { query: 'query { viewer { login } }' } })).json();
    expect(ok.data.viewer.login).toBe('octo');
    const bad = await (await send(gh, 'POST', '/graphql', { body: { query: 'query { viewer { nope } }' } })).json();
    expect(bad.errors[0].message).toMatch(/nope/);
    expect(gh.invalid).toHaveLength(1);
  });

  it('can be built without validation for tests that only need routing', async () => {
    const gh = makeFakeGitHub({ validate: false });
    gh.when('GET /repos/{owner}/{repo}').reply(200, {});
    expect(gh.routes.length).toBeLessThan(20);
    expect((await send(gh, 'GET', '/repos/octo/hello?whatever=1')).status).toBe(200);
  });

  it('validates nested body schemas through their references and does not coerce types in JSON bodies', async () => {
    const gh = makeFakeGitHub();
    gh.when('POST /app/installations/{installation_id}/access_tokens').reply(201, { token: 'ghs_FAKE' });
    const wrong = await send(gh, 'POST', '/app/installations/7/access_tokens', { body: { permissions: { contents: 'admin-ish' } } });
    expect(wrong.status).toBe(422);
    expect(gh.invalid[0].invalid.join(' ')).toMatch(/contents/);
    const number = await send(gh, 'POST', '/app/installations/7/access_tokens', { body: { repositories: [5] } });
    expect(number.status).toBe(422);
    const ok = await send(gh, 'POST', '/app/installations/7/access_tokens', { body: { repositories: ['hello'], permissions: { contents: 'read' } } });
    expect(ok.status).toBe(201);
  });
});
