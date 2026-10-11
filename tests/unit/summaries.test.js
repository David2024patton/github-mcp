import { describe, expect, it } from 'vitest';
import { SUMMARIES, SUMMARY_TYPES, summarize } from '../../src/tools/summaries.js';
import { defineRead } from '../../src/tools/define-read.js';

const user = { login: 'octo', id: 1, avatar_url: 'https://x/a.png', node_id: 'N' };
const FIXTURES = {
  repository: [{ full_name: 'o/r', description: 'd', private: false, visibility: 'public', fork: false, archived: false, default_branch: 'main', language: 'JS', stargazers_count: 3, forks_count: 1, open_issues_count: 2, pushed_at: 't', html_url: 'u', owner: user, node_id: 'x' }, { stars: 3, default_branch: 'main' }],
  branch: [{ name: 'main', protected: true, commit: { sha: 's', url: 'u' }, _links: {} }, { name: 'main', sha: 's' }],
  commit: [{ sha: 's', commit: { message: 'm\n\nbody', author: { name: 'N', date: 'd' }, verification: { verified: true } }, author: user, parents: [{}, {}], html_url: 'u' }, { author: 'octo', parents: 2, verified: true }],
  compare: [{ status: 'ahead', ahead_by: 2, behind_by: 0, total_commits: 2, merge_base_commit: { sha: 'b' }, files: [{}, {}, {}], commits: [{ sha: 's', commit: { message: 'm\nmore' } }], html_url: 'u' }, { files_changed: 3, merge_base: 'b', commits: [{ sha: 's', message: 'm' }] }],
  pull_request: [{ number: 7, title: 'T', state: 'open', draft: false, merged: false, user, head: { ref: 'h', sha: 'hs', repo: {} }, base: { ref: 'main' }, mergeable_state: 'clean', labels: [{ name: 'bug', color: 'f' }], updated_at: 't', html_url: 'u', body: 'b', author_association: 'NONE' }, { user: 'octo', head: 'h', head_sha: 'hs', base: 'main', labels: ['bug'], author_association: 'NONE' }],
  review: [{ id: 1, user, state: 'APPROVED', submitted_at: 't', commit_id: 'c', body: 'ok', html_url: 'u', author_association: 'MEMBER' }, { user: 'octo', state: 'APPROVED' }],
  review_thread: [{ id: 'T', isResolved: false, isOutdated: false, path: 'a.js', line: 3, comments: { totalCount: 2, nodes: [{ author: { login: 'octo' }, body: 'hm', authorAssociation: 'NONE' }] } }, { resolved: false, comments: 2, first_comment: { author: 'octo', body: 'hm' } }],
  issue: [{ number: 1, title: 'T', state: 'open', user, labels: [{ name: 'x' }], assignees: [user], milestone: { title: 'v1' }, comments: 4, pull_request: {}, created_at: 'c', updated_at: 'u', html_url: 'h', body: 'b' }, { assignees: ['octo'], milestone: 'v1', is_pull_request: true }],
  comment: [{ id: 1, user, created_at: 'c', updated_at: 'u', body: 'hi', html_url: 'h', author_association: 'NONE' }, { user: 'octo', body: 'hi', author_association: 'NONE' }],
  label: [{ name: 'bug', color: 'f', description: 'd', default: true, id: 1 }, { name: 'bug', default: true }],
  milestone: [{ number: 1, title: 'v1', state: 'open', open_issues: 1, closed_issues: 2, due_on: 'd', html_url: 'u', creator: user }, { open_issues: 1, closed_issues: 2 }],
  workflow: [{ id: 1, name: 'CI', path: '.github/workflows/ci.yml', state: 'active', html_url: 'u', badge_url: 'b' }, { path: '.github/workflows/ci.yml' }],
  run: [{ id: 1, name: 'CI', display_title: 'T', event: 'push', status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: 's', run_number: 5, run_attempt: 1, actor: user, created_at: 'c', updated_at: 'u', html_url: 'h', repository: {} }, { branch: 'main', actor: 'octo' }],
  job: [{ id: 1, name: 'build', status: 'completed', conclusion: 'failure', started_at: 's', completed_at: 'c', runner_name: 'r', steps: [{ name: 'a', conclusion: 'success' }, { name: 'test', conclusion: 'failure' }], html_url: 'h' }, { failed_steps: ['test'] }],
  check_run: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success', started_at: 's', completed_at: 'c', app: { slug: 'gh' }, output: { title: 't', summary: 's', annotations_count: 2 }, html_url: 'h' }, { app: 'gh', title: 't', annotations: 2 }],
  status: [{ id: 1, state: 'success', context: 'ci', description: 'd', target_url: 'u', created_at: 'c', creator: user }, { state: 'success', context: 'ci' }],
  artifact: [{ id: 1, name: 'a', size_in_bytes: 10, expired: false, created_at: 'c', expires_at: 'e', archive_download_url: 'secret-ish' }, { size_in_bytes: 10 }],
  release: [{ id: 1, tag_name: 'v1', name: 'One', draft: false, prerelease: false, author: user, target_commitish: 'main', created_at: 'c', published_at: 'p', assets: [{}, {}], body: 'notes', html_url: 'h' }, { tag: 'v1', author: 'octo', assets: 2 }],
  deployment: [{ id: 1, environment: 'production', ref: 'main', sha: 's', task: 'deploy', creator: user, production_environment: true, created_at: 'c', description: 'd' }, { creator: 'octo', production: true }],
  environment: [{ name: 'production', created_at: 'c', updated_at: 'u', protection_rules: [{}], deployment_branch_policy: { protected_branches: true }, html_url: 'h' }, { protection_rules: 1, branch_policy: 'restricted' }],
  webhook: [{ id: 1, name: 'web', active: true, events: ['push'], config: { url: 'https://h.example/x', content_type: 'json', secret: '********' }, updated_at: 'u', last_response: { status: 'active' } }, { url: 'https://h.example/x', last_status: 'active' }],
  delivery: [{ id: 1, guid: 'g', delivered_at: 'd', redelivery: false, duration: 0.2, status: 'OK', status_code: 200, event: 'push', action: null }, { status_code: 200 }],
  alert: [{ number: 3, state: 'open', security_advisory: { severity: 'high', summary: 'bad' }, dependency: { package: { name: 'lodash' } }, created_at: 'c', html_url: 'h' }, { severity: 'high', summary: 'bad', package: 'lodash' }],
  member: [{ login: 'octo', id: 1, type: 'User', role: 'admin', site_admin: false, html_url: 'h', avatar_url: 'a' }, { login: 'octo', role: 'admin' }],
  team: [{ id: 1, name: 'Core', slug: 'core', description: 'd', privacy: 'closed', permission: 'push', parent: { slug: 'all' }, members_count: 4, repos_count: 9, html_url: 'h' }, { parent: 'all', members: 4 }],
  invitation: [{ id: 1, login: 'octo', email: null, role: 'direct_member', created_at: 'c', inviter: user, failed_reason: null }, { inviter: 'octo' }],
  installation: [{ id: 1, account: user, repository_selection: 'all', app_slug: 'app', suspended_at: null, updated_at: 'u', permissions: { contents: 'write', issues: 'read' } }, { account: 'octo', permissions: ['contents', 'issues'] }],
  usage_item: [{ product: 'Actions', sku: 'minutes', unitType: 'minutes', quantity: 10, pricePerUnit: 0.008, grossAmount: 0.08, discountAmount: 0.08, netAmount: 0 }, { unit: 'minutes', gross: 0.08, net: 0 }],
  codespace: [{ name: 'cs', display_name: 'D', state: 'Available', owner: user, repository: { full_name: 'o/r' }, machine: { name: 'basic' }, created_at: 'c', last_used_at: 'l', web_url: 'w' }, { owner: 'octo', repository: 'o/r', machine: 'basic' }]
};

