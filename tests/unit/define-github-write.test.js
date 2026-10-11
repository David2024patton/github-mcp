import { describe, expect, it } from 'vitest';
import { defineGithubWrite } from '../../src/tools/define-github-write.js';
import { requestKey } from '../../src/github/client.js';
import { createFakeDb } from '../../test/helpers/fake-db.js';
import { makeFakeGitHub } from '../../test/helpers/fake-github.js';
import { runWriteContract } from '../helpers/write-contract.js';

const CONNECTION = Object.freeze({ client_id: 'client-1', default_account: 'example-org', accounts: ['example-org'], mode: 'preview', profile: 'everyday', listing: 'catalog' });
const LABEL = { id: 1, node_id: 'MDU6TGFiZWwx', url: 'https://api.github.com/repos/example-org/hello/labels/bug', name: 'bug', color: 'd73a4a', default: false, description: null };

/** A real GitHub write through the fake GitHub: create a label. Every request is checked against the vendored description. */
async function build({ mismatch = false, guards, mode = 'preview' } = {}) {
  const gh = makeFakeGitHub();
  const db = createFakeDb();
  await db.initSchema();
  // First read (the plan) finds no label; every later read (the read-back, a repeat's plan) finds it.
  gh.when('GET /repos/{owner}/{repo}/labels/{name}').replySequence([
    { status: 404, body: { message: 'Not Found' } },
    { status: 200, body: { ...LABEL, color: mismatch ? 'ffffff' : LABEL.color } }
  ]);
  gh.when('POST /repos/{owner}/{repo}/labels').reply(201, LABEL, { 'x-github-request-id': 'GH-REQ-1' });
  const { tool, handler } = defineGithubWrite({
    name: 'github_label_create', description: 'Create a label', area: 'issues', profiles: ['everyday', 'full'],
    inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, name: { type: 'string' }, color: { type: 'string' } }, required: ['owner', 'repo', 'name'] },
    production: 'never', accessWidening: false, notifies: false, spend: false,
    plan: async (args, ctx) => {
      const octokit = await ctx.github();
      const found = await octokit.request('GET /repos/{owner}/{repo}/labels/{name}', { owner: args.owner, repo: args.repo, name: args.name }).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
      return { before: { exists: !!found } };
    },
    target: (args) => ({ owner: args.owner, repo: args.repo, label: `${args.owner}/${args.repo} label ${args.name}` }),
    summary: (args) => `Create label "${args.name}" in ${args.owner}/${args.repo}.`,
    apply: async (args, ctx) => {
      const octokit = await ctx.github();
      const res = await octokit.request('POST /repos/{owner}/{repo}/labels', { owner: args.owner, repo: args.repo, name: args.name, color: args.color });
      return { requestId: res.headers['x-github-request-id'] };
    },
    readAfter: async (args, ctx) => (await (await ctx.github()).request('GET /repos/{owner}/{repo}/labels/{name}', { owner: args.owner, repo: args.repo, name: args.name })).data,
    verify: (args, ctx, plan, after) => after.color === (args.color ?? after.color),
    inverse: (args) => ({ tool: 'github_label_delete', args: { owner: args.owner, repo: args.repo, name: args.name } })
  });
  const ctx = { connection: { ...CONNECTION, mode }, db, guards, fetch: gh.fetch, credentials: { token: async () => 'ghs_FAKEinstallationtoken' }, sleep: async () => {} };
  return { gh, db, tool, handler, ctx, toolName: tool.name, writes: () => gh.calls.filter((c) => c.method !== 'GET').length };
}

const ARGS = { owner: 'example-org', repo: 'hello', name: 'bug', color: 'd73a4a' };

runWriteContract('github_label_create through the fake GitHub', { build, args: ARGS });

describe('defineGithubWrite', () => {
  it('uses the pinned request key, takes the credential kind from the spec, and sends only valid requests', async () => {
    const w = await build();
    const res = await w.handler({ ...ARGS, confirm: true }, w.ctx);
    expect(res).toMatchObject({ status: 'applied', confirmed: true });
    expect(w.tool.cred).toBe('I');
    expect(w.gh.invalid).toEqual([]);
    expect(w.gh.unmatched).toEqual([]);
    const row = await w.db.getChangeByRequestKey(requestKey({ connection: CONNECTION }, 'github_label_create', ARGS));
    expect(row).toMatchObject({ account: 'example-org', repo: 'hello', github_request_id: 'GH-REQ-1', before: { exists: false } });
    expect(row.inverse.tool).toBe('github_label_delete');
  });

  it('refuses an account outside the connection before any write is sent', async () => {
    const w = await build();
    await expect(w.handler({ ...ARGS, owner: 'stranger-org', confirm: true }, w.ctx)).rejects.toMatchObject({ code: 'outside_scope' });
    expect(w.writes()).toBe(0);
  });
});
