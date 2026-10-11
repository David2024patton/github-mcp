// "Are the required checks green at this exact commit?" (BATCH-E decision E1). Required contexts are the union of the base branch's
// ruleset `required_status_checks` rules and classic branch protection; each is matched against the commit's check runs (latest run
// per name) and commit statuses. Per context: success | failure | pending | missing. Overall `green` is true only when every required
// context is success (neutral and skipped count as passing, as they do for GitHub); `null` when the requirements could not be read.
const PASSING = new Set(['success', 'neutral', 'skipped']);
const missing = async (run) => { try { return await run(); } catch (error) { if (error?.status === 404) return null; throw error; } };
const forbidden = (error) => error?.status === 403 || error?.status === 401;

export async function requiredContexts(octokit, { owner, repo, branch }) {
  const p = { owner, repo };
  const contexts = new Set();
  let unknown = false;
  try {
    const rules = (await octokit.request('GET /repos/{owner}/{repo}/rules/branches/{branch}', { ...p, branch })).data;
    for (const rule of Array.isArray(rules) ? rules : []) {
      if (rule.type !== 'required_status_checks') continue;
      for (const c of rule.parameters?.required_status_checks ?? []) contexts.add(c.context);
    }
  } catch (error) { if (error?.status === 404) { /* no rules */ } else if (forbidden(error)) unknown = true; else throw error; }
  try {
    const classic = await missing(async () => (await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks', { ...p, branch })).data);
    if (classic) for (const c of [...(classic.contexts ?? []), ...(classic.checks ?? []).map((x) => x.context)]) contexts.add(c);
  } catch (error) { if (forbidden(error)) unknown = true; else throw error; }
  return { contexts: [...contexts], unknown };
}

/** @returns {Promise<{ green: boolean|null, required: Array<{context: string, state: string}>, none_required: boolean, note?: string }>} */
export async function ciState(octokit, { owner, repo, branch, sha }) {
  const { contexts, unknown } = await requiredContexts(octokit, { owner, repo, branch });
  if (!contexts.length) {
    return unknown ? { green: null, required: [], none_required: false, note: 'The required checks of this branch could not be read (the connection lacks permission), so green cannot be confirmed.' }
      : { green: true, required: [], none_required: true };
  }
  const p = { owner, repo, ref: sha };
  const runs = (await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', { ...p, per_page: 100 })).data.check_runs ?? [];
  const statuses = (await octokit.request('GET /repos/{owner}/{repo}/commits/{ref}/status', { ...p, per_page: 100 })).data.statuses ?? [];
  const latest = new Map();
  for (const r of runs) { const seen = latest.get(r.name); if (!seen || (r.id ?? 0) > (seen.id ?? 0)) latest.set(r.name, r); }
  const required = contexts.map((context) => {
    const run = latest.get(context);
    if (run) {
      if (run.status !== 'completed') return { context, state: 'pending' };
      return { context, state: PASSING.has(run.conclusion) ? 'success' : 'failure' };
    }
    const status = statuses.find((s) => s.context === context);
    if (status) return { context, state: status.state === 'success' ? 'success' : status.state === 'pending' ? 'pending' : 'failure' };
    return { context, state: 'missing' };
  });
  return { green: required.every((r) => r.state === 'success') && !unknown, required, none_required: false, ...(unknown ? { note: 'Some requirements could not be read, so green cannot be confirmed.' } : {}) };
}
