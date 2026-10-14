// F-1: issue creation, editing and conversation, using the existing guarded, journalled
// GitHub write pipeline (preview, identity, people, idempotency, readback).
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { notifyOutsiders } from './people-guard.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const NUMBER = { type: 'integer', minimum: 1 };
const TITLE = { type: 'string', minLength: 1, maxLength: 256 };
const BODY = { type: 'string', maxLength: 20000 };
const MENTION_BODY = { type: 'string', minLength: 1, maxLength: 20000 };
const target = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' });
const issueRoute = 'GET /repos/{owner}/{repo}/issues/{issue_number}';
const getIssue = (ctx, t, number) => missing(async () => (
  await (await octo(ctx, t.owner)).request(issueRoute, { owner: t.owner, repo: t.repo, issue_number: number })
).data);
const expectIssue = (issue, number) => {
  if (!issue) throw refusal(`Issue #${number} does not exist.`, 404);
  if (issue.pull_request) throw refusal(`#${number} is a pull request; use the pull-request tools.`);
  return issue;
};
const brief = (i) => ({
  number: i.number, title: i.title, state: i.state, state_reason: i.state_reason,
  body: i.body, labels: (i.labels ?? []).map(l => typeof l === 'string' ? l : l.name),
  assignees: (i.assignees ?? []).map(a => a.login), milestone: i.milestone?.number ?? null, html_url: i.html_url
});

export const issueCreate = defineGithubWrite({
  name: 'github_issue_create', area: 'issue', audience: ['B', 'Op'],
  description: 'Open an issue with labels, assignees, milestone and guarded notifications.',
  properties: { owner: OWNER, repo: REPO, title: TITLE, body: BODY,
    labels: { type: 'array', maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 100 } },
    assignees: { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 39 } },
    milestone: NUMBER },
  required: ['repo', 'title'],
  declarations: { production: 'never', notifies: true },
  target,
  read: async (args, ctx, t) => {
    const repo = (await (await octo(ctx, t.owner)).request('GET /repos/{owner}/{repo}', { owner: t.owner, repo: t.repo })).data;
    if (repo.has_issues === false) throw refusal('Issues are disabled in this repository.');
    return { exists: true, has_issues: repo.has_issues };
  },
  classify: ({ args, ctx, target: t }) => notifyOutsiders(ctx, { text: `${args.title}\n${args.body ?? ''}`, logins: args.assignees ?? [], repoOwner: t.owner }),
  summarize: ({ args, target: t }) => `Create an issue in ${slug(t.owner, t.repo)}: "${args.title.slice(0, 90)}"${args.assignees?.length ? ` and notify ${args.assignees.join(', ')}` : ''}`,
  apply: ({ args, ctx, target: t }) => octo(ctx, t.owner).then(o => o.request('POST /repos/{owner}/{repo}/issues', { owner: t.owner, repo: t.repo, title: args.title,
    ...(args.body !== undefined ? { body: args.body } : {}),
    ...(args.labels !== undefined ? { labels: args.labels } : {}),
    ...(args.assignees !== undefined ? { assignees: args.assignees } : {}),
    ...(args.milestone !== undefined ? { milestone: args.milestone } : {}) })),
  readAfter: ({ ctx, target: t, response }) => getIssue(ctx, t, response.data.number),
  verify: ({ args, after }) => !!after && !after.pull_request && after.title === args.title
    && (args.body === undefined || after.body === args.body)
    && (args.labels === undefined || args.labels.every(n => (after.labels ?? []).some(l => l.name === n || l === n)))
    && (args.assignees === undefined || args.assignees.every(n => (after.assignees ?? []).some(a => a.login?.toLowerCase() === n.toLowerCase()))),
  inverse: () => null, // GitHub issues cannot be deleted; closing is not a complete inverse.
  present: ({ after }) => brief(after)
});

