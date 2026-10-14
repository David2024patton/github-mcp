// F-1 advanced issue relationships. All referenced issue database IDs are read
// from the selected GitHub repository, never accepted as unverified raw IDs.
import { listAll } from '../github/client.js';
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const NUMBER = { type: 'integer', minimum: 1 };
const target = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' });
const issueRoute = 'GET /repos/{owner}/{repo}/issues/{issue_number}';
async function issue(ctx, t, number) {
  const item = await missing(async () => (await (await octo(ctx, t.owner)).request(issueRoute,
    { owner: t.owner, repo: t.repo, issue_number: number })).data);
  if (!item || item.pull_request || !Number.isSafeInteger(item.id)) throw refusal(`Issue #${number} could not be verified as a repository-owned issue.`);
  return item;
}
async function relationList(ctx, t, number, kind) {
  const routes = {
    sub: 'GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues',
    blocked: 'GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by'
  };
  return listAll(await octo(ctx, t.owner), routes[kind], {
    owner: t.owner, repo: t.repo, issue_number: number
  }, { max: 100 });
}
const contains = (items, id) => items.some(x => x.id === id);
const summary = (args, t, name) => `${name} on #${args.number} in ${slug(t.owner, t.repo)}`;

export const issueSetSubIssue = defineGithubWrite({
  name: 'github_issue_set_sub_issue', area: 'issue', audience: ['Op'],
  description: 'Add, remove or reorder same-repo sub-issues with exact ID and relationship readback.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, childNumber: NUMBER,
    mode: { type: 'string', enum: ['add','remove','reorder'] },
    anchorNumber: NUMBER, placement: { type: 'string', enum: ['before','after'] } },
  required: ['repo','number','childNumber','mode'],
  declarations: { production: 'never' },
  target: (args, ctx) => {
    if (args.number === args.childNumber) throw new TypeError('A parent issue cannot be its own sub-issue.');
    if (args.mode === 'reorder' && (!args.anchorNumber || !args.placement || args.childNumber === args.anchorNumber))
      throw new TypeError('Reorder needs a different anchor issue and before/after placement.');
    if (args.mode !== 'reorder' && (args.anchorNumber !== undefined || args.placement !== undefined))
      throw new TypeError('Anchor and placement are for reorder only.');
    return target(args, ctx);
  },
  read: async (args, ctx, t) => {
    const parent = await issue(ctx, t, args.number);
    const child = await issue(ctx, t, args.childNumber);
    const anchor = args.mode === 'reorder' ? await issue(ctx, t, args.anchorNumber) : null;
    const before = await relationList(ctx, t, args.number, 'sub');
    if (args.mode === 'reorder' && (!contains(before.items, child.id) || !contains(before.items, anchor.id) || before.capped))
      throw refusal('Child and anchor must be fully verified under this parent before reordering.');
    return { parentId: parent.id, childId: child.id, anchorId: anchor?.id ?? null,
      previous: before.items.map(x => x.id), capped: before.capped };
  },
  classify: () => ({}),
  summarize: ({ args, target: t }) => summary(args, t, `Sub-issue ${args.mode} #${args.childNumber}`),
  apply: async ({ args, ctx, target: t, before }) => {
    const o = await octo(ctx, t.owner), p = { owner: t.owner, repo: t.repo, issue_number: args.number };
    if (args.mode === 'add') return o.request('POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues',
      { ...p, sub_issue_id: before.childId });
    if (args.mode === 'remove') return o.request('DELETE /repos/{owner}/{repo}/issues/{issue_number}/sub_issue',
      { ...p, sub_issue_id: before.childId });
    return o.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}/sub_issues/priority',
      { ...p, sub_issue_id: before.childId,
        ...(args.placement === 'before' ? { before_id: before.anchorId } : { after_id: before.anchorId }) });
  },
  readAfter: ({ args, ctx, target: t }) => relationList(ctx, t, args.number, 'sub'),
  verify: ({ args, before, after }) => {
    if (!after || after.capped) return false;
    const ids = after.items.map(x => x.id), childAt = ids.indexOf(before.childId), anchorAt = ids.indexOf(before.anchorId);
    if (args.mode === 'add') return childAt >= 0;
    if (args.mode === 'remove') return childAt < 0;
    return childAt >= 0 && anchorAt >= 0 && (args.placement === 'before' ? childAt + 1 === anchorAt : anchorAt + 1 === childAt);
  },
  inverse: ({ args, before, target: t }) => args.mode === 'reorder' ? null :
    ({ tool: 'github_issue_set_sub_issue', args: { owner: t.owner, repo: t.repo,
      number: args.number, childNumber: args.childNumber, mode: args.mode === 'add' ? 'remove' : 'add' } }),
  present: ({ args, before, after }) => ({ number: args.number, childNumber: args.childNumber,
    mode: args.mode, childId: before.childId, children: after.items.map(x => ({ id: x.id, number: x.number, title: x.title, author_association: x.author_association ?? 'NONE' })) })
});

export const issueSetDependency = defineGithubWrite({
  name: 'github_issue_set_dependency', area: 'issue', audience: ['Op'],
  description: 'Add or remove a verified same-repo blocked-by relationship and confirm the exact ID.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, blockingNumber: NUMBER,
    mode: { type: 'string', enum: ['add','remove'] } },
  required: ['repo','number','blockingNumber','mode'],
  declarations: { production: 'never' },
  target: (args, ctx) => {
    if (args.number === args.blockingNumber) throw new TypeError('An issue cannot block itself.');
    return target(args, ctx);
  },
  read: async (args, ctx, t) => {
    const [a, blocking] = await Promise.all([issue(ctx, t, args.number), issue(ctx, t, args.blockingNumber)]);
    return { issueId: a.id, blockingId: blocking.id };
  },
  classify: () => ({}),
  summarize: ({ args, target: t }) => summary(args, t, `${args.mode} block #${args.blockingNumber}`),
  apply: async ({ args, ctx, target: t, before }) => {
    const o = await octo(ctx, t.owner), p = { owner: t.owner, repo: t.repo, issue_number: args.number };
    return args.mode === 'add'
      ? o.request('POST /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by', { ...p, issue_id: before.blockingId })
      : o.request('DELETE /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by/{issue_id}', { ...p, issue_id: before.blockingId });
  },
  readAfter: ({ args, ctx, target: t }) => relationList(ctx, t, args.number, 'blocked'),
  verify: ({ args, before, after }) => !!after && (args.mode === 'add'
    ? contains(after.items, before.blockingId)
    : !after.capped && !contains(after.items, before.blockingId)),
  inverse: ({ args, target: t }) => ({ tool: 'github_issue_set_dependency', args: { owner: t.owner, repo: t.repo,
    number: args.number, blockingNumber: args.blockingNumber, mode: args.mode === 'add' ? 'remove' : 'add' } }),
  present: ({ args, before, after }) => ({ number: args.number, blockingNumber: args.blockingNumber,
    mode: args.mode, blockingId: before.blockingId,
    blocked_by: after.items.map(x => ({ id: x.id, number: x.number, title: x.title, author_association: x.author_association ?? 'NONE' })) })
});

const all = [issueSetSubIssue, issueSetDependency];
export const tools = all.map(d => d.tool);
export const handlers = Object.fromEntries(all.map(d => [d.tool.name, d.handler]));
