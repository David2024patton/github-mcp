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
    const res = await send(gh, 'DELETE', '/repos/octo/hello');
    expect(res.status).toBe(404);
    expect(gh.unmatched).toHaveLength(1);
    expect(gh.calls[0]).toMatchObject({ unmatched: true, route: null, method: 'DELETE', path: '/repos/octo/hello' });
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
    await send(gh, 'POST', '/graphql', { body: { query: 'query($n:Int!){ viewer { login } }', variables: { n: 1 } } });
    expect(gh.graphql).toEqual([{ query: 'query($n:Int!){ viewer { login } }', variables: { n: 1 } }]);
  });

  it('accepts extra route templates (A-4 passes the vendored list)', async () => {
    const gh = makeFakeGitHub({ routes: ['DELETE /repos/{owner}/{repo}/git/refs/{ref}'] });
    gh.when('DELETE /repos/{owner}/{repo}/git/refs/{ref}').reply(204);
    expect((await send(gh, 'DELETE', '/repos/octo/hello/git/refs/heads%2Fai%2Fx')).status).toBe(204);
    expect(gh.calls[0].params.ref).toBe('heads/ai/x');
  });
});
