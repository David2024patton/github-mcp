// F-1: Issue triage reads. GitHub's /issues collection also contains PRs;
// refill pages before applying the requested issue limit.
import { listAll } from '../github/client.js';
import { defineRead } from './define-read.js';
import { plain, readerFor } from './github-read.js';

const OWNER = { type: 'string', maxLength: 39 };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const NUMBER = { type: 'integer', minimum: 1 };
const MAX = { type: 'integer', minimum: 1, maximum: 100, description: 'Default 30' };
const issueBrief = (i) => ({
  number: i.number, id: i.id, title: i.title, state: i.state,
  state_reason: i.state_reason, body: i.body, author: i.user?.login,
  author_association: i.author_association, labels: (i.labels ?? []).map(l => typeof l === 'string' ? l : l.name),
  assignees: (i.assignees ?? []).map(a => a.login),
  milestone: i.milestone?.number ?? null, type: i.type?.name ?? i.type ?? null, comments: i.comments,
  created_at: i.created_at, updated_at: i.updated_at, closed_at: i.closed_at, html_url: i.html_url
});

export const issueList = defineRead({
  name: 'github_issue_list', area: 'issue', audience: ['B', 'Op'], summaryType: 'issue',
  description: 'List real issues by state, label, assignee or milestone; refill pages to exclude PRs.',
  properties: { owner: OWNER, repo: REPO, state: { type: 'string', enum: ['open', 'closed', 'all'] },
    labels: { type: 'string', maxLength: 250 }, type: { type: 'string', maxLength: 100 }, assignee: { type: 'string', maxLength: 39 },
    milestone: { type: 'string', maxLength: 50 }, max: MAX },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const want = args.max ?? 30;
    const items = [];
    let scanned = 0; let exhausted = false;
    // Never return a short issue page solely because GitHub interspersed PRs.
    for (let page = 1; page <= 10 && items.length < want; page++) {
      const params = { owner, repo: args.repo, state: args.state ?? 'open', per_page: 100, page,
        ...(args.labels !== undefined ? { labels: args.labels } : {}),
        ...(args.type !== undefined ? { type: args.type } : {}),
        ...(args.assignee !== undefined ? { assignee: args.assignee } : {}),
        ...(args.milestone !== undefined ? { milestone: args.milestone } : {}) };
      const batch = (await octokit.request('GET /repos/{owner}/{repo}/issues', params)).data;
      if (!Array.isArray(batch)) throw new TypeError('GitHub did not return a list of issues.');
      scanned += batch.length;
      for (const item of batch) if (!item.pull_request) items.push(issueBrief(item));
      if (batch.length < 100) { exhausted = true; break; }
    }
    return { count: Math.min(items.length, want), scanned, items: items.slice(0, want),
      ...(items.length > want || !exhausted ? { more_may_exist: true } : {}),
      ...(!exhausted && items.length < want ? { scan_capped: true, note: 'Stopped after ten complete pages; matching issues may remain.' } : {}) };
  })
});

export const issueGet = defineRead({
  name: 'github_issue_get', area: 'issue', audience: ['B', 'Op'],
  description: 'Read an issue and optionally its sub-issues and blocked-by/blocking relationships.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, includeRelations: { type: 'boolean', description: 'Read GitHub issue relationships too' } },
  required: ['repo', 'number'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const p = { owner, repo: args.repo, issue_number: args.number };
    const issue = (await octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}', p)).data;
    if (issue.pull_request) throw new TypeError('That number is a pull request; use github_pr_get.');
    const result = issueBrief(issue);
    if (args.includeRelations) {
      const routes = {
        sub_issues: 'GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues',
        blocked_by: 'GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by',
        blocking: 'GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocking'
      };
      result.relations = {};
      for (const [kind, route] of Object.entries(routes)) {
        try {
          const { items, capped } = await listAll(octokit, route, p, { max: 100 });
          result.relations[kind] = { items: items.map(x => ({ number: x.number, id: x.id, title: x.title, state: x.state, author_association: x.author_association ?? 'NONE' })), ...(capped ? { more_exist: true } : {}) };
        } catch (error) {
          // Permission/feature uncertainty is not evidence of zero relationships.
          result.relations[kind] = { available: false, reason: error?.status === 404 ? 'not_found_or_unavailable' : 'could_not_read' };
        }
      }
    }
    return result;
  })
});

export const issueListComments = defineRead({
  name: 'github_issue_list_comments', area: 'issue', audience: ['B', 'Op'],
  description: 'List issue or PR conversation comments, with author and association.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, max: MAX },
  required: ['repo', 'number'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { items, capped } = await listAll(octokit, 'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
      { owner, repo: args.repo, issue_number: args.number }, { max: args.max ?? 30 });
    return { count: items.length, ...(capped ? { more_exist: true } : {}),
      items: items.map(c => ({ id: c.id, body: c.body, author: c.user?.login, author_association: c.author_association, created_at: c.created_at, updated_at: c.updated_at, html_url: c.html_url })) };
  })
});

export const issueListTimeline = defineRead({
  name: 'github_issue_list_timeline', area: 'issue', audience: ['Op'],
  description: 'List bounded issue timeline events including links, closures and cross-references.',
  properties: { owner: OWNER, repo: REPO, number: NUMBER, max: MAX },
  required: ['repo', 'number'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { items, capped } = await listAll(octokit, 'GET /repos/{owner}/{repo}/issues/{issue_number}/timeline',
      { owner, repo: args.repo, issue_number: args.number }, { max: args.max ?? 30 });
    return { count: items.length, ...(capped ? { more_exist: true } : {}), items: items.map(x => ({
      id: x.id, event: x.event, actor: x.actor?.login, created_at: x.created_at,
      url: x.url, commit_id: x.commit_id, source: x.source?.issue ? { number: x.source.issue.number, repo: x.source.issue.repository?.full_name } : undefined
    })) };
  })
});

const all = [issueList, issueGet, issueListComments, issueListTimeline];
export const tools = all.map(d => d.tool);
export const handlers = Object.fromEntries(all.map(d => [d.tool.name, d.handler]));
