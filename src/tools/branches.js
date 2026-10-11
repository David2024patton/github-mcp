// Branches and tags (D-3). Nothing here assumes `main`: a new branch starts from the repository's real default branch unless told
// otherwise. The default branch can never be deleted; a protected branch or any tag is production; every change names what it
// will do first, is read back afterwards, and records the change that undoes it.
import { githubFor } from '../github/client.js';
import { GithubClientError } from '../github/errors.js';
import { defineRead } from './define-read.js';
import { defineGithubWrite } from './define-github-write.js';
import { productionReason } from './production-guard.js';
import { plain, readerFor } from './github-read.js';

const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9._-]+$', description: 'Repository name' };
const REPO_ARGS = { owner: OWNER, repo: REPO };
const BRANCH = { type: 'string', minLength: 1, maxLength: 255, description: 'Branch name' };
const FROM = { type: 'string', minLength: 1, maxLength: 255, description: 'Branch, tag or commit to start from (default: the repository\'s default branch)' };
const SHA40 = /^[0-9a-f]{40}$/i;
const PAGE = { perPage: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 30' }, page: { type: 'integer', minimum: 1, maximum: 10000 } };

const ownerOf = (args, ctx) => String(args.owner ?? ctx.connection.default_account);
const params = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo });
const slugOf = (args, ctx) => `${ownerOf(args, ctx)}/${args.repo}`;
const clientFor = (ctx, args) => githubFor(ctx, { owner: ownerOf(args, ctx) });
const call = async (ctx, args, route, p) => (await (await clientFor(ctx, args)).request(route, p)).data;
const callOrNull = async (ctx, args, route, p) => { try { return await call(ctx, args, route, p); } catch (error) { if (error?.status === 404) return null; throw error; } };
const refuse = (message, details = {}) => new GithubClientError('refused', message, details);
const short = (sha) => String(sha ?? '').slice(0, 7);
const REF = 'GET /repos/{owner}/{repo}/git/ref/{ref}';
const refOf = (args, ctx, kind, name) => callOrNull(ctx, args, REF, { ...params(args, ctx), ref: `${kind}/${name}` });
const defaultBranch = async (args, ctx) => (await call(ctx, args, 'GET /repos/{owner}/{repo}', params(args, ctx))).default_branch;
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** The commit a starting point names: a full SHA is used as it is; a branch, tag or short SHA is looked up. */
async function resolveCommit(args, ctx, from) {
  const start = from ?? await defaultBranch(args, ctx);
  if (SHA40.test(start)) return { name: start, sha: start.toLowerCase() };
  const commit = await callOrNull(ctx, args, 'GET /repos/{owner}/{repo}/commits/{ref}', { ...params(args, ctx), ref: start });
  return { name: start, sha: commit?.sha ?? null };
}

// ---------------------------------------------------------------- reads

const branchList = defineRead({
  name: 'github_branch_list', area: 'branch', audience: ['B', 'Op'], summaryType: 'branch',
  description: 'Branches of a repository with their head commit and whether they are protected.',
  properties: { ...REPO_ARGS, protectedOnly: { type: 'boolean', description: 'true: only protected branches; false: only unprotected; leave out for all' }, ...PAGE },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    // `protected` is sent only when asked for: an empty value would make GitHub read it as "false" (audit G9).
    return (await octokit.request('GET /repos/{owner}/{repo}/branches', clean({ owner, repo: args.repo, protected: args.protectedOnly, per_page: args.perPage ?? 30, page: args.page }))).data;
  })
});

const branchGet = defineRead({
  name: 'github_branch_get', area: 'branch', audience: ['B', 'Op'],
  description: 'One branch: head commit, whether it is protected, and every rule (branch protection or ruleset) that applies to it.',
  properties: { ...REPO_ARGS, branch: BRANCH }, required: ['repo', 'branch'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const b = (await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', { owner, repo: args.repo, branch: args.branch })).data;
    let rules = { checked: false, note: 'The rules could not be read.' };
    try {
      const list = (await octokit.request('GET /repos/{owner}/{repo}/rules/branches/{branch}', { owner, repo: args.repo, branch: args.branch })).data;
      rules = { checked: true, count: list.length, types: [...new Set(list.map((r) => r.type))] };
    } catch { /* a failed read is never reported as "no rules" */ }
    return { name: b.name, protected: b.protected, sha: b.commit?.sha, message: String(b.commit?.commit?.message ?? '').split('\n')[0], author: b.commit?.author?.login ?? b.commit?.commit?.author?.name,
      protection: b.protection ? { required_checks: b.protection.required_status_checks?.contexts, enforced: b.protection.enabled } : undefined, rules };
  })
});

