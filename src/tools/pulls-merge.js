// Merging (E-2 part 1): merge at an exact head, merge in the background, and auto-merge. A merge happens only when (1) the caller names
// the exact head commit it looked at (`expectedHeadSha`), (2) the pull request still has that head, is open and not a draft, and (3) every
// required check is green at that head (`ciState`, BATCH-E E1). GitHub is then told the same commit (`sha`), so a push that lands in between
// is refused by GitHub too. The default method is a merge commit. Rules are never bypassed: the `bypass` option of GitHub's background
// merge is never sent by any tool here (tested), and GitHub's own rules still apply on top of ours.
import { graphql } from '../github/client.js';
import { ciState } from '../github/ci-state.js';
import { defineGithubWrite } from './define-github-write.js';
import { missing, octo, ownerOf, refusal, slug } from './github-write.js';
import { productionReason } from './production-guard.js';

const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const PR = { type: 'integer', minimum: 1, description: 'Pull request number' };
const HEAD = { type: 'string', minLength: 40, maxLength: 40, description: 'The exact head commit you read and whose checks passed' };
const METHOD = { type: 'string', enum: ['merge', 'squash', 'rebase'], description: 'Default merge (a merge commit)' };
const TITLE = { type: 'string', maxLength: 256, description: 'Merge commit title' };
const MESSAGE = { type: 'string', maxLength: 5000, description: 'Merge commit message' };
const short = (sha) => String(sha ?? '').slice(0, 7);
const target = (args, ctx) => ({ owner: ownerOf(args, ctx), repo: args.repo, scope: 'repo' });
const label = (t, n) => `pull request #${n} in ${slug(t.owner, t.repo)}`;

