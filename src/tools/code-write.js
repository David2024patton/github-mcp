// Files, commits and git data, change side (D-2): one file, several files in one signed commit, a commit comment and moving a branch.
// The branch is always named (nothing here assumes `main`), a file is changed only from the version the caller read, a branch moves
// only from the commit the caller saw, and GitHub signs the multi-file commit ("Verified", attributed to the App's bot).
import { defineGithubWrite } from './define-github-write.js';
import { productionReason } from './production-guard.js';
import { notifyOutsiders } from './people-guard.js';
import { OUTSIDE_PROJECT } from './protect-guard.js';
import { graphql } from '../github/client.js';
import { githubFor } from '../github/client.js';
import { GithubClientError } from '../github/errors.js';

const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9._-]+$', description: 'Repository name' };
const REPO_ARGS = { owner: OWNER, repo: REPO };
const ownerOf = (args, ctx) => String(args.owner ?? ctx.connection.default_account);
const clientFor = (ctx, args) => githubFor(ctx, { owner: ownerOf(args, ctx) });
const call = async (ctx, args, route, params) => (await (await clientFor(ctx, args)).request(route, params)).data;
/** A 404 answers null (it does not exist); anything else still fails. */
const callOrNull = async (ctx, args, route, params) => { try { return await call(ctx, args, route, params); } catch (error) { if (error?.status === 404) return null; throw error; } };
/** A refusal this server makes in plain words (counts as "definitely not done"). */
const refuse = (message, details = {}) => new GithubClientError('refused', message, details);

const BRANCH = { type: 'string', minLength: 1, maxLength: 255, description: 'The branch to commit to (required: nothing here assumes the default branch)' };
const PATH = { type: 'string', minLength: 1, maxLength: 1024, description: 'Path inside the repository, without a leading slash' };
const MESSAGE = { type: 'string', minLength: 1, maxLength: 2000, description: 'Commit message' };
const SHA = { type: 'string', pattern: '^[0-9a-fA-F]{40}$', maxLength: 40 };
const MAX_TOTAL_BYTES = 5_000_000;
const MAX_FILES = 100;
const slugOf = (args, ctx) => `${ownerOf(args, ctx)}/${args.repo}`;
const repoParams = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo });
const cleanPath = (p) => String(p).replace(/^\/+/, '');
const target = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, ref: args.branch, scope: 'repo' });
const productionOf = async ({ args, ctx }) => ({ production: await productionReason(ctx, { owner: ownerOf(args, ctx), repo: args.repo, ref: args.branch, scope: 'repo' }) });
const short = (sha) => String(sha ?? '').slice(0, 7);
const bytesOf = (text, encoding) => (encoding === 'base64' ? Buffer.from(String(text), 'base64') : Buffer.from(String(text), 'utf8'));
const toBase64 = (text, encoding) => bytesOf(text, encoding).toString('base64');

const CONTENT = 'GET /repos/{owner}/{repo}/contents/{path}';
const readFile = (args, ctx, path = args.path) => callOrNull(ctx, args, CONTENT, { ...repoParams(args, ctx), path: cleanPath(path), ref: args.branch });
const asFile = (data) => (data && !Array.isArray(data) && data.type === 'file' ? data : null);
/** The file at a path, or null when there is none. A folder is an error the caller can read: it is not a file to change. */
const fileOf = (before, args) => {
  if (Array.isArray(before)) throw refuse(`${cleanPath(args.path)} is a folder, not a file.`);
  return before;
};

/** The caller may pass the version they read; a different current version means the file changed since. */
function checkExpected(args, current, label) {
  if (args.expectedSha && args.expectedSha !== (current?.sha ?? null)) {
    throw refuse(`${label} changed since you read it (you saw ${short(args.expectedSha)}, it is now ${current ? short(current.sha) : 'gone'}). Read it again and repeat the change.`, { current_sha: current?.sha ?? null });
  }
}

