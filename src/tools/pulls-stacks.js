// E-2: discover and manage GitHub's first-class pull request stacks. GitHub validates the
// final mutation; this layer previews the exact order and refuses broken branch chains.
import { defineRead } from './define-read.js';
import { defineGithubWrite } from './define-github-write.js';
import { plain, readerFor } from './github-read.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const STACK = { type: 'integer', minimum: 1, description: 'GitHub stack number' };
const NUMBER = { type: 'integer', minimum: 1 };
const NUMBERS = { type: 'array', items: NUMBER, minItems: 1, maxItems: 30 };
const HEADS = { type: 'array', items: { type: 'string', pattern: '^[0-9a-fA-F]{40}$' }, minItems: 1, maxItems: 30 };
const stackRoute = 'GET /repos/{owner}/{repo}/stacks/{stack_number}';
const getStack = (client, owner, repo, number) => missing(async () =>
  (await client.request(stackRoute, { owner, repo, stack_number: number })).data);
const numbers = (stack) => (stack?.pull_requests ?? []).map((p) => p.number);
const compact = (stack) => ({
  number: stack.number, open: stack.open, base: stack.base?.ref,
  pull_requests: (stack.pull_requests ?? []).map((p) => ({
    number: p.number, state: p.state, draft: p.draft,
    head: p.head?.ref, head_sha: p.head?.sha, base: p.base?.ref
  }))
});

export const stackList = defineRead({
  name: 'github_pr_list_stacks', area: 'pr', audience: ['B'],
  description: 'List pull request stacks or inspect one stack, including the ordered pull requests and their branch refs.',
  properties: { owner: OWNER, repo: REPO, stackNumber: STACK, pullRequest: NUMBER,
    page: { type: 'integer', minimum: 1 }, max: { type: 'integer', minimum: 1, maximum: 100 } },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    if (args.stackNumber) {
      const stack = await getStack(octokit, owner, args.repo, args.stackNumber);
      return stack ? compact(stack) : { not_found: args.stackNumber };
    }
    const max = args.max ?? 30;
    const page = args.page ?? 1;
    const data = (await octokit.request('GET /repos/{owner}/{repo}/stacks', {
      owner, repo: args.repo, per_page: max, page,
      ...(args.pullRequest ? { pull_request: args.pullRequest } : {})
    })).data;
    const items = Array.isArray(data) ? data : [];
    return { items: items.map(compact), count: items.length, page,
      ...(items.length === max ? { next_page_possible: page + 1 } : {}) };
  })
});

const target = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' });
const getPr = (client, t, number) => missing(async () =>
  (await client.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
    owner: t.owner, repo: t.repo, pull_number: number
  })).data);

function validateArgs(args) {
  const list = args.pullRequestNumbers;
  if (args.action === 'create') {
    if (args.stackNumber !== undefined) throw new TypeError('To create a stack, omit stackNumber.');
    if (!list || list.length < 2) throw new TypeError('Creating a stack needs at least two ordered pull requests.');
  } else if (args.action === 'add') {
    if (!args.stackNumber || !list?.length) throw new TypeError('To add, give stackNumber and the ordered pull requests.');
  } else if (args.action === 'unstack') {
    if (!args.stackNumber || list !== undefined) throw new TypeError('To unstack, give stackNumber without pullRequestNumbers.');
  }
  if (list && new Set(list).size !== list.length) throw new TypeError('A pull request cannot appear twice in a stack.');
  if (args.expectedHeadShas && (!list || args.expectedHeadShas.length !== list.length))
    throw new TypeError('expectedHeadShas must match the ordered pull request list.');
}

