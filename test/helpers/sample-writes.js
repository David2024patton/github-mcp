// Sample write tools used only to prove the write layer (B-1). They are never registered in the real registry. Each one calls a
// real GitHub endpoint (so the fake validates the request shape) through the real client; only the classification of what the
// write touches is a fixture (the real classifiers arrive with the guard cards B-2 to B-4).
import { defineGithubWrite } from '../../src/tools/define-github-write.js';
import { githubFor } from '../../src/github/client.js';

const target = (args) => ({ owner: args.owner, repo: args.repo, scope: 'repo' });
const repoProps = { owner: { type: 'string', maxLength: 39 }, repo: { type: 'string', maxLength: 100 } };
const octo = (ctx, args) => githubFor(ctx, { owner: args.owner });
export const OWN_PEOPLE = ['example-owner', 'github-actions[bot]'];
export const SEAT_PRICE_CENTS = 1900;

/** Plain tool: adds a label to an issue. Preview available, no confirmation for an ordinary target. */
export const sampleLabel = defineGithubWrite({
  name: 'github_sample_label',
  description: 'Sample: add a label to an issue.',
  properties: { ...repoProps, issue_number: { type: 'integer', minimum: 1 }, label: { type: 'string', maxLength: 50 } },
  required: ['owner', 'repo', 'issue_number', 'label'],
  declarations: { production: 'never' },
  target,
  read: async (args, ctx) => (await (await octo(ctx, args)).request('GET /repos/{owner}/{repo}/issues/{issue_number}/labels', { owner: args.owner, repo: args.repo, issue_number: args.issue_number })).data.map((l) => l.name),
  classify: () => ({}),
  summarize: ({ args }) => `Add label "${args.label}" to ${args.owner}/${args.repo}#${args.issue_number}`,
  apply: async ({ args, ctx }) => (await octo(ctx, args)).request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', { owner: args.owner, repo: args.repo, issue_number: args.issue_number, labels: [args.label] }),
  readAfter: async ({ args, ctx }) => (await (await octo(ctx, args)).request('GET /repos/{owner}/{repo}/issues/{issue_number}/labels', { owner: args.owner, repo: args.repo, issue_number: args.issue_number })).data.map((l) => l.name),
  verify: ({ args, after }) => after.includes(args.label),
  inverse: ({ args }) => ({ tool: 'github_sample_unlabel', args: { owner: args.owner, repo: args.repo, issue_number: args.issue_number, label: args.label } })
});

/** Production tool: changes a repository's description (a repository-level setting, always production). */
export const sampleSetting = defineGithubWrite({
  name: 'github_sample_setting',
  description: 'Sample: change a repository description (production).',
  properties: { ...repoProps, description: { type: 'string', maxLength: 350 } },
  required: ['owner', 'repo', 'description'],
  declarations: { production: 'always' },
  target,
  read: async (args, ctx) => (await (await octo(ctx, args)).request('GET /repos/{owner}/{repo}', { owner: args.owner, repo: args.repo })).data,
  classify: () => ({ production: 'it changes repository settings' }),
  summarize: ({ args, before }) => `Change the description of ${args.owner}/${args.repo} from "${before.description ?? ''}" to "${args.description}"`,
  apply: async ({ args, ctx }) => (await octo(ctx, args)).request('PATCH /repos/{owner}/{repo}', { owner: args.owner, repo: args.repo, description: args.description }),
  readAfter: async ({ args, ctx }) => (await (await octo(ctx, args)).request('GET /repos/{owner}/{repo}', { owner: args.owner, repo: args.repo })).data,
  verify: ({ args, after }) => after.description === args.description,
  inverse: ({ args, before }) => ({ tool: 'github_sample_setting', args: { owner: args.owner, repo: args.repo, description: before.description ?? '' } }),
  present: ({ after }) => ({ description: after.description })
});

const mentions = (text) => [...String(text).matchAll(/(?:^|\s)@([A-Za-z0-9][A-Za-z0-9-]{0,38})/g)].map((m) => m[1]);