const tagList = defineRead({
  name: 'github_tag_list', area: 'tag', audience: ['B', 'Op'],
  description: 'Tags of a repository with the commit each points to.',
  properties: { ...REPO_ARGS, ...PAGE }, required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const tags = (await octokit.request('GET /repos/{owner}/{repo}/tags', clean({ owner, repo: args.repo, per_page: args.perPage ?? 30, page: args.page }))).data;
    return { count: tags.length, tags: tags.map((t) => ({ name: t.name, sha: t.commit?.sha })) };
  })
});

// ---------------------------------------------------------------- branches

const target = (args, ctx, ref = args.branch) => ({ owner: ownerOf(args, ctx), repo: args.repo, ref, scope: 'repo' });
const branchProduction = async ({ args, ctx }, ref = args.branch) => ({ production: await productionReason(ctx, { owner: ownerOf(args, ctx), repo: args.repo, ref, scope: 'repo' }) });

const branchCreate = defineGithubWrite({
  name: 'github_branch_create', area: 'branch', audience: ['B'],
  description: 'Create a branch from any branch, tag or commit. Starts from the repository\'s real default branch unless you say otherwise.',
  properties: { ...REPO_ARGS, branch: BRANCH, from: FROM }, required: ['repo', 'branch'],
  declarations: { production: 'never' },
  target: (args, ctx) => target(args, ctx),
  read: async (args, ctx) => ({ existing: await refOf(args, ctx, 'heads', args.branch), start: await resolveCommit(args, ctx, args.from) }),
  classify: () => ({}),
  summarize: ({ args, ctx, before }) => {
    if (before.existing) return `Branch ${args.branch} already exists in ${slugOf(args, ctx)} (at ${short(before.existing.object?.sha)}), so nothing is created`;
    if (!before.start.sha) return `${before.start.name} was not found in ${slugOf(args, ctx)}`;
    return `Create branch ${args.branch} in ${slugOf(args, ctx)} from ${before.start.name} (${short(before.start.sha)})${args.from ? '' : ', the default branch'}`;
  },
  apply: async ({ args, ctx, before }) => {
    if (before.existing) throw refuse(`Branch ${args.branch} already exists in ${slugOf(args, ctx)}.`);
    if (!before.start.sha) throw refuse(`${before.start.name} was not found in ${slugOf(args, ctx)}, so there is nothing to branch from.`);
    return (await clientFor(ctx, args)).request('POST /repos/{owner}/{repo}/git/refs', { ...params(args, ctx), ref: `refs/heads/${args.branch}`, sha: before.start.sha });
  },
  readAfter: ({ args, ctx }) => refOf(args, ctx, 'heads', args.branch),
  verify: ({ before, after }) => after?.object?.sha === before.start.sha,
  inverse: ({ args, ctx }) => ({ tool: 'github_branch_delete', args: { owner: ownerOf(args, ctx), repo: args.repo, branch: args.branch } }),
  present: ({ args, before }) => ({ branch: args.branch, from: before.start.name, sha: before.start.sha })
});

const branchRename = defineGithubWrite({
  name: 'github_branch_rename', area: 'branch', audience: ['B'],
  description: 'Rename a branch. GitHub retargets open pull requests; a protected or default branch is production.',
  properties: { ...REPO_ARGS, branch: BRANCH, newName: { ...BRANCH, description: 'The new name' } }, required: ['repo', 'branch', 'newName'],
  declarations: { production: 'when-target', confirm: 'always', profiles: ['full'] },
  target: (args, ctx) => target(args, ctx),
  read: async (args, ctx) => ({ old: await refOf(args, ctx, 'heads', args.branch), taken: await refOf(args, ctx, 'heads', args.newName) }),
  classify: (input) => branchProduction(input),
  summarize: ({ args, ctx, before }) => (!before.old ? `Branch ${args.branch} does not exist in ${slugOf(args, ctx)}`
    : before.taken ? `${slugOf(args, ctx)} already has a branch called ${args.newName}`
      : `Rename branch ${args.branch} to ${args.newName} in ${slugOf(args, ctx)}. Open pull requests move with it; links and scripts that use the old name will break`),
  apply: async ({ args, ctx, before }) => {
    if (!before.old) throw refuse(`Branch ${args.branch} does not exist in ${slugOf(args, ctx)}.`);
    if (before.taken) throw refuse(`${slugOf(args, ctx)} already has a branch called ${args.newName}.`);
    return (await clientFor(ctx, args)).request('POST /repos/{owner}/{repo}/branches/{branch}/rename', { ...params(args, ctx), branch: args.branch, new_name: args.newName });
  },
  readAfter: async ({ args, ctx }) => ({ renamed: await refOf(args, ctx, 'heads', args.newName), old: await refOf(args, ctx, 'heads', args.branch) }),
  verify: ({ before, after }) => after.renamed?.object?.sha === before.old.object?.sha && after.old === null,
  inverse: ({ args, ctx }) => ({ tool: 'github_branch_rename', args: { owner: ownerOf(args, ctx), repo: args.repo, branch: args.newName, newName: args.branch } }),
  present: ({ args, after }) => ({ renamed_from: args.branch, to: args.newName, sha: after.renamed.object.sha })
});