const putFile = defineGithubWrite({
  name: 'github_content_put_file', area: 'content', audience: ['B'],
  description: 'Create or update one file with a commit on a named branch. Checks the file\'s current version first; a commit to a protected or default branch is production.',
  properties: {
    ...REPO_ARGS, path: PATH, branch: BRANCH, message: MESSAGE,
    content: { type: 'string', maxLength: 700000, description: 'The new file content' },
    encoding: { type: 'string', enum: ['utf-8', 'base64'], description: 'How content is written (default utf-8; use base64 for binary files)' },
    expectedSha: { ...SHA, description: 'The file\'s version (sha) you read; the change is refused if the file is different now' },
    ...OUTSIDE_PROJECT
  },
  required: ['repo', 'path', 'branch', 'message', 'content'],
  declarations: { production: 'when-target' },
  target,
  read: (args, ctx) => readFile(args, ctx),
  classify: productionOf,
  summarize: ({ args, ctx, before }) => (Array.isArray(before) ? `${cleanPath(args.path)} is a folder, not a file` : `${before ? `Update ${args.path} (version ${short(before.sha)}, ${before.size} bytes)` : `Create ${args.path}`} on branch ${args.branch} of ${slugOf(args, ctx)} with the message "${args.message.slice(0, 80)}" (${bytesOf(args.content, args.encoding).length} bytes)`),
  apply: async ({ args, ctx, before: found }) => {
    const before = fileOf(found, args);
    checkExpected(args, before, args.path);
    return (await clientFor(ctx, args)).request('PUT /repos/{owner}/{repo}/contents/{path}', {
      ...repoParams(args, ctx), path: cleanPath(args.path), message: args.message, content: toBase64(args.content, args.encoding), branch: args.branch, ...(before ? { sha: before.sha } : {}) });
  },
  readAfter: ({ args, ctx }) => readFile(args, ctx),
  verify: ({ args, after, before }) => !!asFile(after) && asFile(after).sha !== before?.sha && Buffer.from(asFile(after).content ?? '', 'base64').equals(bytesOf(args.content, args.encoding)),
  inverse: ({ args, ctx, before, after }) => {
    const base = { owner: ownerOf(args, ctx), repo: args.repo, path: args.path, branch: args.branch, expectedSha: after.sha };
    if (!before) return { tool: 'github_content_delete_file', args: { ...base, message: `Revert: remove ${args.path}` } };
    return before.content ? { tool: 'github_content_put_file', args: { ...base, message: `Revert: restore ${args.path} to ${short(before.sha)}`, content: before.content.replace(/\s/g, ''), encoding: 'base64' } } : null;
  },
  present: ({ response, after }) => ({ path: after.path, sha: after.sha, commit: response?.data?.commit?.sha, url: response?.data?.commit?.html_url })
});

const deleteFile = defineGithubWrite({
  name: 'github_content_delete_file', area: 'content', audience: ['B'],
  description: 'Delete one file with a commit on a named branch. Always asks first; a commit to a protected or default branch is production.',
  properties: { ...REPO_ARGS, path: PATH, branch: BRANCH, message: MESSAGE, expectedSha: { ...SHA, description: 'The file\'s version (sha) you read' }, ...OUTSIDE_PROJECT },
  required: ['repo', 'path', 'branch', 'message'],
  declarations: { production: 'when-target', confirm: 'always' },
  target,
  read: (args, ctx) => readFile(args, ctx),
  classify: productionOf,
  summarize: ({ args, ctx, before }) => (Array.isArray(before) ? `${cleanPath(args.path)} is a folder, not a file` : before ? `Delete ${args.path} (version ${short(before.sha)}, ${before.size} bytes) from branch ${args.branch} of ${slugOf(args, ctx)}` : `${args.path} does not exist on ${args.branch} of ${slugOf(args, ctx)}`),
  apply: async ({ args, ctx, before: found }) => {
    const before = fileOf(found, args);
    if (!before) throw refuse(`${args.path} does not exist on ${args.branch}.`);
    checkExpected(args, before, args.path);
    return (await clientFor(ctx, args)).request('DELETE /repos/{owner}/{repo}/contents/{path}', { ...repoParams(args, ctx), path: cleanPath(args.path), message: args.message, sha: before.sha, branch: args.branch });
  },
  readAfter: ({ args, ctx }) => readFile(args, ctx),
  verify: ({ after }) => after === null,
  inverse: ({ args, ctx, before }) => (before?.content ? { tool: 'github_content_put_file', args: { owner: ownerOf(args, ctx), repo: args.repo, path: args.path, branch: args.branch, message: `Revert: restore ${args.path}`, content: before.content.replace(/\s/g, ''), encoding: 'base64' } } : null),
  present: ({ args, response }) => ({ deleted: args.path, commit: response?.data?.commit?.sha })
});

