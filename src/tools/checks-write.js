// Checks, statuses, artifacts and caches, change side (G-2 part 2). None of this touches a branch or an environment, so none of it is
// production. Check runs can only be written by a GitHub App; a fine-grained token is told so in plain words. Artifacts and caches are
// deleted only after the preview shows what goes.
import { defineGithubWrite } from './define-github-write.js';
import { OUTSIDE_PROJECT } from './protect-guard.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';

const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const repoTarget = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' });
const p = (target) => ({ owner: target.owner, repo: target.repo });
const OUTPUT = { title: { type: 'string', maxLength: 250 }, summary: { type: 'string', maxLength: 20000 }, text: { type: 'string', maxLength: 50000 } };
const ONLY_APPS = 'Only a GitHub App can create or change check runs, and this account is connected with a token instead. Use the GitHub App connection for it, or report the result as a commit status (github_status_create).';
const appOnly = (error) => (error?.status === 403 || error?.status === 401 ? refusal(ONLY_APPS, 403) : error);
const outputOf = (args) => (args.title || args.summary ? { output: { title: args.title ?? args.summary.slice(0, 80), summary: args.summary ?? args.title, ...(args.text ? { text: args.text } : {}) } } : {});
const getCheck = (ctx, target, id) => missing(async () => (await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}/check-runs/{check_run_id}', { ...p(target), check_run_id: id })).data);
const needConclusion = (args) => {
  if (args.status === 'completed' && !args.conclusion) throw new TypeError('A completed check run needs a conclusion (success, failure, neutral, cancelled, skipped, timed_out or action_required).');
  if (args.conclusion && args.status && args.status !== 'completed') throw new TypeError('A conclusion can only be given with status "completed".');
};
const CONCLUSIONS = ['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required'];

const checkCreate = defineGithubWrite({
  name: 'github_check_create_run', area: 'check', audience: ['B'],
  description: 'Create a check run on a commit (GitHub App only), queued, running or already completed.',
  properties: { owner: OWNER, repo: REPO, name: { type: 'string', minLength: 1, maxLength: 100 }, headSha: { type: 'string', minLength: 40, maxLength: 40 },
    status: { type: 'string', enum: ['queued', 'in_progress', 'completed'] }, conclusion: { type: 'string', enum: CONCLUSIONS }, detailsUrl: { type: 'string', maxLength: 500 }, externalId: { type: 'string', maxLength: 200 }, ...OUTPUT, ...OUTSIDE_PROJECT },
  required: ['repo', 'name', 'headSha'],
  declarations: { production: 'never' },
  target: (args, ctx) => { needConclusion(args); return repoTarget(args, ctx); },
  read: async (args, ctx, target) => ({ commit: await missing(async () => (await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}/commits/{ref}', { ...p(target), ref: args.headSha })).data.sha) }),
  classify: () => ({}),
  summarize: ({ args, before, target }) => (before.commit ? `Create check run "${args.name}" (${args.status ?? 'queued'}${args.conclusion ? `, ${args.conclusion}` : ''}) on commit ${args.headSha.slice(0, 7)} of ${slug(target.owner, target.repo)}` : `There is no commit ${args.headSha.slice(0, 7)} in ${slug(target.owner, target.repo)}`),
  apply: async ({ args, ctx, target, before }) => {
    if (!before.commit) throw refusal(`There is no commit ${args.headSha}.`, 404);
    try {
      return await (await octo(ctx, target.owner)).request('POST /repos/{owner}/{repo}/check-runs', { ...p(target), name: args.name, head_sha: args.headSha, ...(args.status ? { status: args.status } : {}),
        ...(args.conclusion ? { conclusion: args.conclusion } : {}), ...(args.detailsUrl ? { details_url: args.detailsUrl } : {}), ...(args.externalId ? { external_id: args.externalId } : {}), ...outputOf(args) });
    } catch (error) { throw appOnly(error); }
  },
  readAfter: ({ ctx, target, response }) => getCheck(ctx, target, response.data.id),
  verify: ({ args, after }) => after?.name === args.name && after?.head_sha === args.headSha && (!args.conclusion || after.conclusion === args.conclusion),
  present: ({ after }) => ({ check_run_id: after?.id, status: after?.status, conclusion: after?.conclusion, html_url: after?.html_url })
});

const checkUpdate = defineGithubWrite({
  name: 'github_check_update_run', area: 'check', audience: ['B'],
  description: 'Update a check run, or complete it with a conclusion (GitHub App only, and only runs that app created).',
  properties: { owner: OWNER, repo: REPO, checkRunId: { type: 'integer', minimum: 1 }, name: { type: 'string', maxLength: 100 }, status: { type: 'string', enum: ['queued', 'in_progress', 'completed'] },
    conclusion: { type: 'string', enum: CONCLUSIONS }, detailsUrl: { type: 'string', maxLength: 500 }, ...OUTPUT, ...OUTSIDE_PROJECT },
  required: ['repo', 'checkRunId'],
  declarations: { production: 'never' },
  target: (args, ctx) => { needConclusion(args); return repoTarget(args, ctx); },
  read: async (args, ctx, target) => ({ run: await getCheck(ctx, target, args.checkRunId) }),
  classify: () => ({}),
  summarize: ({ args, before, target }) => (before.run ? `Update check run "${before.run.name}" (${before.run.status}${before.run.conclusion ? `, ${before.run.conclusion}` : ''}) on ${before.run.head_sha.slice(0, 7)} of ${slug(target.owner, target.repo)}${args.status ? ` to ${args.status}` : ''}${args.conclusion ? ` with conclusion ${args.conclusion}` : ''}`
    : `There is no check run ${args.checkRunId} in ${slug(target.owner, target.repo)}`),
  apply: async ({ args, ctx, target, before }) => {
    if (!before.run) throw refusal(`There is no check run ${args.checkRunId}.`, 404);
    try {
      return await (await octo(ctx, target.owner)).request('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}', { ...p(target), check_run_id: args.checkRunId, ...(args.name ? { name: args.name } : {}), ...(args.status ? { status: args.status } : {}),
        ...(args.conclusion ? { conclusion: args.conclusion } : {}), ...(args.detailsUrl ? { details_url: args.detailsUrl } : {}), ...outputOf(args) });
    } catch (error) { throw appOnly(error); }
  },
  readAfter: ({ args, ctx, target }) => getCheck(ctx, target, args.checkRunId),
  verify: ({ args, after }) => after !== null && (!args.status || after.status === args.status) && (!args.conclusion || after.conclusion === args.conclusion),
  inverse: ({ args, before, target }) => (before.run && (args.status || args.conclusion) ? { tool: 'github_check_update_run', args: { owner: target.owner, repo: target.repo, checkRunId: args.checkRunId, status: before.run.status,
    ...(before.run.status === 'completed' ? { conclusion: before.run.conclusion } : {}) } } : null),
  present: ({ after }) => ({ check_run_id: after?.id, status: after?.status, conclusion: after?.conclusion })
});

const statusCreate = defineGithubWrite({
  name: 'github_status_create', area: 'status', audience: ['B'],
  description: 'Set a commit status (pending, success, failure or error) under a context name.',
  properties: { owner: OWNER, repo: REPO, sha: { type: 'string', minLength: 40, maxLength: 40 }, state: { type: 'string', enum: ['pending', 'success', 'failure', 'error'] },
    context: { type: 'string', minLength: 1, maxLength: 100, description: 'Default "default"' }, description: { type: 'string', maxLength: 140 }, targetUrl: { type: 'string', maxLength: 500 }, ...OUTSIDE_PROJECT },
  required: ['repo', 'sha', 'state'],
  declarations: { production: 'never' },
  target: repoTarget,
  read: async (args, ctx, target) => {
    const octokit = await octo(ctx, target.owner);
    const commit = await missing(async () => (await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', { ...p(target), ref: args.sha })).data.sha);
    const list = commit ? (await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/statuses', { ...p(target), ref: args.sha, per_page: 100 })).data : [];
    return { commit, previous: list.find((s) => s.context === (args.context ?? 'default')) ?? null };
  },
  classify: () => ({}),
  summarize: ({ args, before, target }) => (before.commit ? `Set status "${args.context ?? 'default'}" to ${args.state} on commit ${args.sha.slice(0, 7)} of ${slug(target.owner, target.repo)}${before.previous ? ` (it is ${before.previous.state} now)` : ''}` : `There is no commit ${args.sha.slice(0, 7)} in ${slug(target.owner, target.repo)}`),
  apply: async ({ args, ctx, target, before }) => {
    if (!before.commit) throw refusal(`There is no commit ${args.sha}.`, 404);
    return (await octo(ctx, target.owner)).request('POST /repos/{owner}/{repo}/statuses/{sha}', { ...p(target), sha: args.sha, state: args.state, context: args.context ?? 'default',
      ...(args.description ? { description: args.description } : {}), ...(args.targetUrl ? { target_url: args.targetUrl } : {}) });
  },
  readAfter: async ({ args, ctx, target }) => (await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}/commits/{ref}/statuses', { ...p(target), ref: args.sha, per_page: 100 })).data.find((s) => s.context === (args.context ?? 'default')) ?? null,
  verify: ({ args, after }) => after?.state === args.state,
  inverse: ({ args, before, target }) => (before.previous ? { tool: 'github_status_create', args: { owner: target.owner, repo: target.repo, sha: args.sha, state: before.previous.state, context: args.context ?? 'default',
    ...(before.previous.description ? { description: before.previous.description } : {}) } } : null),
  present: ({ args, after }) => ({ context: args.context ?? 'default', state: after?.state })
});

const artifactDelete = defineGithubWrite({
  name: 'github_artifact_delete', area: 'artifact', audience: ['Op'],
  description: 'Delete an Actions artifact. This cannot be undone.',
  properties: { owner: OWNER, repo: REPO, artifactId: { type: 'integer', minimum: 1 }, ...OUTSIDE_PROJECT }, required: ['repo', 'artifactId'],
  declarations: { production: 'never', confirm: 'always' },
  target: repoTarget,
  read: async (args, ctx, target) => ({ artifact: await missing(async () => (await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}', { ...p(target), artifact_id: args.artifactId })).data) }),
  classify: () => ({}),
  summarize: ({ args, before, target }) => (before.artifact ? `Permanently delete artifact "${before.artifact.name}" (${before.artifact.size_in_bytes} bytes${before.artifact.expired ? ', already expired' : ''}) from ${slug(target.owner, target.repo)}; this cannot be undone`
    : `There is no artifact ${args.artifactId} in ${slug(target.owner, target.repo)}`),
  apply: async ({ args, ctx, target, before }) => {
    if (!before.artifact) throw refusal(`There is no artifact ${args.artifactId}.`, 404);
    return (await octo(ctx, target.owner)).request('DELETE /repos/{owner}/{repo}/actions/artifacts/{artifact_id}', { ...p(target), artifact_id: args.artifactId });
  },
  readAfter: async ({ args, ctx, target }) => ((await missing(async () => (await (await octo(ctx, target.owner)).request('GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}', { ...p(target), artifact_id: args.artifactId })).data)) === null ? 'gone' : 'still there'),
  verify: ({ after }) => after === 'gone',
  present: ({ before }) => ({ deleted: before.artifact?.name })
});

async function findCaches(ctx, target, args) {
  const octokit = await octo(ctx, target.owner);
  const found = [];
  for (let page = 1; page <= 5; page += 1) {
    const data = (await octokit.request('GET /repos/{owner}/{repo}/actions/caches', { ...p(target), per_page: 100, page, ...(args.key ? { key: args.key } : {}), ...(args.ref ? { ref: args.ref } : {}) })).data;
    found.push(...(data.actions_caches ?? []));
    if ((data.actions_caches ?? []).length < 100) break;
  }
  return args.cacheId !== undefined ? found.filter((c) => c.id === args.cacheId) : found;
}
const cacheDelete = defineGithubWrite({
  name: 'github_cache_delete', area: 'cache', audience: ['B'],
  description: 'Delete Actions caches by id, or all caches with an exact key (optionally on one ref). They are rebuilt by the next run.',
  properties: { owner: OWNER, repo: REPO, cacheId: { type: 'integer', minimum: 1 }, key: { type: 'string', minLength: 1, maxLength: 250, description: 'Exact cache key' }, ref: { type: 'string', maxLength: 250, description: 'With key: only the cache on this ref, e.g. refs/heads/main' }, ...OUTSIDE_PROJECT },
  required: ['repo'],
  declarations: { production: 'never', confirm: 'always' },
  target: (args, ctx) => {
    if ((args.cacheId === undefined) === (args.key === undefined)) throw new TypeError('Give either cacheId or key (not both).');
    return repoTarget(args, ctx);
  },
  read: async (args, ctx, target) => ({ caches: await findCaches(ctx, target, args) }),
  classify: () => ({}),
  summarize: ({ args, before, target }) => (before.caches.length ? `Delete ${before.caches.length} cache(s) (${before.caches.reduce((n, c) => n + (c.size_in_bytes ?? 0), 0)} bytes) from ${slug(target.owner, target.repo)}: ${before.caches.slice(0, 3).map((c) => c.key).join(', ')}${before.caches.length > 3 ? ', …' : ''}`
    : `No cache matches ${args.cacheId !== undefined ? `id ${args.cacheId}` : `key ${args.key}`} in ${slug(target.owner, target.repo)}`),
  apply: async ({ args, ctx, target, before }) => {
    if (!before.caches.length) throw refusal('No cache matches, so nothing is deleted.', 404);
    const octokit = await octo(ctx, target.owner);
    if (args.cacheId !== undefined) return octokit.request('DELETE /repos/{owner}/{repo}/actions/caches/{cache_id}', { ...p(target), cache_id: args.cacheId });
    // `key` and `ref` belong in the query string; for a DELETE Octokit would otherwise send them as a body, which GitHub ignores.
    return octokit.request('DELETE /repos/{owner}/{repo}/actions/caches{?key,ref}', { ...p(target), key: args.key, ...(args.ref ? { ref: args.ref } : {}) });
  },
  readAfter: ({ args, ctx, target }) => findCaches(ctx, target, args),
  verify: ({ after }) => after.length === 0,
  present: ({ before }) => ({ deleted: before.caches.length })
});

const defs = [checkCreate, checkUpdate, statusCreate, artifactDelete, cacheDelete];
export const tools = defs.map((d) => d.tool);
export const handlers = Object.fromEntries(defs.map((d) => [d.tool.name, d.handler]));
