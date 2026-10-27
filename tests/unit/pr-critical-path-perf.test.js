import { describe, expect, it } from 'vitest';
import { ciState } from '../../src/github/ci-state.js';
import { inspectPr } from '../../src/tools/workflows-pr.js';

const sha = 'a'.repeat(40);
const work = { owner: 'example-org', repo: 'example', baseBranch: 'main', headSha: sha };
const check = { id: 5, name: 'ci', status: 'completed', conclusion: 'success', started_at: '2026-10-26T12:00:00Z', app: { id: 1 } };

function provider({ rulesError = null, runsError = false, statusesError = false } = {}) {
  const events = [];
  let active = 0, peak = 0;
  const request = async (route) => {
    events.push(route);
    active++;
    peak = Math.max(peak, active);
    // A synthetic independent provider wait—not the actual network or a timing assertion.
    await new Promise(resolve => setTimeout(resolve, 15));
    active--;
    if (route.endsWith('/check-runs')) {
      if (runsError) throw Object.assign(new Error('unreadable'), { status: 403 });
      return { data: { check_runs: [check] } };
    }
    if (route.endsWith('/status')) {
      if (statusesError) throw Object.assign(new Error('unreadable'), { status: 403 });
      return { data: { statuses: [] } };
    }
    if (route.includes('/rules/branches/')) {
      if (rulesError) throw Object.assign(new Error('rules unavailable'), { status: 403 });
      return { data: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci', integration_id: 1 }] } }] };
    }
    if (route.includes('/protection/required_status_checks')) {
      return { data: { checks: [{ context: 'ci', app_id: 1 }] } };
    }
    throw new Error('Unexpected route ' + route);
  };
  return { octokit: { request }, events, get active() { return active; }, get peak() { return peak; } };
}

describe('C-5 PR/CI critical-path performance without changed security semantics', () => {
  it('starts exactly four independent CI provider reads at once, preserving required-check union and exact-head results', async () => {
    const p = provider();
    const value = await ciState(p.octokit, work);
    expect(p.peak).toBe(4);
    expect(p.active).toBe(0);
    expect(p.events).toHaveLength(4);
    expect(value).toMatchObject({ green: true, known: true, basis: 'required', errors: [], checks: [{ context: 'ci', state: 'success' }] });
    expect(value.checks).toHaveLength(1);
  });

  it('returns unknown rather than green on unreadable policy, check runs or commit statuses', async () => {
    for (const fault of [{ rulesError: true }, { runsError: true }, { statusesError: true }]) {
      const p = provider(fault);
      const result = await ciState(p.octokit, work);
      expect(result.green).toBeNull();
      expect(result.known).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(p.active).toBe(0);
    }
  });

  it('begins stack membership and PR evidence in the same turn and retains bounded unknown stack when unreadable', async () => {
    const launched = [];
    const gates = new Map();
    const rawPr = { number: 4, head_sha: sha, head: 'feature', base: 'main', state: 'open',
      merged: false, draft: false, mergeable: true, threads: { unresolved: 0 },
      review_decision: 'APPROVED', checks: { green: true }, html_url: 'https://github.com/example-org/example/pull/4' };
    const ctx = {
      now: () => Date.parse('2026-10-26T12:00:00Z'),
      callTool: (name) => {
        launched.push(name);
        return new Promise(resolve => { gates.set(name, resolve); });
      }
    };
    const pending = inspectPr({ repo: 'example', number: 4 }, ctx);
    await Promise.resolve();
    expect(launched).toEqual(['github_pr_get', 'github_pr_list_stacks']);
    const wrap = structuredContent => ({ structuredContent });
    gates.get('github_pr_list_stacks')({ isError: true, content: [{ type: 'text', text: 'not accessible' }] });
    gates.get('github_pr_get')(wrap(rawPr));
    const result = await pending;
    expect(result).toMatchObject({ done: true, head_sha: sha, stack: { state: 'not_readable' }, can_request_merge: true });
    expect(launched).toHaveLength(2);
  });

  it('does not declare a merge safe when the independent PR read is unavailable', async () => {
    const ctx = { now: Date.now, callTool: async name => name === 'github_pr_get'
      ? { isError: true } : { structuredContent: { items: [], count: 0 } } };
    const r = await inspectPr({ repo: 'example', number: 4 }, ctx);
    expect(r).toMatchObject({ done: false, status: 'not_readable' });
  });
});