describe('summaries', () => {
  it('has a fixture for every summary type', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...SUMMARY_TYPES].sort());
    expect(SUMMARY_TYPES.length).toBe(29);
  });
  for (const [type, [input, expected]] of Object.entries(FIXTURES)) {
    it(`${type}: keeps the few fields a person reads and drops the rest`, () => {
      const out = SUMMARIES[type](input);
      expect(out).toMatchObject(expected);
      expect(JSON.stringify(out).length).toBeLessThan(JSON.stringify(input).length + 200);
      for (const dropped of ['avatar_url', 'node_id', '_links', 'badge_url', 'archive_download_url']) expect(JSON.stringify(out)).not.toContain(dropped);
    });
  }
  it('carries author_association with any text so repository text can still be marked untrusted', () => {
    expect(summarize('pull_request', FIXTURES.pull_request[0]).author_association).toBe('NONE');
    expect(summarize('comment', FIXTURES.comment[0]).author_association).toBe('NONE');
    expect(summarize('delivery', { id: 1, author_association: 'NONE' })).not.toHaveProperty('author_association');
  });
  it('maps a list, and refuses an unknown type', () => {
    expect(summarize('label', [{ name: 'a' }, { name: 'b' }])).toEqual([{ name: 'a' }, { name: 'b' }]);
    expect(() => summarize('nope', {})).toThrow(/No summary/);
    expect(() => summarize('constructor', {})).toThrow(/No summary/);
  });
  it('stays well under the size of GitHub\'s own objects for a pull request', () => {
    const big = { ...FIXTURES.pull_request[0], _padding: 'x'.repeat(20000), base: { ref: 'main', repo: { huge: 'y'.repeat(5000) } } };
    expect(JSON.stringify(summarize('pull_request', big)).length).toBeLessThan(700);
  });
});

describe('defineRead', () => {
  const ok = { name: 'github_x_list', description: 'List things.', handler: async () => [] };
  it('adds detail (only when there is a summary) and fields, and marks the tool read-only', () => {
    const plain = defineRead(ok).tool;
    expect(plain.inputSchema.properties).toHaveProperty('fields');
    expect(plain.inputSchema.properties).not.toHaveProperty('detail');
    const withSummary = defineRead({ ...ok, summaryType: 'label', properties: { owner: { type: 'string' } }, required: ['owner'] }).tool;
    expect(withSummary.inputSchema.properties.detail.enum).toEqual(['summary', 'full']);
    expect(withSummary.inputSchema.required).toEqual(['owner']);
    expect(withSummary).toMatchObject({ readContract: 'defineRead-v1', results: { summaryType: 'label' }, annotations: { readOnlyHint: true, destructiveHint: false } });
    expect(withSummary.writes).toBeUndefined();
    expect(Object.isFrozen(withSummary)).toBe(true);
  });
  it('refuses a bad definition', () => {
    expect(() => defineRead({ ...ok, name: 'Bad' })).toThrow(TypeError);
    expect(() => defineRead({ ...ok, description: '' })).toThrow(TypeError);
    expect(() => defineRead({ ...ok, handler: undefined })).toThrow(/handler/);
    expect(() => defineRead({ ...ok, summaryType: 'nope' })).toThrow(/unknown summary type/);
    expect(() => defineRead({ ...ok, properties: { fields: {} } })).toThrow(/added by the read layer/);
  });
});
