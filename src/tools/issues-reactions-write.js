// F-1: guarded reactions on issues, issue comments and PR review comments.
// Every removal first verifies the exact reaction belongs to the selected resource.
import { listAll } from '../github/client.js';
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { notifyOutsiders } from './people-guard.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const ID = { type: 'integer', minimum: 1 };
const KINDS = ['issue', 'issue_comment', 'review_comment'];
const CONTENT = ['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes'];
const target = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' });
const routes = {
  issue: {
    get: 'GET /repos/{owner}/{repo}/issues/{issue_number}',
    list: 'GET /repos/{owner}/{repo}/issues/{issue_number}/reactions',
    add: 'POST /repos/{owner}/{repo}/issues/{issue_number}/reactions',
    remove: 'DELETE /repos/{owner}/{repo}/issues/{issue_number}/reactions/{reaction_id}',
    key: 'issue_number'
  },
  issue_comment: {
    get: 'GET /repos/{owner}/{repo}/issues/comments/{comment_id}',
    list: 'GET /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions',
    add: 'POST /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions',
    remove: 'DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions/{reaction_id}',
    key: 'comment_id'
  },
  review_comment: {
    get: 'GET /repos/{owner}/{repo}/pulls/comments/{comment_id}',
    list: 'GET /repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions',
    add: 'POST /repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions',
    remove: 'DELETE /repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions/{reaction_id}',
    key: 'comment_id'
  }
};
const pathArgs = (args, t) => ({
  owner: t.owner, repo: t.repo,
  [routes[args.kind].key]: args.kind === 'issue' ? args.number : args.commentId
});
const sameRepoUrl = (url, t, type) => {
  const prefix = `https://api.github.com/repos/${t.owner}/${t.repo}/${type}/`;
  return typeof url === 'string' && url.toLowerCase().startsWith(prefix.toLowerCase())
    && /^[0-9]+$/.test(url.slice(prefix.length));
};
async function inspect(ctx, t, args) {
  const route = routes[args.kind], o = await octo(ctx, t.owner), p = pathArgs(args, t);
  const resource = await missing(async () => (await o.request(route.get, p)).data);
  if (!resource) throw refusal('The issue or comment does not exist.', 404);
  const belongs = args.kind === 'issue'
    ? resource.number === args.number && (!resource.repository_url ||
        resource.repository_url.toLowerCase() === `https://api.github.com/repos/${t.owner}/${t.repo}`.toLowerCase())
    : sameRepoUrl(args.kind === 'issue_comment' ? resource.issue_url : resource.pull_request_url,
      t, args.kind === 'issue_comment' ? 'issues' : 'pulls');
  if (!belongs) throw refusal('The selected resource could not be independently verified in this repository.');
  return { author: resource.user?.login ?? null };
}
async function inventory(ctx, t, args) {
  const route = routes[args.kind], o = await octo(ctx, t.owner);
  const result = await listAll(o, route.list, pathArgs(args, t), { max: 1000 });
  if (result.capped) throw refusal('Reaction inventory is incomplete; refusing an unverified change.');
  return result.items;
}

export const issueReact = defineGithubWrite({
  name: 'github_issue_react', area: 'issue', audience: ['Op'],
  description: 'Add or remove a reaction on a verified issue, issue comment or PR review comment with exact readback.',
  properties: { owner: OWNER, repo: REPO, kind: { type: 'string', enum: KINDS },
    number: ID, commentId: ID, mode: { type: 'string', enum: ['add','remove'] },
    content: { type: 'string', enum: CONTENT }, reactionId: ID },
  required: ['repo','kind','mode','content'],
  declarations: { production: 'never', notifies: true },
  target: (args, ctx) => {
    if ((args.kind === 'issue') !== (args.number !== undefined) ||
        (args.kind !== 'issue') !== (args.commentId !== undefined))
      throw new TypeError('Supply an issue number for issue or a commentId for comment, not both.');
    if ((args.mode === 'remove') !== (args.reactionId !== undefined))
      throw new TypeError('Remove requires a reactionId; add must omit it.');
    return target(args, ctx);
  },
  read: async (args, ctx, t) => {
    const { author } = await inspect(ctx, t, args);
    const reactions = await inventory(ctx, t, args);
    const reaction = args.mode === 'remove' ? reactions.find(x => x.id === args.reactionId) : null;
    if (args.mode === 'remove' && (!reaction || reaction.content !== args.content))
      throw refusal('That exact reaction ID and content were not found on this resource.');
    return { author, reaction: reaction ? { id: reaction.id, content: reaction.content, user: reaction.user?.login } : null };
  },
  classify: ({ args, ctx, target: t, before }) => args.mode === 'add' && before?.author
    ? notifyOutsiders(ctx, { logins: [before.author], repoOwner: t.owner })
    : ({}),
  summarize: ({ args, target: t }) => `${args.mode} ${args.content} reaction on ${args.kind} #${args.number ?? args.commentId} in ${slug(t.owner, t.repo)}`,
  apply: ({ args, ctx, target: t }) => octo(ctx, t.owner).then(o => o.request(routes[args.kind][args.mode === 'add' ? 'add' : 'remove'], {
    ...pathArgs(args, t),
    ...(args.mode === 'add' ? { content: args.content } : { reaction_id: args.reactionId })
  })),
  readAfter: ({ args, ctx, target: t }) => inventory(ctx, t, args),
  verify: ({ args, after, response }) => {
    if (!Array.isArray(after)) return false;
    if (args.mode === 'remove') return after.every(x => x.id !== args.reactionId);
    const added = response?.data;
    return Number.isSafeInteger(added?.id) && added.content === args.content
      && after.some(x => x.id === added.id && x.content === args.content
        && x.user?.login === added.user?.login);
  },
  inverse: ({ args, response, target: t }) => args.mode === 'add' && Number.isSafeInteger(response?.data?.id)
    ? { tool: 'github_issue_react', args: { owner: t.owner, repo: t.repo, kind: args.kind,
      ...(args.kind === 'issue' ? { number: args.number } : { commentId: args.commentId }),
      mode: 'remove', content: args.content, reactionId: response.data.id } } : null,
  present: ({ args, after, response }) => ({ kind: args.kind, mode: args.mode, content: args.content,
    reactionId: args.mode === 'add' ? response?.data?.id : args.reactionId,
    countOfType: after.filter(x => x.content === args.content).length })
});

export const tools = [issueReact.tool];
export const handlers = { [issueReact.tool.name]: issueReact.handler };
