import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { GITHUB_API_VERSION } from '../../src/github/client.js';
import { OPENAPI_FILE, GRAPHQL_FILE, openApi, operations } from '../../test/helpers/github-descriptions.js';
import { findOperations, describeOperation } from '../../scripts/openapi-find.mjs';
import { findGraphql, loadSchema } from '../../scripts/graphql-find.mjs';

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceOf = (dir) => fs.readFileSync(`vendor/${dir}/SOURCE.md`, 'utf8');

describe('vendored GitHub descriptions', () => {
  it('match the sha256 and size recorded in their SOURCE.md files', () => {
    expect(sourceOf('github-openapi')).toContain(sha256(OPENAPI_FILE));
    expect(sourceOf('github-graphql')).toContain(sha256(GRAPHQL_FILE));
    expect(sourceOf('github-openapi')).toContain(String(fs.statSync(OPENAPI_FILE).size).replace(/(\d)(?=(\d{3})+$)/g, '$1,'));
    for (const dir of ['github-openapi', 'github-graphql']) {
      expect(sourceOf(dir)).toMatch(/Commit \| `[0-9a-f]{40}`/);
      expect(sourceOf(dir)).toMatch(/Fetched \| 2026-10-10/);
    }
  });

  it('the REST description is for the API version the client pins', () => {
    expect(OPENAPI_FILE).toContain(`api.github.com.${GITHUB_API_VERSION}.json`);
    expect(sourceOf('github-openapi')).toContain(`\`${GITHUB_API_VERSION}\``);
    expect(openApi().openapi).toMatch(/^3\.0/);
    expect(operations()).toHaveLength(1232);
  });

  it('every operation is keyed by a unique "METHOD /path" route with a summary and a category', () => {
    const routes = new Set(operations().map((o) => o.route));
    expect(routes.size).toBe(1232);
    expect(operations().filter((o) => !o.summary || !o.category)).toEqual([]);
  });
});

describe('finder scripts', () => {
  it('openapi-find lists at most 20 matching operations with method, path, summary, category and notification flag', () => {
    const merge = findOperations(['merge', 'pull']);
    expect(merge.map((o) => o.route)).toContain('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge');
    const out = execFileSync('node', ['scripts/openapi-find.mjs', 'repos'], { encoding: 'utf8' }).trim().split('\n');
    expect(out.length).toBeLessThanOrEqual(21);
    expect(out[0]).toMatch(/^(GET|PUT|POST|PATCH|DELETE) +\/.* — .* \[[a-z-]+\]/);
    expect(execFileSync('node', ['scripts/openapi-find.mjs', 'merge', 'a', 'pull', 'request'], { encoding: 'utf8' })).toMatch(/PUT +\/repos.*Merge a pull request.* triggersNotification\n/);
    expect(out.at(-1)).toMatch(/more; add words to narrow/);
  });

  it('openapi-find --show prints the parameters, body fields and responses of one operation', () => {
    const text = execFileSync('node', ['scripts/openapi-find.mjs', '--show', 'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge'], { encoding: 'utf8' });
    expect(text).toContain('path: owner*, repo*, pull_number*');
    expect(text).toContain('body: commit_title, commit_message, sha, merge_method');
    expect(text).toContain('triggersNotification: true');
    expect(describeOperation(operations()[0])).toContain(operations()[0].route);
  });

  it('openapi-find exits non-zero with a clear message when nothing matches', () => {
    const run = (args) => { try { return { out: execFileSync('node', ['scripts/openapi-find.mjs', ...args], { encoding: 'utf8', stdio: 'pipe' }), code: 0 }; } catch (e) { return { out: e.stdout + e.stderr, code: e.status }; } };
    expect(run(['zzzzqqqq'])).toEqual({ out: 'No match.\n', code: 1 });
    expect(run(['--show', 'GET /nope']).code).toBe(1);
  });

  it('graphql-find finds mutations with their arguments and prints a type by exact name', () => {
    const schema = loadSchema();
    const { fields } = findGraphql('mergePullRequest', schema);
    expect(fields).toContain('mutation mergePullRequest(input: MergePullRequestInput!): MergePullRequestPayload');
    const { type } = findGraphql('MergePullRequestInput', schema);
    expect(type[0]).toBe('InputObjectType MergePullRequestInput');
    expect(type.join('\n')).toContain('pullRequestId: ID!');
    expect(execFileSync('node', ['scripts/graphql-find.mjs', 'addComment'], { encoding: 'utf8' })).toContain('mutation addComment(');
  });
});
