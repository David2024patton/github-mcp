// Explicit operator-run native custom-MCP acceptance. No credential in CLI flags,
// stdout, error detail, files or Git. Never activates production or mutates GitHub.
// Independently inspect Vercel exact deployment SHA before invoking this probe.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const TRUSTED_NATIVE_ORIGIN = 'https://github-mcp-xi.vercel.app';
const SHA = /^[a-f0-9]{40}$/;
const TOKEN = /^[A-Za-z0-9_-]{30,256}$/;
const check = (name, pass) => ({ name, passed: pass === true });
const MAX_RESPONSE_BYTES = 4_000_000;
function safeParse(text, type) {
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Oversize service response');
  if (/text\/event-stream/i.test(type ?? '')) {
    const entries = text.split(/\r?\n/).filter(line => line.startsWith('data:'));
    for (const entry of entries) {
      try {
        const parsed = JSON.parse(entry.slice(5).trim());
        if (parsed?.jsonrpc === '2.0') return parsed;
      } catch { /* an event other than an RPC response is not evidence */ }
    }
    throw new Error('No JSON-RPC event');
  }
  return JSON.parse(text);
}
async function readResponse(response) {
  const length = response.headers?.get?.('content-length');
  if (length !== null && length !== undefined && Number(length) > MAX_RESPONSE_BYTES)
    throw new Error('Oversize service response');
  return safeParse(await response.text(), response.headers?.get?.('content-type'));
}
function resultOf(value, id) {
  return value?.jsonrpc === '2.0' && value.id === id && !value.error
    ? value.result : null;
}
function structured(reply) {
  if (!reply || reply.isError === true) return null;
  if (reply.structuredContent && typeof reply.structuredContent === 'object')
    return reply.structuredContent;
  const text = reply.content?.find?.(item => item.type === 'text')?.text;
  try { return JSON.parse(text); } catch { return null; }
}
async function invoke(fetchImpl, origin, token, id, method, params) {
  const response = await fetchImpl(origin + '/api/mcp?listing=catalog', {
    method: 'POST', redirect: 'error',
    headers: {
      authorization: 'Bearer ' + token, 'content-type': 'application/json',
      accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-03-26'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(10000)
  });
  return { status: response.status, value: await readResponse(response) };
}
async function publicPreflight(fetchImpl, origin, sha) {
  const r = await fetchImpl(origin + '/api/contract', {
    method: 'GET', redirect: 'error', headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8000)
  });
  const body = await readResponse(r);
  return r.status === 200 && body?.server === 'robinson-github-mcp' &&
    body?.service_identity?.reported_revision === sha &&
    body?.service_identity?.independently_verified === false;
}
export async function probeNativeMcp({
  origin, providerRevision, token, scratchAccount, phase = 'read', fetchImpl = fetch
} = {}) {
  const report = {
    ok: false, phase: ['read', 'revoked'].includes(phase) ? phase : null,
    checks: [], custom_transport_observed: false, provider_read_observed: false,
    permitted_write_observed: false, provider_readback_observed: false,
    resource_denial_observed: false, credential_revocation_observed: false,
    deployment_sha_independently_retrieved_by_script: false,
    hub_acceptance: false, cleanup_acceptance: false
  };
  const valid = origin === TRUSTED_NATIVE_ORIGIN &&
    SHA.test(providerRevision ?? '') && typeof token === 'string' && TOKEN.test(token) &&
    /^[-a-z0-9]{3,39}$/.test(scratchAccount ?? '') &&
    ['read', 'revoked'].includes(phase);
  report.checks.push(check('pinned_origin_sha_credential_scope_and_phase', valid));
  if (!valid) return report;
  // The bearer is never sent unless a credential-free preflight matches the
  // independently verified Vercel deployment revision supplied by the operator.
  let prepared = false;
  try { prepared = await publicPreflight(fetchImpl, origin, providerRevision); }
  catch { /* no bearer attempted */ }
  report.checks.push(check('preflight_exact_service_source', prepared));
  if (!prepared) return report;
  const verify = async (name, action) => {
    let pass = false;
    try { pass = await action(); } catch { /* never reveal service errors */ }
    report.checks.push(check(name, pass));
    return pass === true;
  };
  if (phase === 'revoked') {
    const revoked = await verify('same_native_bearer_revoked', async () => {
      const r = await invoke(fetchImpl, origin, token, 1, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'robinson-native-acceptance', version: '1.0.0' }
      });
      return r.status === 401 && ['invalid_token', 'unauthorized'].includes(r.value?.error);
    });
    report.credential_revocation_observed = revoked;
    report.ok = report.checks.every(c => c.passed);
    return report;
  }
  const started = await verify('native_mcp_initialize', async () => {
    const r = await invoke(fetchImpl, origin, token, 1, 'initialize', {
      protocolVersion: '2025-03-26', capabilities: {},
      clientInfo: { name: 'robinson-native-acceptance', version: '1.0.0' }
    });
    return r.status === 200 &&
      resultOf(r.value, 1)?.serverInfo?.name === 'robinson-github-mcp';
  });
  if (!started) return report;
  const listing = await verify('native_tools_list', async () => {
    const r = await invoke(fetchImpl, origin, token, 2, 'tools/list', {});
    const tools = resultOf(r.value, 2)?.tools;
    return r.status === 200 && Array.isArray(tools) &&
      ['github_whoami', 'github_list_accounts', 'github_repo_list'].every(name => tools.some(t => t.name === name));
  });
  if (!listing) return report;
  const identity = await verify('native_scratch_identity', async () => {
    const r = await invoke(fetchImpl, origin, token, 3, 'tools/call', {
      name: 'github_whoami', arguments: {}
    });
    const who = structured(resultOf(r.value, 3));
    return r.status === 200 && who?.mode === 'PREVIEW' &&
      who?.default_account?.toLowerCase() === scratchAccount.toLowerCase() &&
      who?.accounts?.some?.(row => row.login?.toLowerCase() === scratchAccount.toLowerCase() &&
        row.production_enabled === false);
  });
  if (!identity) return report;
  report.custom_transport_observed = true;
  const list = await verify('native_real_provider_repository_read', async () => {
    const r = await invoke(fetchImpl, origin, token, 4, 'tools/call', {
      name: 'github_repo_list', arguments: { owner: scratchAccount, max: 10 }
    });
    const data = structured(resultOf(r.value, 4));
    return r.status === 200 && data?.owner?.toLowerCase() === scratchAccount.toLowerCase() &&
      Array.isArray(data.items) && Number.isSafeInteger(data.count);
  });
  report.provider_read_observed = list;
  if (!list) return report;
  const denied = await verify('native_foreign_account_denied', async () => {
    const r = await invoke(fetchImpl, origin, token, 5, 'tools/call', {
      name: 'github_repo_list', arguments: { owner: 'non-owned-acceptance-test', max: 1 }
    });
    return r.status === 200 && resultOf(r.value, 5)?.isError === true;
  });
  report.resource_denial_observed = denied;
  report.ok = report.checks.every(c => c.passed);
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await probeNativeMcp({
    origin: process.env.GITHUB_MCP_ORIGIN,
    providerRevision: process.env.GITHUB_MCP_DEPLOYED_SHA,
    token: process.env.GITHUB_MCP_ACCESS_TOKEN,
    scratchAccount: process.env.GITHUB_MCP_SCRATCH_ACCOUNT,
    phase: process.argv[2]
  });
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ok) process.exitCode = 1;
}
