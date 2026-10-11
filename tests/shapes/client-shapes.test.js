import { describe, expect, it } from 'vitest';
import { githubFor, graphql } from '../../src/github/client.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { makeFakeGitHub } from '../../test/helpers/fake-github.js';

// Real request shapes the server will send (the PR conveyor of Batches E and W), sent through githubFor to the fake
// GitHub, which validates each against the vendored REST description or GraphQL schema. A shape that drifts from
// GitHub's description fails here, not in production.
const CONNECTION = Object.freeze({ client_id: 'c', default_account: 'example-org', accounts: Object.freeze(['example-org']), mode: 'preview', profile: 'full', listing: 'catalog' });

async function client() {
  const gh = makeFakeGitHub();
  const db = createFakeDb();
  await db.initSchema();
  const ctx = {
    connection: CONNECTION, db, fetch: gh.fetch, sleep: async () => {}, retryAfterBaseValue: 1,
    credentials: { token: async () => 'ghs_FAKEinstallationtoken' }
  };
  return { gh, octokit: await githubFor(ctx, {}) };
}

const REST_SHAPES = [
  ['merge a pull request only at an exact head', 'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge',
    { owner: 'example-org', repo: 'hello', pull_number: 12, sha: 'a'.repeat(40), merge_method: 'merge' }, 200, { merged: true, sha: 'b'.repeat(40), message: 'Pull Request successfully merged' }],
  ['open a pull request', 'POST /repos/{owner}/{repo}/pulls',
    { owner: 'example-org', repo: 'hello', title: 'A-4: client', head: 'ai/claude/a-4', base: 'main', body: 'Body', draft: false }, 201, { number: 12 }],
  ['write a file with a commit message', 'PUT /repos/{owner}/{repo}/contents/{path}',
    { owner: 'example-org', repo: 'hello', path: 'docs/a b.md', message: 'Update', content: 'aGVsbG8=', branch: 'ai/claude/a-4' }, 201, { content: {}, commit: {} }],
  ['create a branch', 'POST /repos/{owner}/{repo}/git/refs',
    { owner: 'example-org', repo: 'hello', ref: 'refs/heads/ai/claude/a-4', sha: 'a'.repeat(40) }, 201, { ref: 'refs/heads/ai/claude/a-4' }],
  ['dispatch a workflow', 'POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches',
    { owner: 'example-org', repo: 'hello', workflow_id: 'ci.yml', ref: 'main', inputs: { level: 'quick' } }, 204, null],
  ['list check runs for a commit', 'GET /repos/{owner}/{repo}/commits/{ref}/check-runs',
    { owner: 'example-org', repo: 'hello', ref: 'a'.repeat(40), per_page: 100, filter: 'latest' }, 200, { total_count: 0, check_runs: [] }],
  ['create an issue comment', 'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
    { owner: 'example-org', repo: 'hello', issue_number: 12, body: 'Self-review: ...' }, 201, { id: 1 }],
  ['delete a branch', 'DELETE /repos/{owner}/{repo}/git/refs/{ref}',
    { owner: 'example-org', repo: 'hello', ref: 'heads/ai/claude/a-4' }, 204, null]
];

describe('REST request shapes validate against the vendored description', () => {
  for (const [name, route, params, status, body] of REST_SHAPES) {
    it(name, async () => {
      const { gh, octokit } = await client();
      gh.when(route).reply(status, body);
      const res = await octokit.request(route, params);
      expect(res.status).toBe(status);
      expect(gh.invalid).toEqual([]);
      expect(gh.calls[0].route).toBe(route);
    });
  }

  it('catches a shape that does not match (misspelled merge method field) so it cannot reach production', async () => {
    const { gh, octokit } = await client();
    gh.when('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge').reply(200, {});
    await expect(octokit.request('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge', { owner: 'example-org', repo: 'hello', pull_number: 12, mergeMethod: 'merge' })).rejects.toMatchObject({ status: 422 });
    expect(gh.invalid[0].invalid.join(' ')).toContain('mergeMethod');
  });
});

describe('GraphQL documents validate against the vendored schema', () => {
  const DOCS = [
    ['resolve a review thread', 'mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { isResolved } } }', { id: 'T_x' }],
    ['read review threads of a pull request', 'query($o: String!, $r: String!, $n: Int!) { repository(owner: $o, name: $r) { pullRequest(number: $n) { reviewThreads(first: 50) { nodes { id isResolved isOutdated comments(first: 5) { nodes { body author { login } } } } } } } }', { o: 'example-org', r: 'hello', n: 12 }],
    ['enable auto-merge', 'mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: MERGE }) { clientMutationId } }', { id: 'PR_x' }]
  ];
  for (const [name, query, variables] of DOCS) {
    it(name, async () => {
      const { gh, octokit } = await client();
      gh.when('POST /graphql').reply(200, { data: {} });
      await graphql(octokit, query, variables);
      expect(gh.invalid).toEqual([]);
      expect(gh.graphql).toHaveLength(1);
    });
  }

  it('catches a field that is not in the schema', async () => {
    const { gh, octokit } = await client();
    gh.when('POST /graphql').reply(200, { data: {} });
    await graphql(octokit, 'query { viewer { loginName } }').catch(() => {});
    expect(gh.invalid[0].invalid.join(' ')).toContain('loginName');
  });
});
