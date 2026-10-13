import { describe, expect, it } from 'vitest';
import { probeNativeMcp, TRUSTED_NATIVE_ORIGIN } from '../../scripts/native-mcp-evidence.mjs';

const SHA = 'a'.repeat(40);
const BEARER = 'e'.repeat(43);
const SCRATCH = 'robinson-ai-scratch';
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' }
});
const rpc = (id, result) => json({ jsonrpc: '2.0', id, result });
function service({ phase = 'read', failAt = null, reportedSha = SHA, sse = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, bearer: init.headers?.authorization || null });
    if (url.endsWith('/api/contract')) return json({
      server: 'robinson-github-mcp',
      service_identity: { reported_revision: reportedSha, independently_verified: false }
    });
    const request = JSON.parse(init.body);
    if (phase === 'revoked') return json({ error: 'invalid_token' }, 401);
    let answer;
    if (request.method === 'initialize') answer = { serverInfo: { name: 'robinson-github-mcp', version: '0.1.0' } };
    else if (request.method === 'tools/list') answer = {
      tools: ['github_whoami', 'github_list_accounts', 'github_repo_list'].map(name => ({ name }))
    };
    else if (request.params?.name === 'github_whoami') answer = {
      structuredContent: { mode: 'PREVIEW', default_account: SCRATCH,
        accounts: [{ login: SCRATCH, production_enabled: false }] }
    };
    else if (request.params?.name === 'github_repo_list') answer =
      request.params.arguments.owner === SCRATCH
        ? { structuredContent: { owner: SCRATCH, count: 0, items: [] } }
        : { isError: true, content: [{ type: 'text', text: 'Forbidden account' }] };
    else throw Error('Unexpected method ' + request.method);
    if (failAt === request.id) answer = { isError: true, content: [{ type: 'text', text: 'Service denied' }] };
    if (sse && request.id === 1) return new Response(
      'event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: request.id, result: answer }) + '\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    );
    return rpc(request.id, answer);
  };
  return { fetchImpl, calls };
}
const args = (fetchImpl, more = {}) => ({
  origin: TRUSTED_NATIVE_ORIGIN, providerRevision: SHA, token: BEARER,
  scratchAccount: SCRATCH, fetchImpl, ...more
});

describe('operator-only native custom MCP evidence, never standard connector evidence', () => {
  it('proves a real-shaped read-only sequence and foreign owner denial without reporting writes or cleanup', async () => {
    const { fetchImpl, calls } = service({ sse: true });
    const result = await probeNativeMcp(args(fetchImpl));
    expect(result.ok).toBe(true);
    expect(result.custom_transport_observed).toBe(true);
    expect(result.provider_read_observed).toBe(true);
    expect(result.resource_denial_observed).toBe(true);
    expect(result.permitted_write_observed).toBe(false);
    expect(result.provider_readback_observed).toBe(false);
    expect(result.hub_acceptance).toBe(false);
    expect(result.cleanup_acceptance).toBe(false);
    expect(result.deployment_sha_independently_retrieved_by_script).toBe(false);
    expect(calls.map(c => c.method)).toEqual(['GET', 'POST', 'POST', 'POST', 'POST', 'POST']);
    expect(calls[0].bearer).toBe(null);
    expect(calls.slice(1).every(c => c.bearer === 'Bearer ' + BEARER)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(BEARER);
  });

  it('fails closed before the first bearer request on wrong origin, credential, scope or deployed revision', async () => {
    const { fetchImpl, calls } = service();
    for (const overrides of [
      { origin: 'https://evil.example.com' }, { token: 'invalid' },
      { scratchAccount: '../unknown' }, { providerRevision: 'short' },
      { phase: 'write' }
    ]) {
      const result = await probeNativeMcp(args(fetchImpl, overrides));
      expect(result.ok).toBe(false);
    }
    expect(calls).toHaveLength(0);
    const mismatched = service({ reportedSha: 'b'.repeat(40) });
    expect((await probeNativeMcp(args(mismatched.fetchImpl))).ok).toBe(false);
    expect(mismatched.calls).toHaveLength(1);
    expect(mismatched.calls[0].bearer).toBeNull();
  });

  it('requires a verified provider read and actual native foreign-scope refusal', async () => {
    for (const failAt of [1, 2, 3, 4, 5]) {
      const { fetchImpl } = service({ failAt });
      const result = await probeNativeMcp(args(fetchImpl));
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(BEARER);
    }
  });

  it('requires the same revoked native bearer to fail authenticated initialization with HTTP 401', async () => {
    const revoked = service({ phase: 'revoked' });
    const result = await probeNativeMcp(args(revoked.fetchImpl, { phase: 'revoked' }));
    expect(result.ok).toBe(true);
    expect(result.credential_revocation_observed).toBe(true);
    expect(result.provider_read_observed).toBe(false);
    expect(revoked.calls).toHaveLength(2);
    const active = service();
    expect((await probeNativeMcp(args(active.fetchImpl, { phase: 'revoked' }))).ok).toBe(false);
  });
});
