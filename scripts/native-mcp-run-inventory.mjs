// Direct, read-only inspection of one existing custom GitHub MCP scratch run.
// Never seeds new resources, obtains cleanup confirmation or deletes any resource.
// Requires protected native OAuth bearer and externally verified exact live SHA.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { probeNativeMcp, invoke, resultOf, structured } from './native-mcp-evidence.mjs';

const RUN = /^[a-z][a-z0-9-]{2,42}$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const check = (name, passed) => ({ name, passed: passed === true });
const BLOCK = /^[A-Z_]{3,80}$/;

export async function probeNativeScratchRun({
  origin, providerRevision, token, scratchAccount, runId, repo, fetchImpl = fetch
} = {}) {
  const report = {
    ok: false, checks: [], authenticated_native_read: false,
    existing_run_journal_observed: false, remote_preflight_observed: false,
    remote_snapshot_accepted: false, blocker_code: null,
    provider_write_observed: false, cleanup_performed: false,
    deletion_authorized: false, cleanup_acceptance_proven: false,
    snapshot_atomic: false
  };
  const bounded = RUN.test(runId ?? '') && REPO.test(repo ?? '') &&
    !repo.includes('..') && !repo.endsWith('.git') &&
    typeof scratchAccount === 'string' && scratchAccount.length > 0;
  report.checks.push(check('single_bounded_existing_run', bounded));
  if (!bounded) return report;
  const native = await probeNativeMcp({
    origin, providerRevision, token, scratchAccount, phase: 'read', fetchImpl
  });
  report.authenticated_native_read = native.ok;
  report.checks.push(check('independent_native_oauth_provider_read_and_account_denial', native.ok));
  if (!native.ok) return report;
  // Every inspection is explicitly scoped to one account, run ID and repo.
  // Raw journal records and remote provider responses are never printed.
  let journal = null;
  try {
    const response = await invoke(fetchImpl, origin, token, 11, 'tools/call', {
      name: 'github_dev_list_runs',
      arguments: { owner: scratchAccount, runId, max: 49, includeBirthLabels: true }
    });
    journal = response.status === 200 ? structured(resultOf(response.value, 11)) : null;
  } catch { /* a missing journal is not permission to delete */ }
  const observed = journal?.run?.id === runId &&
    String(journal?.run?.account ?? '').toLowerCase() === scratchAccount.toLowerCase() &&
    Array.isArray(journal?.objects) && journal.objects.length < 49 &&
    Array.isArray(journal?.intents) && journal.intents.length < 49 &&
    journal?.more_may_exist === false;
  report.existing_run_journal_observed = observed;
  report.checks.push(check('exact_scoped_untruncated_run_journal', observed));
  if (!observed) return report;
  let remote = null;
  try {
    const response = await invoke(fetchImpl, origin, token, 12, 'tools/call', {
      name: 'github_dev_list_runs',
      arguments: { owner: scratchAccount, runId, repo,
        remoteCleanupPreview: true, includeBirthLabels: true }
    });
    remote = response.status === 200 ? structured(resultOf(response.value, 12)) : null;
  } catch { /* do not infer a complete remote inventory */ }
  const rightScope = remote?.run_id === runId &&
    String(remote?.owner ?? '').toLowerCase() === scratchAccount.toLowerCase() &&
    remote.repo === repo && remote.deletion_authorized === false &&
    remote.destructive_operations_performed === false &&
    remote.persistent_cleanup_freeze === false &&
    remote.snapshot_atomic === false;
  report.remote_preflight_observed = rightScope &&
    ['blocked', 'remote_snapshot_accepted'].includes(remote.status);
  report.checks.push(check('read_only_exact_remote_preflight', report.remote_preflight_observed));
  if (!report.remote_preflight_observed) return report;
  if (remote.status === 'blocked') {
    report.blocker_code = BLOCK.test(remote.blocker_code ?? '') ? remote.blocker_code : 'REMOTE_PREFLIGHT_REFUSED';
    report.checks.push(check('remote_snapshot_accepted_without_cleanup_authority', false));
    return report;
  }
  const accepted = remote.status === 'remote_snapshot_accepted' &&
    remote.phase === 'scratch_remote_inventory' &&
    remote.blocker_code === null;
  report.remote_snapshot_accepted = accepted;
  report.checks.push(check('remote_snapshot_accepted_without_cleanup_authority', accepted));
  report.ok = report.checks.every(c => c.passed);
  // Even a complete read-only remote inventory is non-atomic and NEVER
  // authorizes a future destructive run. The write door must recheck everything.
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await probeNativeScratchRun({
    origin: process.env.GITHUB_MCP_ORIGIN,
    providerRevision: process.env.GITHUB_MCP_DEPLOYED_SHA,
    token: process.env.GITHUB_MCP_ACCESS_TOKEN,
    scratchAccount: process.env.GITHUB_MCP_SCRATCH_ACCOUNT,
    runId: process.env.GITHUB_MCP_RUN_ID,
    repo: process.env.GITHUB_MCP_RUN_REPO
  });
  process.stdout.write(JSON.stringify(report) + '\n');
  if (!report.ok) process.exitCode = 1;
}
