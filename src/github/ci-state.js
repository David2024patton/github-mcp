// "Are the required checks green at this exact commit?" (BATCH-E E1). One helper, shared by github_pr_get, github_pr_merge and the CI
// tools of Batch G. The required checks are the union of the base branch's ruleset `required_status_checks` rules and classic branch
// protection; each is matched with the head commit's check runs (the latest run per name, and the app when the rule names one) and its
// commit statuses. Result per check: success | failure | pending | missing. Nothing is guessed: a read that fails is reported, and
// the overall answer is then "unknown", never green.

/** Every check run at a commit (up to 500), page by page; the response wraps the list in `check_runs`. */
async function allCheckRuns(octokit, params) {
  const runs = [];
  for (let page = 1; page <= 5; page += 1) {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', { ...params, filter: 'all', per_page: 100, page });
    runs.push(...(data.check_runs ?? []));
    if ((data.check_runs ?? []).length < 100) break;
  }
  return runs;
}

const PASSING = new Set(['success', 'neutral', 'skipped']);
const FAILING = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale']);

import { isPlanLimit } from './plan-limit.js';

async function tryRead(fn) {
  try { return { ok: true, data: await fn() }; } catch (error) {
    return { ok: false, status: error?.status ?? null, planLimited: isPlanLimit(error) };
  }
}

/** Required checks as `[{ context, appId }]` from rulesets and classic protection; `errors` lists reads that failed for a reason other than "none". */
export async function requiredChecks(octokit, { owner, repo, branch }) {
  const found = new Map();
  const errors = [];
  const notes = [];
  const add = (context, appId) => { const key = `${context}\n${appId ?? ''}`; if (!found.has(key)) found.set(key, { context, appId: appId ?? null }); };
  const rules = await tryRead(async () => (await octokit.request('GET /repos/{owner}/{repo}/rules/branches/{branch}', { owner, repo, branch })).data);
  if (rules.ok) {
    for (const rule of Array.isArray(rules.data) ? rules.data : []) {
      if (rule.type === 'required_status_checks') for (const c of rule.parameters?.required_status_checks ?? []) add(c.context, c.integration_id);
    }
  } else if (rules.planLimited) notes.push(`rules are not available for this repository on its GitHub plan, so none can require checks on ${branch}`);
  else errors.push(`rules for ${branch} could not be read${rules.status ? ` (HTTP ${rules.status})` : ''}`);
  const classic = await tryRead(async () => (await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks', { owner, repo, branch })).data);
  if (classic.ok) {
    if (Array.isArray(classic.data.checks) && classic.data.checks.length) for (const c of classic.data.checks) add(c.context, c.app_id);
    else for (const context of classic.data.contexts ?? []) add(context, null);
  } else if (classic.planLimited) notes.push(`branch protection is not available for this repository on its GitHub plan, so none can require checks on ${branch}`);
  else if (classic.status !== 404) errors.push(`classic protection for ${branch} could not be read${classic.status ? ` (HTTP ${classic.status})` : ''}`);
  return { required: [...found.values()], errors, notes };
}

const latestRun = (runs) => runs.reduce((best, r) => (!best || new Date(r.started_at ?? 0) > new Date(best.started_at ?? 0) || (r.started_at === best.started_at && r.id > best.id) ? r : best), null);

function runState(run) {
  if (run.status !== 'completed') return 'pending';
  if (PASSING.has(run.conclusion)) return 'success';
  return FAILING.has(run.conclusion) ? 'failure' : 'pending';
}
const statusState = (s) => ({ success: 'success', failure: 'failure', error: 'failure', pending: 'pending' }[s] ?? 'pending');

/**
 * @returns {Promise<{ notes: string[], green: boolean|null, known: boolean, basis: 'required'|'all-checks', checks: Array<{ context: string, state: string, source: string }>, problems: string[], errors: string[] }>}
 *   `green` is true only when everything counted is `success`; null when it could not be worked out.
 */
export async function ciState(octokit, { owner, repo, baseBranch, headSha }) {
  const p = { owner, repo };
  const { required, errors, notes } = await requiredChecks(octokit, { owner, repo, branch: baseBranch });
  let runs; let statuses;
  try {
    runs = await allCheckRuns(octokit, { ...p, ref: headSha });
  } catch { return { green: null, known: false, basis: 'required', checks: [], problems: [], notes, errors: [...errors, 'the check runs at this commit could not be read'] }; }
  try { statuses = (await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/status', { ...p, ref: headSha })).data.statuses ?? []; } catch { statuses = null; errors.push('the commit statuses could not be read'); }

  const evaluate = ({ context, appId }) => {
    const matching = runs.filter((r) => r.name === context && (appId == null || r.app?.id === appId));
    const run = latestRun(matching);
    if (run) return { context, state: runState(run), source: 'check run', started_at: run.started_at ?? null, completed_at: run.completed_at ?? null };
    const status = (statuses ?? []).find((s) => s.context === context);
    return status ? { context, state: statusState(status.state), source: 'status', updated_at: status.updated_at ?? null } : { context, state: 'missing', source: 'none' };
  };

  let checks; let basis;
  if (required.length) { checks = required.map(evaluate); basis = 'required'; } else {
    // Nothing is marked required: stay careful and require every check that exists at this commit to pass.
    basis = 'all-checks';
    const names = [...new Set(runs.map((r) => r.name))];
    checks = [...names.map((context) => evaluate({ context, appId: null })), ...(statuses ?? []).filter((s) => !names.includes(s.context)).map((s) => ({ context: s.context, state: statusState(s.state), source: 'status' }))];
  }
  const problems = checks.filter((c) => c.state !== 'success').map((c) => `${c.context}: ${c.state}`);
  if (!checks.length) problems.push('no checks have reported on this commit yet (CI may not have started)');
  // Any read that failed means the answer is unknown, never green.
  return { green: errors.length ? null : problems.length === 0, known: errors.length === 0, basis, checks, problems, notes, errors };
}