const branchDelete = defineGithubWrite({
  name: 'github_branch_delete', area: 'branch', audience: ['B'],
  description: 'Delete a branch. The default branch is never deleted; a protected branch is production. The undo recreates it at the commit it had.',
  properties: { ...REPO_ARGS, branch: BRANCH }, required: ['repo', 'branch'],
  declarations: { production: 'when-target', confirm: 'always' },
  target: (args, ctx) => target(args, ctx),
  read: async (args, ctx) => ({ ref: await refOf(args, ctx, 'heads', args.branch), defaultBranch: await defaultBranch(args, ctx) }),
  classify: (input) => branchProduction(input),
  summarize: ({ args, ctx, before }) => {
    if (!before.ref) return `Branch ${args.branch} does not exist in ${slugOf(args, ctx)}`;
    if (before.defaultBranch === args.branch) return `REFUSED: ${args.branch} is the default branch of ${slugOf(args, ctx)} and is never deleted`;
    return `Delete branch ${args.branch} of ${slugOf(args, ctx)} (it points at ${short(before.ref.object?.sha)}; the undo recreates it there)`;
  },
  apply: async ({ args, ctx, before }) => {
    if (!before.ref) throw refuse(`Branch ${args.branch} does not exist in ${slugOf(args, ctx)}.`);
    if (before.defaultBranch === args.branch) throw refuse(`${args.branch} is the default branch of ${slugOf(args, ctx)}; the default branch is never deleted. Change the default branch first.`);
    return (await clientFor(ctx, args)).request('DELETE /repos/{owner}/{repo}/git/refs/{ref}', { ...params(args, ctx), ref: `heads/${args.branch}` });
  },
  readAfter: ({ args, ctx }) => refOf(args, ctx, 'heads', args.branch),
  verify: ({ after }) => after === null,
  inverse: ({ args, ctx, before }) => ({ tool: 'github_branch_create', args: { owner: ownerOf(args, ctx), repo: args.repo, branch: args.branch, from: before.ref.object.sha } }),
  present: ({ args, before }) => ({ deleted: args.branch, was_at: before.ref.object.sha })
});

const branchMerge = defineGithubWrite({
  name: 'github_branch_merge', area: 'branch', audience: ['B'],
  description: 'Merge one branch into another directly, without a pull request. Merging into a protected or default branch is production.',
  properties: { ...REPO_ARGS, base: { ...BRANCH, description: 'The branch that receives the merge' }, head: { ...BRANCH, description: 'The branch (or commit) to merge in' }, commitMessage: { type: 'string', maxLength: 2000 } },
  required: ['repo', 'base', 'head'],
  declarations: { production: 'when-target' },
  target: (args, ctx) => target(args, ctx, args.base),
  read: async (args, ctx) => ({ base: await refOf(args, ctx, 'heads', args.base), head: (await resolveCommit(args, ctx, args.head)).sha }),
  classify: (input) => branchProduction(input, input.args.base),
  summarize: ({ args, ctx, before }) => (!before.base ? `Branch ${args.base} does not exist in ${slugOf(args, ctx)}` : !before.head ? `${args.head} was not found in ${slugOf(args, ctx)}`
    : `Merge ${args.head} (${short(before.head)}) into ${args.base} (${short(before.base.object?.sha)}) in ${slugOf(args, ctx)}, without a pull request`),
  apply: async ({ args, ctx, before }) => {
    if (!before.base) throw refuse(`Branch ${args.base} does not exist in ${slugOf(args, ctx)}.`);
    if (!before.head) throw refuse(`${args.head} was not found in ${slugOf(args, ctx)}.`);
    return (await clientFor(ctx, args)).request('POST /repos/{owner}/{repo}/merges', clean({ ...params(args, ctx), base: args.base, head: args.head, commit_message: args.commitMessage }));
  },
  readAfter: ({ args, ctx }) => refOf(args, ctx, 'heads', args.base),
  verify: ({ before, after, response }) => (response?.status === 204 ? after?.object?.sha === before.base.object?.sha : !!response?.data?.sha && after?.object?.sha === response.data.sha),
  present: ({ response, after }) => (response?.status === 204 ? { merged: false, note: 'Nothing to merge: the base already contains the head.' } : { merged: true, commit: after.object.sha })
});

// ---------------------------------------------------------------- tags

const tagTarget = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, ref: args.tag, scope: 'repo', kind: 'tag' });

