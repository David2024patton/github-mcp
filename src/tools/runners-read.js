// Y-6a: read self-hosted runners and runner groups (organization or repository). Names, status and labels only —
// no tokens, no configuration. Free text (labels, names) is returned as data.
import { defineRead } from './define-read.js';
import { plain, readerFor } from './github-read.js';
import { LOGIN, REPO_NAME, MAX } from './public-read.js';

const OWNER = { ...LOGIN, description: 'Connected account (default account)' };
const SCOPE = { type: 'string', enum: ['org', 'repo'], description: 'org (default) or repo' };
const ID = { type: 'integer', minimum: 1 };

/** Route prefix and parameters for the scope; runner groups exist for organizations only. */
export function actionsBase(scope, owner, repo) {
  if (scope === 'repo') {
    if (!repo) throw new TypeError('scope repo needs repo.');
    return { prefix: '/repos/{owner}/{repo}/actions', params: { owner, repo } };
  }
  return { prefix: '/orgs/{org}/actions', params: { org: owner } };
}
export const shapeRunner = (r) => ({
  id: r.id, name: r.name, os: r.os, status: r.status, busy: r.busy === true, groupId: r.runner_group_id ?? null, ephemeral: r.ephemeral === true,
  version: r.version ?? null, labels: (r.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)).slice(0, 50)
});
export const shapeGroup = (g) => ({
  id: g.id, name: g.name, visibility: g.visibility, default: g.default === true, allowsPublicRepositories: g.allows_public_repositories === true,
  restrictedToWorkflows: g.restricted_to_workflows === true, inherited: g.inherited === true
});

const runnerList = defineRead({
  name: 'github_runner_list', area: 'actions', audience: ['B', 'O', 'Op'],
  description: 'List self-hosted runners (name, status, busy, labels) or runner groups of an organization or repository.',
  properties: { owner: OWNER, repo: REPO_NAME, scope: SCOPE, kind: { type: 'string', enum: ['runners', 'groups'], description: 'runners (default) or groups (organization only)' }, max: MAX },
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const scope = args.scope ?? 'org';
    const { prefix, params } = actionsBase(scope, owner, args.repo);
    if (args.kind === 'groups') {
      if (scope !== 'org') throw new TypeError('Runner groups exist only for organizations.');
      const d = (await octokit.request(`GET ${prefix}/runner-groups`, { ...params, per_page: args.max ?? 30 })).data;
      return { total: d.total_count ?? (d.runner_groups ?? []).length, groups: (d.runner_groups ?? []).map(shapeGroup), untrusted: true };
    }
    const d = (await octokit.request(`GET ${prefix}/runners`, { ...params, per_page: args.max ?? 30 })).data;
    return { total: d.total_count ?? (d.runners ?? []).length, runners: (d.runners ?? []).map(shapeRunner), untrusted: true };
  })
});
const runnerGet = defineRead({
  name: 'github_runner_get', area: 'actions', audience: ['B', 'O', 'Op'],
  description: 'Read one self-hosted runner: status, busy, labels, group, version.',
  properties: { owner: OWNER, repo: REPO_NAME, scope: SCOPE, runnerId: ID }, required: ['runnerId'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { prefix, params } = actionsBase(args.scope ?? 'org', owner, args.repo);
    return { runner: shapeRunner((await octokit.request(`GET ${prefix}/runners/{runner_id}`, { ...params, runner_id: args.runnerId })).data), untrusted: true };
  })
});
export const tools = [runnerList.tool, runnerGet.tool];
export const handlers = { [runnerList.tool.name]: runnerList.handler, [runnerGet.tool.name]: runnerGet.handler };
