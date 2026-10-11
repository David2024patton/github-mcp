// GitHub Actions, read side (G-1 part 1): workflows, runs, one run with its jobs, job and run log summaries, runs waiting for approval.
// Logs are summarised, never dumped (BATCH-G G1): failed steps first, error lines, the last lines; the rest stays on GitHub.
import { readZip, summarizeLog, textOfBody } from '../github/log-summary.js';
import { defineRead } from './define-read.js';
import { plain, readerFor } from './github-read.js';

const OWNER = { type: 'string', maxLength: 39, description: 'GitHub account (default: the connection\'s default account)' };
const REPO = { type: 'string', minLength: 1, maxLength: 100 };
const RUN = { type: 'integer', minimum: 1, description: 'Workflow run id' };
const MAX = { type: 'integer', minimum: 1, maximum: 300, description: 'Default 30' };
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
/** Pages a GitHub list that wraps its items in an object (`{ total_count, workflow_runs: [...] }`) by page number, up to `max` items. */
async function listWrapped(octokit, route, params, key, max) {
  const items = [];
  for (let page = 1; items.length < max; page += 1) {
    const data = (await octokit.request(route, { ...params, per_page: 100, page })).data;
    const batch = data?.[key] ?? [];
    items.push(...batch);
    if (batch.length < 100 || items.length >= (data.total_count ?? Infinity)) break;
  }
  return { items: items.slice(0, max), capped: items.length > max };
}
const jobBrief = (j) => ({ id: j.id, name: j.name, status: j.status, conclusion: j.conclusion, started_at: j.started_at, completed_at: j.completed_at, runner: j.runner_name,
  failed_steps: (j.steps ?? []).filter((s) => s.conclusion === 'failure').map((s) => ({ number: s.number, name: s.name })), html_url: j.html_url });

export const actionsListWorkflows = defineRead({
  name: 'github_actions_list_workflows', area: 'actions', audience: ['B', 'Op'], summaryType: 'workflow',
  description: 'Workflows of a repository with their state and file path.',
  properties: { owner: OWNER, repo: REPO, max: MAX }, required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { items, capped } = await listWrapped(octokit, 'GET /repos/{owner}/{repo}/actions/workflows', { owner, repo: args.repo }, 'workflows', args.max ?? 30);
    return { count: items.length, ...(capped ? { more_exist: true } : {}), items };
  })
});

export const actionsListRuns = defineRead({
  name: 'github_actions_list_runs', area: 'actions', audience: ['B', 'Op'], summaryType: 'run',
  description: 'Workflow runs, newest first; filter by workflow, branch, event, status, actor or head commit.',
  properties: { owner: OWNER, repo: REPO, workflow: { type: 'string', maxLength: 250, description: 'Workflow file name (ci.yml) or id' }, branch: { type: 'string', maxLength: 250 },
    event: { type: 'string', maxLength: 50 }, status: { type: 'string', maxLength: 30, description: 'queued, in_progress, completed, waiting, success, failure, cancelled …' },
    actor: { type: 'string', maxLength: 39 }, headSha: { type: 'string', minLength: 7, maxLength: 40 }, max: MAX },
  required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const filters = { ...(args.branch ? { branch: args.branch } : {}), ...(args.event ? { event: args.event } : {}), ...(args.status ? { status: args.status } : {}),
      ...(args.actor ? { actor: args.actor } : {}), ...(args.headSha ? { head_sha: args.headSha } : {}) };
    const route = args.workflow ? 'GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs' : 'GET /repos/{owner}/{repo}/actions/runs';
    const { items, capped } = await listWrapped(octokit, route, { owner, repo: args.repo, ...(args.workflow ? { workflow_id: args.workflow } : {}), ...filters }, 'workflow_runs', args.max ?? 30);
    return { count: items.length, ...(capped ? { more_exist: true } : {}), items };
  })
});

export const actionsGetRun = defineRead({
  name: 'github_actions_get_run', area: 'actions', audience: ['B', 'Op'],
  description: 'One workflow run: status, conclusion, attempt, timing, and every job with its failed steps.',
  properties: { owner: OWNER, repo: REPO, runId: RUN }, required: ['repo', 'runId'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const p = { owner, repo: args.repo, run_id: args.runId };
    const run = (await octokit.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}', p)).data;
    const { items: jobs } = await listWrapped(octokit, 'GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs', { ...p, filter: 'latest' }, 'jobs', 100);
    return { id: run.id, name: run.name, title: run.display_title, event: run.event, status: run.status, conclusion: run.conclusion, branch: run.head_branch, head_sha: run.head_sha,
      run_number: run.run_number, run_attempt: run.run_attempt, actor: run.actor?.login, created_at: run.created_at, updated_at: run.updated_at, html_url: run.html_url, jobs: jobs.map(jobBrief) };
  })
});

