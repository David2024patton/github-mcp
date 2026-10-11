// Pull requests (E-1). Reads: list, get (with review decision, unresolved threads and the required checks at the exact head), diff,
// files, commits. Text written by people without push access travels with its author_association so the dispatcher marks it untrusted.
import { listAll, graphql } from '../github/client.js';
import { ciState } from '../github/ci-state.js';
import { defineRead } from './define-read.js';
import { plain, readerFor } from './github-read.js';

const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const NUMBER = { type: 'integer', minimum: 1, description: 'Pull request number' };
const MAX = { type: 'integer', minimum: 1, maximum: 300, description: 'Default 50' };
const DIFF_CAP = 30000;

const PR_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewDecision isDraft reviewThreads(first: 100) { totalCount nodes { isResolved } } } }
}`;

export const prList = defineRead({
  name: 'github_pr_list', area: 'pr', audience: ['B', 'Op'], summaryType: 'pull_request',
  description: 'Pull requests by state, base branch, head branch or label; newest first.',
  properties: { owner: OWNER, repo: REPO, state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Default open' }, base: { type: 'string', maxLength: 250 },
    head: { type: 'string', maxLength: 250, description: 'Head branch as "branch" (same repository) or "owner:branch"' }, author: { type: 'string', maxLength: 39, description: 'Only pull requests opened by this login' },
    label: { type: 'string', maxLength: 100 }, max: MAX },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const head = args.head ? (args.head.includes(':') ? args.head : `${owner}:${args.head}`) : undefined;
    const max = args.max ?? 50;
    // Author and label are not filters on this endpoint, so they are applied here; ask GitHub for enough to still fill `max`.
    const filtered = Boolean(args.author || args.label);
    const { items, capped } = await listAll(octokit, 'GET /repos/{owner}/{repo}/pulls', { owner, repo: args.repo, state: args.state ?? 'open', sort: 'created', direction: 'desc',
      ...(args.base ? { base: args.base } : {}), ...(head ? { head } : {}) }, { max: filtered ? 300 : max });
    const kept = items.filter((p) => (!args.author || p.user?.login?.toLowerCase() === args.author.toLowerCase()) && (!args.label || p.labels?.some((l) => l.name === args.label))).slice(0, max);
    return { count: kept.length, ...(capped ? { more_exist: true } : {}), items: kept };
  })
});

export const prGet = defineRead({
  name: 'github_pr_get', area: 'pr', audience: ['B', 'Op'],
  description: 'One pull request: state, draft, head SHA, mergeable, review decision, unresolved threads and the required checks at the head.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER },
  required: ['repo', 'number'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const pr = (await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', { owner, repo: args.repo, pull_number: args.number })).data;
    let review = { unknown: 'Review decision and threads could not be read.' };
    try {
      const node = (await graphql(octokit, PR_QUERY, { owner, repo: args.repo, number: args.number })).repository?.pullRequest;
      if (node) review = { decision: node.reviewDecision ?? 'none', threads: node.reviewThreads.totalCount, unresolved_threads: node.reviewThreads.nodes.filter((t) => !t.isResolved).length,
        ...(node.reviewThreads.totalCount > node.reviewThreads.nodes.length ? { threads_note: 'Only the first 100 threads were counted.' } : {}) };
    } catch { /* keep the plain "unknown" note */ }
    let checks = { unknown: 'The required checks could not be read.' };
    if (pr.state === 'open') {
      try { checks = await ciState(octokit, { owner, repo: args.repo, branch: pr.base.ref, sha: pr.head.sha }); } catch { /* keep the note */ }
    }
    return { number: pr.number, title: pr.title, state: pr.state, draft: pr.draft, merged: pr.merged, user: pr.user?.login, head: pr.head?.ref, head_sha: pr.head?.sha, base: pr.base?.ref,
      mergeable: pr.mergeable, mergeable_state: pr.mergeable_state, labels: pr.labels?.map((l) => l.name), commits: pr.commits, changed_files: pr.changed_files, additions: pr.additions, deletions: pr.deletions,
      body: pr.body, author_association: pr.author_association, html_url: pr.html_url, review, required_checks: checks };
  })
});

export const prGetDiff = defineRead({
  name: 'github_pr_get_diff', area: 'pr', audience: ['B'],
  description: 'The pull request\'s diff as text; long diffs are cut (a handle holds the rest).',
  properties: { owner: OWNER, repo: REPO, number: NUMBER },
  required: ['repo', 'number'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const res = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', { owner, repo: args.repo, pull_number: args.number, headers: { accept: 'application/vnd.github.diff' } });
    const raw = res.data;
    const text = typeof raw === 'string' ? raw : (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) ? new TextDecoder().decode(raw) : String(raw ?? '');
    return { number: args.number, characters: text.length, ...(text.length > DIFF_CAP ? { cut_at: DIFF_CAP } : {}), diff: text.slice(0, DIFF_CAP) };
  })
});

export const prListFiles = defineRead({
  name: 'github_pr_list_files', area: 'pr', audience: ['B'],
  description: 'Files changed by a pull request with additions, deletions and a short patch each.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, max: MAX },
  required: ['repo', 'number'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { items, capped } = await listAll(octokit, 'GET /repos/{owner}/{repo}/pulls/{pull_number}/files', { owner, repo: args.repo, pull_number: args.number }, { max: args.max ?? 50 });
    return { count: items.length, ...(capped ? { more_exist: true } : {}),
      items: items.map((f) => ({ path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, previous_path: f.previous_filename, patch: f.patch ? f.patch.slice(0, 1500) : undefined, ...(f.patch && f.patch.length > 1500 ? { patch_cut: true } : {}) })) };
  })
});

export const prListCommits = defineRead({
  name: 'github_pr_list_commits', area: 'pr', audience: ['B'], summaryType: 'commit',
  description: 'Commits in a pull request, oldest first.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, max: MAX },
  required: ['repo', 'number'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { items, capped } = await listAll(octokit, 'GET /repos/{owner}/{repo}/pulls/{pull_number}/commits', { owner, repo: args.repo, pull_number: args.number }, { max: args.max ?? 50 });
    return { count: items.length, ...(capped ? { more_exist: true } : {}), items };
  })
});

const defs = [prList, prGet, prGetDiff, prListFiles, prListCommits];
export const tools = defs.map((d) => d.tool);
export const handlers = Object.fromEntries(defs.map((d) => [d.tool.name, d.handler]));
