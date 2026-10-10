import { describe, expect, it } from 'vitest';
import { Octokit } from '@octokit/core';
import { makeFakeGitHub } from '../../test/helpers/fake-github.js';

const GITHUB_API_VERSION = '2026-03-10'; // A-4 moves this into src/github/client.js
const repoFixture = { id: 1, name: 'hello', full_name: 'octo/hello', private: false, default_branch: 'main' };

describe('request shapes: Octokit through the fake GitHub', () => {
  it('sends GET /repos/{owner}/{repo} with the pinned API version and receives the fixture', async () => {
    const gh = makeFakeGitHub();
    gh.when('GET /repos/{owner}/{repo}').reply(200, repoFixture);
    const octokit = new Octokit({ auth: 'ghs_FAKEinstallation', request: { fetch: gh.fetch } });
    const res = await octokit.request('GET /repos/{owner}/{repo}', {
      owner: 'octo', repo: 'hello', headers: { 'X-GitHub-Api-Version': GITHUB_API_VERSION }
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual(repoFixture);
    expect(gh.unmatched).toEqual([]);
    expect(gh.calls).toHaveLength(1);
    const [call] = gh.calls;
    expect(call.route).toBe('GET /repos/{owner}/{repo}');
    expect(call.params).toEqual({ owner: 'octo', repo: 'hello' });
    expect(call.headers['x-github-api-version']).toBe('2026-03-10');
    expect(call.headers.authorization).toBe('token ghs_FAKEinstallation');
  });

  it('lets Octokit encode a file path and surfaces an unknown route as a 404 error', async () => {
    const gh = makeFakeGitHub();
    gh.when('GET /repos/{owner}/{repo}/contents/{path}').reply(200, (req) => ({ path: req.params.path }));
    const octokit = new Octokit({ request: { fetch: gh.fetch } });
    const res = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', { owner: 'octo', repo: 'hello', path: 'a b.md' });
    expect(gh.calls[0].path).toBe('/repos/octo/hello/contents/a%20b.md');
    expect(res.data).toEqual({ path: 'a b.md' });
    await expect(octokit.request('GET /orgs/{org}/teams', { org: 'octo' })).rejects.toMatchObject({ status: 404 });
    expect(gh.unmatched.map((c) => c.path)).toEqual(['/orgs/octo/teams']);
  });
});