/** Reads the pull request and, when it is open, whether its required checks are green at the head, and whether the base is production. */
async function readPlan(args, ctx, t, { checks = true } = {}) {
  const octokit = await octo(ctx, t.owner);
  const pr = await missing(async () => (await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', { owner: t.owner, repo: t.repo, pull_number: args.number })).data);
  if (!pr) return { pr: null };
  const plan = { pr: { number: pr.number, state: pr.state, merged: pr.merged, draft: pr.draft, mergeable: pr.mergeable, mergeable_state: pr.mergeable_state, head_sha: pr.head?.sha, head: pr.head?.ref, base: pr.base?.ref, node_id: pr.node_id, title: pr.title, auto_merge: pr.auto_merge ?? null } };
  if (checks && pr.state === 'open' && !pr.merged) plan.ci = await ciState(octokit, { owner: t.owner, repo: t.repo, baseBranch: pr.base.ref, headSha: pr.head.sha });
  return plan;
}

/** Plain-language reasons this pull request must not be merged now (empty = go ahead). */
export function blockers(plan, args) {
  const { pr, ci } = plan;
  if (!pr) return [`There is no pull request #${args.number}.`];
  if (pr.merged) return ['It is already merged.'];
  if (pr.state !== 'open') return ['It is closed. Reopen it first.'];
  const out = [];
  if (pr.head_sha !== args.expectedHeadSha) out.push(`New commits arrived: the head is now ${short(pr.head_sha)}, not ${short(args.expectedHeadSha)}. The checks you saw are out of date; read the pull request again.`);
  if (pr.draft) out.push('It is a draft. Mark it ready for review first.');
  if (pr.mergeable === false) out.push(`GitHub says it cannot be merged (${pr.mergeable_state ?? 'conflicts'}). Update the branch or resolve conflicts first.`);
  if (!ci || ci.green === null) out.push(`The checks could not be verified (${(ci?.errors ?? ['unknown']).join('; ')}), so it is not merged.`);
  else if (!ci.green) out.push(`Required checks are not green at ${short(pr.head_sha)}: ${ci.problems.join('; ')}.`);
  return out;
}

const productionOf = async (ctx, t, plan) => ({ production: plan.pr ? await productionReason(ctx, { ...t, ref: plan.pr.base }) : null });
const PROPS = { owner: OWNER, repo: REPO, number: PR, expectedHeadSha: HEAD, method: METHOD, title: TITLE, message: MESSAGE };
const mergeBody = (args) => ({ sha: args.expectedHeadSha, merge_method: args.method ?? 'merge', ...(args.title ? { commit_title: args.title } : {}), ...(args.message ? { commit_message: args.message } : {}) });
const afterPr = (ctx, t, number) => missing(async () => (await (await octo(ctx, t.owner)).request('GET /repos/{owner}/{repo}/pulls/{pull_number}', { owner: t.owner, repo: t.repo, pull_number: number })).data);

const prMerge = defineGithubWrite({
  name: 'github_pr_merge', area: 'pr', audience: ['B'],
  description: 'Merge a pull request at the exact head you read, only when every required check is green at that head. Default method: merge commit. Rules are never bypassed.',
  properties: PROPS, required: ['repo', 'number', 'expectedHeadSha'],
  declarations: { production: 'when-target', confirm: 'always' },
  target,
  read: (args, ctx, t) => readPlan(args, ctx, t),
  classify: ({ ctx, target: t, before }) => productionOf(ctx, t, before),
  summarize: ({ args, before, target: t }) => {
    const why = blockers(before, args);
    return why.length ? `Cannot merge ${label(t, args.number)}: ${why.join(' ')}` : `Merge ${label(t, args.number)} (${before.pr.head} into ${before.pr.base}) at ${short(args.expectedHeadSha)} with ${args.method ?? 'merge'}; ${before.ci.checks.length} check${before.ci.checks.length === 1 ? '' : 's'} green`;
  },
  apply: async ({ args, ctx, before, target: t }) => {
    const why = blockers(before, args);
    if (why.length) throw refusal(why.join(' '), 409);
    return (await octo(ctx, t.owner)).request('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge', { owner: t.owner, repo: t.repo, pull_number: args.number, ...mergeBody(args) });
  },
  readAfter: ({ args, ctx, target: t }) => afterPr(ctx, t, args.number),
  verify: ({ after, response }) => after?.merged === true && response?.data?.merged === true,
  inverse: () => null,
  present: ({ after, response }) => ({ number: after?.number, merged: after?.merged, merge_commit: response?.data?.sha, base: after?.base?.ref, html_url: after?.html_url })
});

const prMergeAsync = defineGithubWrite({
  name: 'github_pr_merge_async', area: 'pr', audience: ['B'],
  description: 'Same checks as github_pr_merge, but GitHub merges in the background (needed for stacked pull requests). Answers merged, failed, or pending with an id; read the pull request later for the result.',
  properties: PROPS, required: ['repo', 'number', 'expectedHeadSha'],
  declarations: { production: 'when-target', confirm: 'always' },
  target,
  read: (args, ctx, t) => readPlan(args, ctx, t),
  classify: ({ ctx, target: t, before }) => productionOf(ctx, t, before),
  summarize: ({ args, before, target: t }) => {
    const why = blockers(before, args);
    return why.length ? `Cannot merge ${label(t, args.number)}: ${why.join(' ')}` : `Merge ${label(t, args.number)} in the background at ${short(args.expectedHeadSha)} with ${args.method ?? 'merge'}; ${before.ci.checks.length} check${before.ci.checks.length === 1 ? '' : 's'} green`;
  },
  apply: async ({ args, ctx, before, target: t }) => {
    const why = blockers(before, args);
    if (why.length) throw refusal(why.join(' '), 409);
    try {
      return await (await octo(ctx, t.owner)).request('PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async', { owner: t.owner, repo: t.repo, pull_number: args.number, ...mergeBody(args), merge_action: 'direct_merge' });
    } catch (error) {
      // A merge for this pull request is already pending: GitHub answers 409 with that request; report it instead of failing.
      if (error?.status === 409 && error?.response?.data?.status === 'pending') return { status: 202, data: error.response.data, headers: error.response.headers ?? {} };
      throw error;
    }
  },
  readAfter: async ({ args, ctx, target: t, response }) => ({ result: response.data, pr: await afterPr(ctx, t, args.number) }),
  verify: ({ after, response }) => {
    const status = response?.data?.status;
    if (status === 'merged') return after?.pr?.merged === true;
    return status === 'pending' || status === 'enqueued';
  },
  inverse: () => null,
  present: ({ after, response }) => ({ status: response.data.status, ...(response.data.details?.uuid ? { uuid: response.data.details.uuid } : {}), ...(response.data.status === 'failed' ? { reason: response.data.details?.message } : {}),
    merged: after?.pr?.merged === true, html_url: after?.pr?.html_url, ...(response.data.status === 'pending' ? { note: 'GitHub is merging in the background; read the pull request again for the result.' } : {}) })
});

const ENABLE = 'mutation($input: EnablePullRequestAutoMergeInput!) { enablePullRequestAutoMerge(input: $input) { pullRequest { number } } }';
const DISABLE = 'mutation($input: DisablePullRequestAutoMergeInput!) { disablePullRequestAutoMerge(input: $input) { pullRequest { number } } }';
const METHODS = { merge: 'MERGE', squash: 'SQUASH', rebase: 'REBASE' };

const prSetAutoMerge = defineGithubWrite({
  name: 'github_pr_set_auto_merge', area: 'pr', audience: ['B'],
  description: 'Turn auto-merge on (GitHub merges when its own rules pass, only at the head you name) or off.',
  properties: { owner: OWNER, repo: REPO, number: PR, enabled: { type: 'boolean', description: 'true = turn on, false = turn off' }, expectedHeadSha: HEAD, method: METHOD, title: TITLE, message: MESSAGE },
  required: ['repo', 'number', 'enabled'],
  declarations: { production: 'when-target', confirm: 'always' },
  target: (args, ctx) => { if (args.enabled && !args.expectedHeadSha) throw new TypeError('To turn auto-merge on, give expectedHeadSha: the head commit you read.'); return target(args, ctx); },
  read: (args, ctx, t) => readPlan(args, ctx, t, { checks: false }),
  classify: ({ args, ctx, target: t, before }) => (args.enabled ? productionOf(ctx, t, before) : {}),
  summarize: ({ args, before, target: t }) => {
    if (!before.pr) return `There is no pull request #${args.number} in ${slug(t.owner, t.repo)}`;
    if (!args.enabled) return `Turn auto-merge off for ${label(t, args.number)}`;
    if (before.pr.head_sha !== args.expectedHeadSha) return `Cannot turn auto-merge on: the head is now ${short(before.pr.head_sha)}, not ${short(args.expectedHeadSha)}`;
    return `Turn auto-merge on for ${label(t, args.number)}: GitHub will merge it with ${args.method ?? 'merge'} at ${short(args.expectedHeadSha)} once its own rules pass`;
  },
  apply: async ({ args, ctx, before, target: t }) => {
    if (!before.pr) throw refusal(`There is no pull request #${args.number}.`, 404);
    if (before.pr.merged || before.pr.state !== 'open') throw refusal(`Pull request #${args.number} is not open.`);
    const octokit = await octo(ctx, t.owner);
    if (!args.enabled) return { data: await graphql(octokit, DISABLE, { input: { pullRequestId: before.pr.node_id } }) };
    if (before.pr.head_sha !== args.expectedHeadSha) throw refusal(`New commits arrived: the head is ${short(before.pr.head_sha)}, not ${short(args.expectedHeadSha)}. Read the pull request again.`, 409);
    return { data: await graphql(octokit, ENABLE, { input: { pullRequestId: before.pr.node_id, expectedHeadOid: args.expectedHeadSha, mergeMethod: METHODS[args.method ?? 'merge'], ...(args.title ? { commitHeadline: args.title } : {}), ...(args.message ? { commitBody: args.message } : {}) } }) };
  },
  readAfter: ({ args, ctx, target: t }) => afterPr(ctx, t, args.number),
  verify: ({ args, after }) => !!after && (args.enabled ? !!after.auto_merge : !after.auto_merge),
  inverse: ({ args, target: t }) => (args.enabled ? { tool: 'github_pr_set_auto_merge', args: { owner: t.owner, repo: t.repo, number: args.number, enabled: false } } : null),
  present: ({ args, after }) => ({ number: after?.number, auto_merge: !!after?.auto_merge, enabled: args.enabled })
});

const all = [prMerge, prMergeAsync, prSetAutoMerge];
export const tools = all.map((d) => d.tool);
export const handlers = Object.fromEntries(all.map((d) => [d.tool.name, d.handler]));