export const actionsGetJobLog = defineRead({
  name: 'github_actions_get_job_log', area: 'actions', audience: ['B', 'Op'],
  description: 'A job\'s log in short form: failed steps first, error lines, and the last lines. The full log stays on GitHub.',
  properties: { owner: OWNER, repo: REPO, jobId: { type: 'integer', minimum: 1 }, tailLines: { type: 'integer', minimum: 10, maximum: 2000, description: 'Last lines to keep (default 400)' } },
  required: ['repo', 'jobId'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const p = { owner, repo: args.repo, job_id: args.jobId };
    const job = (await octokit.request('GET /repos/{owner}/{repo}/actions/jobs/{job_id}', p)).data;
    const res = await octokit.request('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs', p);
    const summary = summarizeLog(textOfBody(res.data), { tailLines: args.tailLines ?? 400 });
    return { job: jobBrief(job), failed_steps_first: jobBrief(job).failed_steps, ...summary };
  })
});

export const actionsGetRunLogsSummary = defineRead({
  name: 'github_actions_get_run_logs_summary', area: 'actions', audience: ['B', 'Op'],
  description: 'Why a run failed: for each failed job, the failing steps and their error lines, read from the run\'s log archive.',
  properties: { owner: OWNER, repo: REPO, runId: RUN }, required: ['repo', 'runId'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const p = { owner, repo: args.repo, run_id: args.runId };
    const { items: jobs } = await listWrapped(octokit, 'GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs', { ...p, filter: 'latest' }, 'jobs', 100);
    const failed = jobs.filter((j) => j.conclusion === 'failure' || (j.steps ?? []).some((s) => s.conclusion === 'failure'));
    if (!failed.length) return { run_id: args.runId, failed_jobs: [], note: 'No job in this run failed.' };
    const res = await octokit.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs', p);
    const bytes = res.data instanceof ArrayBuffer || ArrayBuffer.isView(res.data) ? res.data : Buffer.from(String(res.data ?? ''), 'binary');
    if ((bytes.byteLength ?? bytes.length) > MAX_ARCHIVE_BYTES) throw new TypeError('The log archive is over 50 MB, so it is not read here. Use github_actions_get_job_log for one job instead.');
    const entries = readZip(bytes);
    return { run_id: args.runId, failed_jobs: failed.map((job) => {
      const steps = (job.steps ?? []).filter((s) => s.conclusion === 'failure');
      const mine = entries.filter((e) => e.name.startsWith(`${job.name}/`) || e.name.endsWith(`_${job.name}.txt`) || e.name === `${job.name}.txt`);
      const onStep = mine.filter((e) => steps.some((s) => e.name.includes(s.name)));
      const errors = [...new Set((onStep.length ? onStep : mine).flatMap((e) => summarizeLog(e.text, { tailLines: 1, maxErrors: 40 }).errors))].slice(0, 40);
      return { ...jobBrief(job), error_lines: errors, ...(mine.length ? {} : { note: 'No log file for this job was found in the archive.' }) };
    }) };
  })
});

export const actionsListPendingDeployments = defineRead({
  name: 'github_actions_list_pending_deployments', area: 'actions', audience: ['Op'],
  description: 'Runs waiting for someone to approve a deployment, with the environment each is waiting on.',
  properties: { owner: OWNER, repo: REPO }, required: ['repo'],
  handler: (args, ctx) => plain(async () => {
    const { owner, octokit } = await readerFor(args, ctx);
    const { items: runs } = await listWrapped(octokit, 'GET /repos/{owner}/{repo}/actions/runs', { owner, repo: args.repo, status: 'waiting' }, 'workflow_runs', 20);
    const waiting = [];
    for (const run of runs) {
      const pending = (await octokit.request('GET /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments', { owner, repo: args.repo, run_id: run.id })).data;
      waiting.push({ run_id: run.id, name: run.name, branch: run.head_branch, html_url: run.html_url,
        environments: pending.map((d) => ({ id: d.environment?.id, name: d.environment?.name, current_user_can_approve: d.current_user_can_approve, wait_timer: d.wait_timer, reviewers: (d.reviewers ?? []).map((r) => r.reviewer?.login ?? r.reviewer?.slug) })) });
    }
    return { count: waiting.length, items: waiting };
  })
});

const defs = [actionsListWorkflows, actionsListRuns, actionsGetRun, actionsGetJobLog, actionsGetRunLogsSummary, actionsListPendingDeployments];
export const tools = defs.map((d) => d.tool);
export const handlers = Object.fromEntries(defs.map((d) => [d.tool.name, d.handler]));