const tagCreate = defineGithubWrite({
  name: 'github_tag_create', area: 'tag', audience: ['B'],
  description: 'Create a tag (lightweight, or annotated if you give a message) on a branch, tag or commit. Tags mark releases, so this is production.',
  properties: { ...REPO_ARGS, tag: { ...BRANCH, description: 'Tag name, for example v1.2.0' }, from: FROM, message: { type: 'string', minLength: 1, maxLength: 2000, description: 'Makes it an annotated tag' } },
  required: ['repo', 'tag'],
  declarations: { production: 'always', confirm: 'always', profiles: ['full'] },
  target: tagTarget,
  read: async (args, ctx) => ({ existing: await refOf(args, ctx, 'tags', args.tag), start: await resolveCommit(args, ctx, args.from) }),
  classify: () => ({ production: 'it creates a tag, and tags mark releases' }),
  summarize: ({ args, ctx, before }) => (before.existing ? `Tag ${args.tag} already exists in ${slugOf(args, ctx)}, so nothing is created`
    : !before.start.sha ? `${before.start.name} was not found in ${slugOf(args, ctx)}`
      : `Create ${args.message ? 'annotated ' : ''}tag ${args.tag} in ${slugOf(args, ctx)} on ${before.start.name} (${short(before.start.sha)})`),
  apply: async ({ args, ctx, before }) => {
    if (before.existing) throw refuse(`Tag ${args.tag} already exists in ${slugOf(args, ctx)}.`);
    if (!before.start.sha) throw refuse(`${before.start.name} was not found in ${slugOf(args, ctx)}.`);
    const octokit = await clientFor(ctx, args);
    let sha = before.start.sha;
    if (args.message) {
      sha = (await octokit.request('POST /repos/{owner}/{repo}/git/tags', { ...params(args, ctx), tag: args.tag, message: args.message, object: before.start.sha, type: 'commit' })).data.sha;
    }
    return octokit.request('POST /repos/{owner}/{repo}/git/refs', { ...params(args, ctx), ref: `refs/tags/${args.tag}`, sha });
  },
  readAfter: ({ args, ctx }) => refOf(args, ctx, 'tags', args.tag),
  verify: ({ args, before, after }) => (args.message ? after?.object?.type === 'tag' : after?.object?.sha === before.start.sha),
  inverse: ({ args, ctx }) => ({ tool: 'github_tag_delete', args: { owner: ownerOf(args, ctx), repo: args.repo, tag: args.tag } }),
  present: ({ args, before, after }) => ({ tag: args.tag, annotated: !!args.message, commit: before.start.sha, ref_sha: after.object.sha })
});

const tagDelete = defineGithubWrite({
  name: 'github_tag_delete', area: 'tag', audience: ['B'],
  description: 'Delete a tag. A lightweight tag can be recreated by the undo; an annotated tag\'s message cannot.',
  properties: { ...REPO_ARGS, tag: { ...BRANCH, description: 'Tag name' } }, required: ['repo', 'tag'],
  declarations: { production: 'always', confirm: 'always', profiles: ['full'] },
  target: tagTarget,
  read: async (args, ctx) => ({ ref: await refOf(args, ctx, 'tags', args.tag) }),
  classify: () => ({ production: 'it deletes a tag, and tags mark releases' }),
  summarize: ({ args, ctx, before }) => (before.ref ? `Delete tag ${args.tag} of ${slugOf(args, ctx)} (it points at ${short(before.ref.object?.sha)}${before.ref.object?.type === 'tag' ? ', an annotated tag whose message cannot be restored' : ''})` : `Tag ${args.tag} does not exist in ${slugOf(args, ctx)}`),
  apply: async ({ args, ctx, before }) => {
    if (!before.ref) throw refuse(`Tag ${args.tag} does not exist in ${slugOf(args, ctx)}.`);
    return (await clientFor(ctx, args)).request('DELETE /repos/{owner}/{repo}/git/refs/{ref}', { ...params(args, ctx), ref: `tags/${args.tag}` });
  },
  readAfter: ({ args, ctx }) => refOf(args, ctx, 'tags', args.tag),
  verify: ({ after }) => after === null,
  inverse: ({ args, ctx, before }) => (before.ref.object?.type === 'commit' ? { tool: 'github_tag_create', args: { owner: ownerOf(args, ctx), repo: args.repo, tag: args.tag, from: before.ref.object.sha } } : null),
  present: ({ args, before }) => ({ deleted: args.tag, was_at: before.ref.object.sha })
});

const defs = [branchList, branchGet, branchCreate, branchRename, branchDelete, branchMerge, tagList, tagCreate, tagDelete];
export const tools = defs.map((d) => d.tool);
export const handlers = Object.fromEntries(defs.map((d) => [d.tool.name, d.handler]));
