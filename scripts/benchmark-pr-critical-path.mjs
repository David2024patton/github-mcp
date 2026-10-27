// C-5 controlled, read-only synthetic critical-path benchmark.
// Does not contact GitHub, use credentials, change a repository, or assert that
// these synthetic numbers predict end-to-end production latency.
import { performance } from 'node:perf_hooks';
import { ciState } from '../src/github/ci-state.js';
import { inspectPr } from '../src/tools/workflows-pr.js';

const DELAY = 25;
const pause = () => new Promise(resolve => setTimeout(resolve, DELAY));
const SHA = 'a'.repeat(40);
const routes = [
  'GET /repos/{owner}/{repo}/rules/branches/{branch}',
  'GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks',
  'GET /repos/{owner}/{repo}/commits/{ref}/check-runs',
  'GET /repos/{owner}/{repo}/commits/{ref}/status'
];
const payload = route => {
  if (route === routes[0]) return [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci' }] } }];
  if (route === routes[1]) return { contexts: ['ci'] };
  if (route === routes[2]) return { check_runs: [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success', started_at: '2026-10-26T00:00:00Z' }] };
  if (route === routes[3]) return { statuses: [] };
  throw new Error('Unknown synthetic route: ' + route);
};
const octokit = () => ({ async request(route) { await pause(); return { data: payload(route) }; } });
const ciArgs = { owner: 'example-org', repo: 'test', baseBranch: 'main', headSha: SHA };
const pr = { number: 5, head_sha: SHA, state: 'open', head: 'work', base: 'main',
  draft: false, merged: false, mergeable: true, checks: { green: true },
  threads: { unresolved: 0 }, review_decision: 'APPROVED' };
const context = () => ({
  now: Date.now,
  async callTool(name) {
    await pause();
    return { structuredContent: name === 'github_pr_get' ? pr : { items: [], count: 0 } };
  }
});
const measured = async fn => { const before = performance.now(); const value = await fn(); return { elapsedMs: +(performance.now() - before).toFixed(2), value }; };
const collect = async fn => {
  const values = [];
  for (let n = 0; n < 5; n++) values.push((await measured(fn)).elapsedMs);
  return values.sort((a, b) => a - b)[2];
};
// Control: replay the actual four serial, independent old provider reads using
// identical fake request costs. No claim that its simplistic returned output
// models the full previous ciState evaluator.
const serialCi = async () => {
  const git = octokit();
  for (const route of routes) await git.request(route, {});
};
const fastCi = async () => {
  const state = await ciState(octokit(), ciArgs);
  if (state.green !== true) throw new Error('Optimized CI did not independently verify green.');
};
const serialPrWorkflow = async () => {
  const ctx = context();
  await ctx.callTool('github_pr_get');
  await ctx.callTool('github_pr_list_stacks');
};
const fastPrWorkflow = async () => {
  const result = await inspectPr({ repo: 'test', number: 5 }, context());
  if (!result.can_request_merge) throw new Error('Optimized status did not preserve the supplied evidence.');
};
const ciSerial = await collect(serialCi), ciOptimized = await collect(fastCi);
const prSerial = await collect(serialPrWorkflow), prOptimized = await collect(fastPrWorkflow);
console.log(JSON.stringify({
  benchmark: 'C-5 synthetic read-only PR/CI critical-path',
  fakeProviderLatencyMs: DELAY, repetitions: 5,
  ci: { serialControlMedianMs: ciSerial, optimizedMedianMs: ciOptimized,
    relativeReductionPercent: +((1-ciOptimized/ciSerial)*100).toFixed(1) },
  prStatus: { serialControlMedianMs: prSerial, optimizedMedianMs: prOptimized,
    relativeReductionPercent: +((1-prOptimized/prSerial)*100).toFixed(1) },
  caveat: 'Synthetic scheduling benchmark, not real-client or production latency. No provider mutation performed.'
}, null, 2));