export const issueUpdate = defineGithubWrite({
  name: 'github_issue_update', area: 'issue', audience: ['B', 'Op'],
  description: 'Update issue title, body, state, state reason or milestone; omitted fields stay unchanged.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, title: TITLE, body: BODY,
    state: { type: 'string', enum: ['open', 'closed'] },
    stateReason: { type: 'string', enum: ['completed', 'not_planned', 'reopened'] },
    milestone: { type: ['integer', 'null'], minimum: 1 } },
  required: ['repo', 'number'],
  declarations: { production: 'never', notifies: true },
  target: (args, ctx) => {
    if (!['title', 'body', 'state', 'milestone'].some(k => Object.hasOwn(args, k))) throw new TypeError('Provide at least one field to update.');
    if (args.stateReason && !args.state) throw new TypeError('stateReason needs an explicit state.');
    if (args.state === 'open' && args.stateReason && args.stateReason !== 'reopened') throw new TypeError('Opening an issue uses reopened.');
    if (args.state === 'closed' && args.stateReason === 'reopened') throw new TypeError('Closing an issue needs completed or not_planned.');
    return target(args, ctx);
  },
  read: (args, ctx, t) => getIssue(ctx, t, args.number).then(i => expectIssue(i, args.number)),
  classify: ({ args, ctx, target: t }) => notifyOutsiders(ctx, { text: `${args.title ?? ''}\n${args.body ?? ''}`, repoOwner: t.owner }),
  summarize: ({ args, target: t }) => `Update issue #${args.number} in ${slug(t.owner, t.repo)} (${Object.keys(args).filter(k => ['title', 'body', 'state', 'milestone'].includes(k)).join(', ')})`,
  apply: ({ args, ctx, target: t }) => octo(ctx, t.owner).then(o => o.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}', { owner: t.owner, repo: t.repo, issue_number: args.number,
    ...(args.title !== undefined ? { title: args.title } : {}),
    ...(args.body !== undefined ? { body: args.body } : {}),
    ...(args.state !== undefined ? { state: args.state } : {}),
    ...(args.stateReason !== undefined ? { state_reason: args.stateReason } : {}),
    ...(args.milestone !== undefined ? { milestone: args.milestone } : {}) })),
  readAfter: ({ args, ctx, target: t }) => getIssue(ctx, t, args.number),
  verify: ({ args, after }) => !!after && !after.pull_request &&
    (args.title === undefined || after.title === args.title) &&
    (args.body === undefined || after.body === args.body) &&
    (args.state === undefined || after.state === args.state) &&
    (args.stateReason === undefined || after.state_reason === args.stateReason) &&
    (args.milestone === undefined || (after.milestone?.number ?? null) === args.milestone),
  inverse: () => null,
  present: ({ after }) => brief(after)
});

export const issueComment = defineGithubWrite({
  name: 'github_issue_comment', area: 'issue', audience: ['B', 'Op'],
  description: 'Post a comment to an issue or PR and verify its exact body afterward.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, body: MENTION_BODY },
  required: ['repo', 'number', 'body'],
  declarations: { production: 'never', notifies: true },
  target,
  read: async (args, ctx, t) => {
    const i = await getIssue(ctx, t, args.number);
    if (!i) throw refusal(`Issue or PR #${args.number} does not exist.`, 404);
    return { number: i.number, state: i.state };
  },
  classify: ({ args, ctx, target: t }) => notifyOutsiders(ctx, { text: args.body, repoOwner: t.owner }),
  summarize: ({ args, target: t }) => `Comment on #${args.number} in ${slug(t.owner, t.repo)}: "${args.body.slice(0,90)}"`,
  apply: ({ args, ctx, target: t }) => octo(ctx, t.owner).then(o => o.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', { owner: t.owner, repo: t.repo, issue_number: args.number, body: args.body })),
  readAfter: ({ ctx, target: t, response }) => octo(ctx, t.owner).then(o => o.request('GET /repos/{owner}/{repo}/issues/comments/{comment_id}', { owner: t.owner, repo: t.repo, comment_id: response.data.id })).then(r => r.data),
  verify: ({ args, after, response }) => !!after && after.id === response.data.id && after.body === args.body,
  inverse: () => null,
  present: ({ after }) => ({ id: after.id, body: after.body, author: after.user?.login, html_url: after.html_url })
});

const all = [issueCreate, issueUpdate, issueComment];
export const tools = all.map(d => d.tool);
export const handlers = Object.fromEntries(all.map(d => [d.tool.name, d.handler]));