/** Message tool: comments on an issue; it notifies whoever it mentions. Outsiders need confirmation. */
export const sampleComment = defineGithubWrite({
  name: 'github_sample_comment',
  description: 'Sample: comment on an issue (notifies people it mentions).',
  properties: { ...repoProps, issue_number: { type: 'integer', minimum: 1 }, body: { type: 'string', maxLength: 5000 } },
  required: ['owner', 'repo', 'issue_number', 'body'],
  declarations: { production: 'never', notifies: true },
  target,
  read: async (args, ctx) => (await (await octo(ctx, args)).request('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', { owner: args.owner, repo: args.repo, issue_number: args.issue_number })).data.length,
  classify: ({ args }) => ({ notifies: mentions(args.body).filter((login) => !OWN_PEOPLE.includes(login)) }),
  summarize: ({ args }) => `Comment on ${args.owner}/${args.repo}#${args.issue_number}: "${args.body.slice(0, 80)}"`,
  apply: async ({ args, ctx }) => (await octo(ctx, args)).request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', { owner: args.owner, repo: args.repo, issue_number: args.issue_number, body: args.body }),
  readAfter: async ({ args, ctx }) => (await (await octo(ctx, args)).request('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', { owner: args.owner, repo: args.repo, issue_number: args.issue_number })).data.length,
  verify: ({ before, after }) => after === before + 1
});

/** Access tool: adds a collaborator (always an access change). */
export const sampleCollaborator = defineGithubWrite({
  name: 'github_sample_collaborator',
  description: 'Sample: invite a collaborator (access change).',
  properties: { ...repoProps, username: { type: 'string', maxLength: 39 }, permission: { type: 'string', enum: ['pull', 'push', 'admin'] } },
  required: ['owner', 'repo', 'username', 'permission'],
  declarations: { production: 'never', accessWidening: true },
  target,
  read: async (args, ctx) => (await octo(ctx, args)).request('GET /repos/{owner}/{repo}/collaborators', { owner: args.owner, repo: args.repo }).then((r) => r.data.map((c) => c.login)),
  classify: ({ args }) => ({ accessWidening: `${args.username} would get ${args.permission} access to ${args.owner}/${args.repo}`, notifies: [args.username] }),
  summarize: ({ args, before }) => `Give ${args.username} ${args.permission} access to ${args.owner}/${args.repo}; today ${before.includes(args.username) ? 'they already have access' : 'none'}`,
  apply: async ({ args, ctx }) => (await octo(ctx, args)).request('PUT /repos/{owner}/{repo}/collaborators/{username}', { owner: args.owner, repo: args.repo, username: args.username, permission: args.permission }),
  readAfter: async ({ args, ctx }) => (await octo(ctx, args)).request('GET /repos/{owner}/{repo}/collaborators', { owner: args.owner, repo: args.repo }).then((r) => r.data.map((c) => c.login)),
  verify: ({ args, after }) => after.includes(args.username)
});

/** Spend tool: assigns Copilot seats. The cost is computed from the price table, never from the arguments. */
export const sampleSeat = defineGithubWrite({
  name: 'github_sample_seat',
  description: 'Sample: assign Copilot seats (costs money).',
  properties: { owner: { type: 'string', maxLength: 39 }, usernames: { type: 'array', items: { type: 'string', maxLength: 39 }, minItems: 1, maxItems: 10 } },
  required: ['owner', 'usernames'],
  declarations: { production: 'never', spend: true },
  target: (args) => ({ owner: args.owner, scope: 'org' }),
  read: async (args, ctx) => (await octo(ctx, args)).request('GET /orgs/{org}/copilot/billing/seats', { org: args.owner }).then((r) => (r.data.seats ?? []).map((s) => s.assignee.login)),
  classify: ({ args, before }) => ({ spendCents: args.usernames.filter((u) => !before.includes(u)).length * SEAT_PRICE_CENTS }),
  summarize: ({ args }) => `Assign Copilot seats in ${args.owner} to ${args.usernames.join(', ')}`,
  apply: async ({ args, ctx }) => (await octo(ctx, args)).request('POST /orgs/{org}/copilot/billing/selected_users', { org: args.owner, selected_usernames: args.usernames }),
  readAfter: async ({ args, ctx }) => (await octo(ctx, args)).request('GET /orgs/{org}/copilot/billing/seats', { org: args.owner }).then((r) => (r.data.seats ?? []).map((s) => s.assignee.login)),
  verify: ({ args, after }) => args.usernames.every((u) => after.includes(u))
});

export const SAMPLE_TOOLS = [sampleLabel, sampleSetting, sampleComment, sampleCollaborator, sampleSeat];
