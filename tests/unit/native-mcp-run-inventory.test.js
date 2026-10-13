import { describe, it, expect } from 'vitest';
import { probeNativeScratchRun } from '../../scripts/native-mcp-run-inventory.mjs';
import { TRUSTED_NATIVE_ORIGIN } from '../../scripts/native-mcp-evidence.mjs';

const SHA = 'a'.repeat(40), TOKEN = 'b'.repeat(43);
const ACCOUNT = 'robinson-ai-scratch', RUN = 'run-abc', REPO = 'rtc-run-abc';
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' }
});
const rpc = (id, result) => json({ jsonrpc: '2.0', id, result });
function service({
  blocked = null, truncated = false, foreignJournal = false,
  wrongScope = false, badSource = false, rejectNative = false
} = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ path: new URL(url).pathname, method: init.method, bearer: init.headers?.authorization });
    if (url.endsWith('/api/contract')) return json({
      server: 'robinson-github-mcp',
      service_identity: {
        reported_revision: badSource ? 'c'.repeat(40) : SHA,
        independently_verified: false
      }
    });
    const req = JSON.parse(init.body);
    if (rejectNative) return json({ error: 'invalid_token' }, 401);
    let body;
    if (req.method === 'initialize') body = { serverInfo: { name: 'robinson-github-mcp' } };
    else if (req.method === 'tools/list') body = {
      tools: ['github_whoami', 'github_list_accounts', 'github_repo_list', 'github_dev_list_runs']
        .map(name => ({ name }))
    };
    else if (req.params?.name === 'github_whoami') body = { structuredContent: {
      mode: 'PREVIEW', default_account: ACCOUNT,
      accounts: [{ login: ACCOUNT, production_enabled: false }]
    } };
    else if (req.params?.name === 'github_repo_list') body =
      req.params.arguments.owner === ACCOUNT
        ? { structuredContent: { owner: ACCOUNT, count: 0, items: [] } }
        : { isError: true, content: [{ type: 'text', text: 'Forbidden' }] };
    else if (req.params?.name === 'github_dev_list_runs') {
      const args = req.params.arguments;
      if (args.remoteCleanupPreview) body = { structuredContent: {
        run_id: RUN, owner: wrongScope ? 'other-account' : ACCOUNT,
        repo: REPO, phase: 'scratch_remote_inventory',
        status: blocked ? 'blocked' : 'remote_snapshot_accepted',
        blocker_code: blocked, deletion_authorized: false,
        destructive_operations_performed: false,
        persistent_cleanup_freeze: false, snapshot_atomic: false
      } };
      else body = { structuredContent: {
        run: { id: RUN, account: foreignJournal ? 'other-account' : ACCOUNT },
        objects: [], intents: [], more_may_exist: truncated
      } };
    } else throw Error('unexpected method: ' + req.method);
    return rpc(req.id, body);
  };
  return { calls, fetchImpl };
}
const args = (fetchImpl, extra = {}) => ({
  origin: TRUSTED_NATIVE_ORIGIN, providerRevision: SHA,
  token: TOKEN, scratchAccount: ACCOUNT, runId: RUN, repo: REPO, fetchImpl, ...extra
});

describe('native scratch run inventory is non-destructive and evidence-only', () => {
  it('reports exact scoped journal and remote snapshot with no deletion authority or raw provider data', async () => {
    const mock = service();
    const report = await probeNativeScratchRun(args(mock.fetchImpl));
    expect(report.ok).toBe(true);
    expect(report.authenticated_native_read).toBe(true);
    expect(report.existing_run_journal_observed).toBe(true);
    expect(report.remote_preflight_observed).toBe(true);
    expect(report.remote_snapshot_accepted).toBe(true);
    expect(report.deletion_authorized).toBe(false);
    expect(report.cleanup_performed).toBe(false);
    expect(report.provider_write_observed).toBe(false);
    expect(report.cleanup_acceptance_proven).toBe(false);
    expect(mock.calls[0].bearer).toBeUndefined();
    expect(mock.calls.filter(x => x.method === 'POST')).toHaveLength(7);
    expect(mock.calls.every(x => x.path === '/api/mcp' || x.path === '/api/contract')).toBe(true);
    expect(JSON.stringify(report)).not.toContain(TOKEN);
  });

  it('preserves a real exact blocker code without declaring cleanup successful', async () => {
    const mock = service({ blocked: 'LABEL_PROVENANCE_UNVERIFIED' });
    const report = await probeNativeScratchRun(args(mock.fetchImpl));
    expect(report.ok).toBe(false);
    expect(report.remote_preflight_observed).toBe(true);
    expect(report.blocker_code).toBe('LABEL_PROVENANCE_UNVERIFIED');
    expect(report.deletion_authorized).toBe(false);
    expect(report.cleanup_performed).toBe(false);
  });

  it('rejects foreign or incomplete run journal and remote scope', async () => {
    for (const state of [{ truncated: true }, { foreignJournal: true }, { wrongScope: true }]) {
      const mock = service(state);
      const report = await probeNativeScratchRun(args(mock.fetchImpl));
      expect(report.ok).toBe(false);
      expect(report.remote_snapshot_accepted).toBe(false);
    }
  });

  it('does not send a bearer when the deployed revision mismatches or inputs are unsafe', async () => {
    const wrongSource = service({ badSource: true });
    expect((await probeNativeScratchRun(args(wrongSource.fetchImpl))).ok).toBe(false);
    expect(wrongSource.calls).toHaveLength(1);
    expect(wrongSource.calls[0].bearer).toBeUndefined();
    const invalid = service();
    for (const extra of [{ runId: 'BAD' }, { repo: '../foreign' }, { repo: 'other..repo' }])
      expect((await probeNativeScratchRun(args(invalid.fetchImpl, extra))).ok).toBe(false);
    expect(invalid.calls).toHaveLength(0);
  });

  it('does not inspect any journal or remote run if the native OAuth/provider probe fails', async () => {
    const mock = service({ rejectNative: true });
    const result = await probeNativeScratchRun(args(mock.fetchImpl));
    expect(result.ok).toBe(false);
    expect(result.existing_run_journal_observed).toBe(false);
    expect(mock.calls).toHaveLength(2);
  });
});
