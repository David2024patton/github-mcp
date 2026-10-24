// PUB-5 B through the REAL server route (/api/mcp), real database, fake GitHub. No browser is needed: it proves what is counted,
// what is refused and who is exempt, end to end. Only `tools/call` counts; initialize, tools/list and notifications are free.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('@neondatabase/serverless', async () => { const h = await import('./harness.js'); return { neon: () => h.fakeNeon() }; });
import { ORIGIN, appFinishes, appStartsSignIn, startWorld } from './setup.js';

let world, count = 0;
const saved = {};
const setEnv = (values) => { for (const [k, v] of Object.entries(values)) { if (!(k in saved)) saved[k] = process.env[k]; process.env[k] = v; } };
beforeAll(async () => { world = await startWorld(); setEnv({ PUBLIC_FREE_CALLS_PER_DAY: '4', PUBLIC_FREE_WRITES_PER_HOUR: '2' }); });
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await world?.close();
});

const form = (fields) => new URLSearchParams(fields).toString();
async function signIn(id) {
  count++;
  const gh = world.github;
  const person = gh.addPerson({ login: 'fair-' + count, id, authorized: true });
  gh.install(person, person.login);
  const started = await appStartsSignIn(world, { name: 'Fair use ' + count });
  const url = new URL(started.url);
  const step1 = await world.call({ method: 'GET', path: url.pathname + url.search });
  const state = new URL(step1.headers.location).searchParams.get('state');
  const code = 'faircode' + count + Math.random().toString(36).slice(2);
  gh.state.codes.set(code, person);
  const step2 = await world.call({ method: 'GET', path: '/api/github/user-callback?code=' + code + '&state=' + encodeURIComponent(state) });
  const handle = /name="handle" value="([^"]+)"/.exec(step2.text)?.[1];
  const step3 = await world.call({ method: 'POST', path: '/api/oauth/authorize', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN },
    body: form({ step: 'approve', handle, choice: 'approve' }) });
  const link = /href="([^"]*oauth\/callback[^"]*)"/.exec(step3.text)?.[1]?.replaceAll('&amp;', '&');
  const back = new URL(link);
  return appFinishes(world, started, { code: back.searchParams.get('code'), state: back.searchParams.get('state') });
}
const headersFor = (token, session) => ({ authorization: 'Bearer ' + token, accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...(session ? { 'mcp-session-id': session } : {}) });
const parse = (res) => { const t = res.text.includes('data:') ? res.text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : res.text; return t ? JSON.parse(t) : null; };
async function rpc(token, body) {
  const init = await world.call({ method: 'POST', path: '/api/mcp', headers: headersFor(token), body: { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fair-use-test', version: '1' } } } });
  expect(init.status).toBe(200);
  const res = await world.call({ method: 'POST', path: '/api/mcp', headers: headersFor(token, init.headers['mcp-session-id']), body });
  return { status: res.status, headers: res.headers, body: res.status === 202 ? null : parse(res) };
}
const whoami = (token, id = 2) => rpc(token, { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'github_whoami', arguments: {} } });
const usageRow = async (login) => (await world.pool.query(`SELECT d.calls, d.errors, d.writes FROM gh_public_usage_daily d
  JOIN gh_tenant_pilot_bootstraps b ON b.tenant_id = d.tenant_id JOIN gh_tenant_identities i ON i.id = b.identity_id
  WHERE i.provider_subject = $1`, [login])).rows[0];

describe('free fair use through /api/mcp', () => {
  it('does not count initialize, tools/list or notifications; refuses call 5 of 4 with the reset time; reads of the numbers stay exact', async () => {
    const tokens = await signIn(810001);
    const list = await rpc(tokens.access_token, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} });
    expect(list.status).toBe(200);
    await rpc(tokens.access_token, { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(await usageRow('810001')).toBeUndefined(); // nothing counted yet
    for (let i = 0; i < 4; i++) {
      const res = await whoami(tokens.access_token, 10 + i);
      expect(res.status).toBe(200);
      expect(res.body.result.isError).not.toBe(true);
    }
    expect((await usageRow('810001')).calls).toBe(4);
    const refused = await whoami(tokens.access_token, 99);
    expect(refused.status).toBe(200);
    expect(refused.body.id).toBe(99);
    expect(refused.body.result.isError).toBe(true);
    expect(refused.body.result.content[0].text).toBe("You have reached today's free limit of 4 calls. It resets at midnight UTC. See /limits.");
    expect(refused.body.result.structuredContent.retry_after_seconds).toBeGreaterThan(0);
    expect(refused.body.result.structuredContent.retry_after_seconds).toBeLessThanOrEqual(86400);
    expect(Number(refused.headers['retry-after'])).toBe(refused.body.result.structuredContent.retry_after_seconds);
    expect((await usageRow('810001')).calls).toBe(4); // a refused call is not counted
    // looking things up that are not calls still works, so the person can see what is going on
    expect((await rpc(tokens.access_token, { jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} })).status).toBe(200);
  });

  it('refuses a whole batch of calls when it would pass the limit', async () => {
    const tokens = await signIn(810002);
    await whoami(tokens.access_token); await whoami(tokens.access_token); await whoami(tokens.access_token);
    const batch = await rpc(tokens.access_token, [
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'github_whoami', arguments: {} } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'github_whoami', arguments: {} } }]);
    expect(batch.status).toBe(429);
    expect(batch.body.error).toBe('rate_limited');
    expect((await usageRow('810002')).calls).toBe(3);
  });

  it('never limits a person whose numeric GitHub id is on the unlimited list', async () => {
    setEnv({ PUBLIC_UNLIMITED_SUBJECTS: '810003, 999' });
    const tokens = await signIn(810003);
    for (let i = 0; i < 7; i++) expect((await whoami(tokens.access_token, 20 + i)).body.result.isError).not.toBe(true);
    expect((await usageRow('810003')).calls).toBe(7); // still measured, never refused
    const other = await signIn(810004);
    for (let i = 0; i < 4; i++) await whoami(other.access_token, 30 + i);
    expect((await whoami(other.access_token, 40)).body.result.isError).toBe(true);
    setEnv({ PUBLIC_UNLIMITED_SUBJECTS: '' });
  });

  it('a person\'s numbers come from one place: the owner summary adds up exactly what was counted', async () => {
    const { publicUsageSummary } = await import('../../src/tenancy/usage-summary.js');
    const { neon } = await import('@neondatabase/serverless');
    const out = await publicUsageSummary(neon(), { connectionString: process.env.DATABASE_URL, env: process.env, sqlFactory: undefined });
    const total = Number((await world.pool.query('SELECT sum(calls)::int AS n FROM gh_public_usage_daily')).rows[0].n);
    expect(out.lastDay.calls).toBe(total);
    expect(out.activeToday).toBe(4);
    expect(out.top.length).toBeLessThanOrEqual(10);
  });
});