const headOf = async (args, ctx) => {
  const ref = await callOrNull(ctx, args, 'GET /repos/{owner}/{repo}/git/ref/{ref}', { ...repoParams(args, ctx), ref: `heads/${args.branch}` });
  return ref?.object?.sha ?? null;
};

const COMMIT_MUTATION = `mutation($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) { commit { oid url } }
}`;

const pushFiles = defineGithubWrite({
  name: 'github_content_push_files', area: 'content', audience: ['B'],
  description: 'Commit several file changes at once on a named branch, signed by GitHub. Refused if the branch moved since you read its head.',
  properties: {
    ...REPO_ARGS, branch: BRANCH, message: MESSAGE, body: { type: 'string', maxLength: 5000, description: 'Longer commit description' },
    files: { type: 'array', maxItems: MAX_FILES, items: { type: 'object', properties: { path: PATH, content: { type: 'string', maxLength: 700000 }, encoding: { type: 'string', enum: ['utf-8', 'base64'] } }, required: ['path', 'content'], additionalProperties: false },
      description: 'Files to add or replace' },
    deletePaths: { type: 'array', maxItems: MAX_FILES, items: PATH, description: 'Files to remove' },
    expectedHeadOid: { ...SHA, description: 'The branch head you read; the push is refused if the branch is somewhere else now' }, ...OUTSIDE_PROJECT
  },
  required: ['repo', 'branch', 'message'],
  declarations: { production: 'when-target' },
  target: (args, ctx) => {
    const files = args.files ?? [];
    const deletes = args.deletePaths ?? [];
    if (!files.length && !deletes.length) throw new TypeError('Give at least one file to add or delete.');
    const paths = [...files.map((f) => cleanPath(f.path)), ...deletes.map(cleanPath)];
    if (new Set(paths).size !== paths.length) throw new TypeError('A path appears more than once.');
    if (files.reduce((sum, f) => sum + bytesOf(f.content, f.encoding).length, 0) > MAX_TOTAL_BYTES) throw new TypeError('These files are too large for one commit here (5 MB in total).');
    return target(args, ctx);
  },
  read: async (args, ctx) => ({ head: await headOf(args, ctx) }),
  classify: productionOf,
  summarize: ({ args, ctx, before }) => (before.head
    ? `Commit on branch ${args.branch} of ${slugOf(args, ctx)} (head ${short(before.head)}): ${(args.files ?? []).length} file(s) added or replaced, ${(args.deletePaths ?? []).length} removed, message "${args.message.slice(0, 80)}"`
    : `Branch ${args.branch} does not exist in ${slugOf(args, ctx)}`),
  apply: async ({ args, ctx, before }) => {
    if (!before.head) throw refuse(`Branch ${args.branch} does not exist in ${slugOf(args, ctx)}.`);
    if (args.expectedHeadOid && args.expectedHeadOid.toLowerCase() !== before.head.toLowerCase()) {
      throw refuse(`${args.branch} moved since you read it (you saw ${short(args.expectedHeadOid)}, it is now ${short(before.head)}). Read it again and repeat the push.`, { head: before.head });
    }
    const octokit = await clientFor(ctx, args);
    const input = {
      branch: { repositoryNameWithOwner: slugOf(args, ctx), branchName: args.branch },
      message: { headline: args.message.split('\n')[0].slice(0, 255), ...(args.body || args.message.includes('\n') ? { body: [args.message.split('\n').slice(1).join('\n').trim(), args.body].filter(Boolean).join('\n\n') } : {}) },
      expectedHeadOid: before.head,
      fileChanges: { additions: (args.files ?? []).map((f) => ({ path: cleanPath(f.path), contents: toBase64(f.content, f.encoding) })), deletions: (args.deletePaths ?? []).map((p) => ({ path: cleanPath(p) })) }
    };
    if (!input.fileChanges.deletions.length) delete input.fileChanges.deletions;
    if (!input.fileChanges.additions.length) delete input.fileChanges.additions;
    return { data: await graphql(octokit, COMMIT_MUTATION, { input }), headers: {} };
  },
  readAfter: async ({ args, ctx }) => ({ head: await headOf(args, ctx) }),
  verify: ({ before, after, response }) => !!response?.data?.createCommitOnBranch?.commit?.oid && after.head === response.data.createCommitOnBranch.commit.oid && after.head !== before.head,
  present: ({ response }) => ({ commit: response.data.createCommitOnBranch.commit.oid, url: response.data.createCommitOnBranch.commit.url, signed_by: 'GitHub' })
});