function checkChain(args, before) {
  if (args.action === 'unstack') {
    if (!before.stack) throw refusal('That stack does not exist.', 404);
    return numbers(before.stack);
  }
  if (args.action === 'add' && !before.stack) throw refusal('That stack does not exist.', 404);
  const existing = args.action === 'add' ? numbers(before.stack) : [];
  const prior = before.stack?.pull_requests?.at(-1);
  let lastHead = prior?.head?.ref;
  before.prs.forEach((pr, i) => {
    if (!pr || pr.state !== 'open' || pr.merged_at)
      throw refusal('Pull request #' + args.pullRequestNumbers[i] + ' must exist and be open.');
    if (!pr.head?.ref || !pr.base?.ref) throw refusal('GitHub did not return both branch refs for pull request #' + pr.number + '.');
    if (pr.head?.repo?.full_name && pr.head.repo.full_name.toLowerCase() !== (before.owner + '/' + before.repo).toLowerCase())
      throw refusal('Stacked pull requests must have head branches in the same repository.');
    if (lastHead && pr.base.ref !== lastHead)
      throw refusal('Pull request #' + pr.number + ' bases on ' + pr.base.ref + ', not the previous head ' + lastHead + '.');
    if (args.expectedHeadShas?.[i] && pr.head.sha !== args.expectedHeadShas[i])
      throw refusal('Pull request #' + pr.number + ' has new commits; read it again.', 409);
    lastHead = pr.head.ref;
  });
  return [...existing, ...args.pullRequestNumbers];
}

const stackManage = defineGithubWrite({
  name: 'github_pr_stack_manage', area: 'pr', audience: ['B'],
  description: 'Create an ordered pull request stack, append PRs to a stack, or dissolve a stack without merging.',
  properties: { owner: OWNER, repo: REPO, action: { type: 'string', enum: ['create', 'add', 'unstack'] },
    stackNumber: STACK, pullRequestNumbers: NUMBERS, expectedHeadShas: HEADS },
  required: ['repo', 'action'],
  declarations: { production: 'never' },
  target: (args, ctx) => { validateArgs(args); return target(args, ctx); },
  read: async (args, ctx, t) => {
    const client = await octo(ctx, t.owner);
    const stack = args.stackNumber ? await getStack(client, t.owner, t.repo, args.stackNumber) : null;
    const prs = [];
    for (const n of args.pullRequestNumbers ?? []) prs.push(await getPr(client, t, n));
    return { owner: t.owner, repo: t.repo, stack, prs };
  },
  classify: () => ({}),
  summarize: ({ args, before, target: t }) => {
    const ordered = checkChain(args, before);
    return args.action === 'unstack'
      ? 'Dissolve stack #' + args.stackNumber + ' in ' + slug(t.owner, t.repo) + ' (' + ordered.length + ' PRs); GitHub keeps any locked PRs stacked.'
      : (args.action === 'create' ? 'Create a stack' : 'Append to stack #' + args.stackNumber) +
        ' in ' + slug(t.owner, t.repo) + ' in order: ' + ordered.join(' → ');
  },
  apply: async ({ args, before, ctx, target: t }) => {
    checkChain(args, before);
    const client = await octo(ctx, t.owner);
    const common = { owner: t.owner, repo: t.repo };
    if (args.action === 'create')
      return client.request('POST /repos/{owner}/{repo}/stacks', { ...common, pull_requests: args.pullRequestNumbers });
    return client.request(args.action === 'add'
      ? 'POST /repos/{owner}/{repo}/stacks/{stack_number}/add'
      : 'POST /repos/{owner}/{repo}/stacks/{stack_number}/unstack', {
      ...common, stack_number: args.stackNumber, ...(args.action === 'add' ? { pull_requests: args.pullRequestNumbers } : {})
    });
  },
  readAfter: async ({ args, before, response, ctx, target: t }) => {
    const number = args.stackNumber ?? response.data?.number;
    return number ? getStack(await octo(ctx, t.owner), t.owner, t.repo, number) : null;
  },
  verify: ({ args, before, after }) => {
    if (args.action === 'unstack') {
      const prior = numbers(before.stack);
      return !after || (numbers(after).length < prior.length && numbers(after).every((n) => prior.includes(n)));
    }
    return !!after && JSON.stringify(numbers(after)) === JSON.stringify(
      args.action === 'add' ? [...numbers(before.stack), ...args.pullRequestNumbers] : args.pullRequestNumbers
    );
  },
  inverse: () => null,
  present: ({ args, after, before }) => ({
    stack: after?.number ?? args.stackNumber, dissolved: args.action === 'unstack' && !after,
    pull_requests: numbers(after),
    ...(args.action === 'unstack' ? { removed_count: numbers(before.stack).length - numbers(after).length } : {})
  })
});

export const tools = [stackList.tool, stackManage.tool];
export const handlers = { [stackList.tool.name]: stackList.handler, [stackManage.tool.name]: stackManage.handler };
