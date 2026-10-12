// Reviews and review threads (E-3). Reads: reviews, threads (GraphQL, with resolved/outdated), inline comments. Text written by
// people without push access carries its author association so the dispatcher marks it untrusted.
import { listAll, graphql } from '../github/client.js';
import { defineRead } from './define-read.js';
import { plain, readerFor } from './github-read.js';

const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const NUMBER = { type: 'integer', minimum: 1, description: 'Pull request number' };
const MAX = { type: 'integer', minimum: 1, maximum: 300, description: 'Default 50' };

const THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 100) { totalCount nodes {
    id isResolved isOutdated path line startLine
    comments(last: 1) { totalCount nodes { author { login } body authorAssociation url } }
  } } } }
}`;

export const reviewList = defineRead({
  name: 'github_review_list', area: 'review', audience: ['B', 'Op'], summaryType: 'review',
  description: 'Reviews on a pull request: who, what they decided, and when.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, max: MAX },
  required: ['repo', 'number'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { items, capped } = await listAll(octokit, 'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews', { owner, repo: args.repo, pull_number: args.number }, { max: args.max ?? 50 });
    return { count: items.length, ...(capped ? { more_exist: true } : {}), items };
  })
});

export const reviewListThreads = defineRead({
  name: 'github_review_list_threads', area: 'review', audience: ['B'],
  description: 'List PR threads with resolved/outdated state, file location and latest comment.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, unresolvedOnly: { type: 'boolean', description: 'Only threads still open' } },
  required: ['repo', 'number'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const node = (await graphql(octokit, THREADS_QUERY, { owner, repo: args.repo, number: args.number })).repository?.pullRequest;
    if (!node) throw new TypeError(`There is no pull request #${args.number} in ${owner}/${args.repo}.`);
    const all = node.reviewThreads.nodes.map((t) => {
      const c = t.comments.nodes[0];
      return { id: t.id, resolved: t.isResolved, outdated: t.isOutdated, path: t.path, line: t.line ?? undefined, start_line: t.startLine ?? undefined, comments: t.comments.totalCount,
        latest_comment: c ? { author: c.author?.login, body: c.body, author_association: c.authorAssociation, html_url: c.url } : undefined };
    });
    const items = args.unresolvedOnly ? all.filter((t) => !t.resolved) : all;
    return { total: node.reviewThreads.totalCount, unresolved: all.filter((t) => !t.resolved).length, count: items.length,
      ...(node.reviewThreads.totalCount > all.length ? { more_exist: true, note: 'Only the first 100 threads are shown.' } : {}), items };
  })
});

export const reviewListComments = defineRead({
  name: 'github_review_list_comments', area: 'review', audience: ['B'],
  description: 'Inline review comments on a pull request, optionally only those on one file.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, path: { type: 'string', maxLength: 1000, description: 'Only comments on this file' }, max: MAX },
  required: ['repo', 'number'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { items, capped } = await listAll(octokit, 'GET /repos/{owner}/{repo}/pulls/{pull_number}/comments', { owner, repo: args.repo, pull_number: args.number }, { max: args.max ?? 50 });
    const kept = items.filter((c) => !args.path || c.path === args.path)
      .map((c) => ({ id: c.id, user: c.user?.login, path: c.path, line: c.line ?? c.original_line, side: c.side, in_reply_to: c.in_reply_to_id, body: c.body, author_association: c.author_association, created_at: c.created_at, html_url: c.html_url }));
    return { count: kept.length, ...(capped ? { more_exist: true } : {}), items: kept };
  })
});

const reads = [reviewList, reviewListThreads, reviewListComments];
export const tools = reads.map((d) => d.tool);
export const handlers = Object.fromEntries(reads.map((d) => [d.tool.name, d.handler]));