const commitComment = defineGithubWrite({
  name: 'github_commit_comment', area: 'commit', audience: ['B'],
  description: 'Comment on a commit, optionally on one line of a file. People mentioned in it are notified.',
  properties: {
    ...REPO_ARGS, sha: { type: 'string', pattern: '^[0-9a-fA-F]{7,40}$', maxLength: 40 }, body: { type: 'string', minLength: 1, maxLength: 8000 },
    path: { type: 'string', maxLength: 1024, description: 'File to comment on' }, line: { type: 'integer', minimum: 1, maximum: 1000000, description: 'Line of that file (needs path)' }
  },
  required: ['repo', 'sha', 'body'],
  declarations: { production: 'never', notifies: true },
  target: (args, ctx) => {
    if (args.line !== undefined && !args.path) throw new TypeError('A line needs a path.');
    return { owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' };
  },
  read: (args, ctx) => callOrNull(ctx, args, 'GET /repos/{owner}/{repo}/commits/{ref}', { ...repoParams(args, ctx), ref: args.sha }),
  classify: ({ args, ctx }) => notifyOutsiders(ctx, { text: args.body, repoOwner: ownerOf(args, ctx) }),
  summarize: ({ args, ctx, before }) => (before ? `Comment on commit ${short(before.sha)} of ${slugOf(args, ctx)}${args.path ? ` (${args.path}${args.line ? `:${args.line}` : ''})` : ''}: "${args.body.slice(0, 80)}"` : `Commit ${args.sha} was not found in ${slugOf(args, ctx)}`),
  apply: async ({ args, ctx, before }) => {
    if (!before) throw refuse(`Commit ${args.sha} was not found in ${slugOf(args, ctx)}.`);
    return (await clientFor(ctx, args)).request('POST /repos/{owner}/{repo}/commits/{commit_sha}/comments', { ...repoParams(args, ctx), commit_sha: before.sha, body: args.body, ...(args.path ? { path: args.path } : {}), ...(args.line ? { line: args.line } : {}) });
  },
  readAfter: async ({ response }) => response?.data ?? null,
  verify: ({ args, after }) => !!after?.id && after.body === args.body,
  present: ({ after }) => ({ id: after.id, url: after.html_url })
});

const UPDATE_REFS = `mutation($input: UpdateRefsInput!) {
  updateRefs(input: $input) { clientMutationId }
}`;

const updateRef = defineGithubWrite({
  name: 'github_git_update_ref', area: 'git', audience: ['B'],
  description: 'Move a branch to another commit. Only from the commit you saw; a move that drops commits needs force: true. Always asks first.',
  properties: {
    ...REPO_ARGS, branch: BRANCH, sha: { ...SHA, description: 'The commit the branch should point to' },
    force: { type: 'boolean', description: 'Allow a move that drops commits (a non-fast-forward)' },
    expectedHeadOid: { ...SHA, description: 'The commit you saw the branch on; refused if it is somewhere else now' }, ...OUTSIDE_PROJECT
  },
  required: ['repo', 'branch', 'sha'],
  declarations: { production: 'when-target', confirm: 'always', profiles: ['full'] },
  target,
  read: async (args, ctx) => {
    const [head, repo] = await Promise.all([headOf(args, ctx), call(ctx, args, 'GET /repos/{owner}/{repo}', repoParams(args, ctx))]);
    let dropped = null;
    if (head && head.toLowerCase() !== args.sha.toLowerCase()) {
      const cmp = await callOrNull(ctx, args, 'GET /repos/{owner}/{repo}/compare/{basehead}', { ...repoParams(args, ctx), basehead: `${args.sha}...${head}`, per_page: 1 });
      dropped = cmp ? cmp.ahead_by : null;
    } else if (head) dropped = 0;
    return { head, nodeId: repo.node_id, dropped };
  },
  classify: productionOf,
  summarize: ({ args, ctx, before }) => {
    if (!before.head) return `Branch ${args.branch} does not exist in ${slugOf(args, ctx)}`;
    const drop = before.dropped === null ? 'it could not be worked out whether commits would be dropped' : before.dropped === 0 ? 'no commits would be dropped' : `${before.dropped} commit(s) would be dropped from ${args.branch}`;
    return `Move branch ${args.branch} of ${slugOf(args, ctx)} from ${short(before.head)} to ${short(args.sha)}; ${drop}${args.force ? ' (force)' : ''}`;
  },
  apply: async ({ args, ctx, before }) => {
    if (!before.head) throw refuse(`Branch ${args.branch} does not exist in ${slugOf(args, ctx)}.`);
    if (args.expectedHeadOid && args.expectedHeadOid.toLowerCase() !== before.head.toLowerCase()) {
      throw refuse(`${args.branch} moved since you read it (you saw ${short(args.expectedHeadOid)}, it is now ${short(before.head)}).`, { head: before.head });
    }
    if (before.dropped === null) throw refuse(`${short(args.sha)} could not be compared with ${args.branch}, so it is not known whether the move drops commits. Check that commit exists.`);
    if (before.dropped > 0 && args.force !== true) throw refuse(`This move would drop ${before.dropped} commit(s) from ${args.branch}. If that is what you want, repeat it with force: true.`);
    const octokit = await clientFor(ctx, args);
    return { data: await graphql(octokit, UPDATE_REFS, { input: { repositoryId: before.nodeId, refUpdates: [{ name: `refs/heads/${args.branch}`, afterOid: args.sha, beforeOid: before.head, force: args.force === true }] } }), headers: {} };
  },
  readAfter: async ({ args, ctx }) => ({ head: await headOf(args, ctx) }),
  verify: ({ args, after }) => after.head?.toLowerCase() === args.sha.toLowerCase(),
  inverse: ({ args, ctx, before }) => ({ tool: 'github_git_update_ref', args: { owner: ownerOf(args, ctx), repo: args.repo, branch: args.branch, sha: before.head, force: true, expectedHeadOid: args.sha } }),
  present: ({ args, before }) => ({ branch: args.branch, was: before.head, now: args.sha })
});

const defs = [putFile, deleteFile, pushFiles, commitComment, updateRef];
export const tools = defs.map((d) => d.tool);
export const handlers = Object.fromEntries(defs.map((d) => [d.tool.name, d.handler]));
