// R-3: a small fixture registry (one read, two writes, one repository read) served by the REAL RTC HTTPS handler, the real
// dispatcher, the real write layer and the real gates, over a fake database. Nothing here talks to GitHub.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createDispatch } from '../../src/tools/dispatch.js';
import { createGates } from '../../src/tools/gates.js';
import { createRtcHttpHandler } from '../../src/rtc/http.js';
import { rtcManifest } from '../../src/rtc/contract.js';
import { mergeNamespaces } from '../../src/core/registry.js';
import { defineGithubWrite } from '../../src/tools/define-github-write.js';
import * as server from '../../src/tools/server.js';
import { makeWorld } from './write-contract.js';

export function fixtureRegistry({ extra = [] } = {}) {
  const state = { value: 'initial', guarded: 'initial', full: 'initial', repoReads: [] };
  const reply = (value) => value;
  const read = {
    name: 'github_fixture_read', description: 'Read the fixture value.', area: 'fixture', audience: ['B'], compact: true,
    results: Object.freeze({ summaryType: null }), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: 'object', properties: { detail: { type: 'string', enum: ['summary', 'full'] }, fields: { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 20 } }, additionalProperties: false }
  };
  const repoRead = {
    name: 'github_fixture_repo_read', description: 'Read a fixture repository value.', area: 'fixture', audience: ['B'],
    results: Object.freeze({ summaryType: null }), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: 'object', properties: { owner: { type: 'string', maxLength: 39 }, repo: { type: 'string', maxLength: 100 }, fields: { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 20 } }, required: ['repo'], additionalProperties: false }
  };
  const writeTool = (name, key, declarations, extraSpec = {}) => defineGithubWrite({
    name, description: `Set the fixture ${key}.`, area: 'fixture', audience: ['B'],
    properties: { value: { type: 'string', maxLength: 200 } },
    declarations: { production: 'never', cred: '—', ...declarations },
    target: () => ({ owner: 'example-org', scope: 'fixture' }),
    read: async () => ({ value: state[key] }),
    classify: () => (declarations.accessWidening ? { accessWidening: true } : {}),
    summarize: ({ args, before }) => `Set the fixture ${key} to "${args.value ?? ''}" (was "${before.value}")`,
    apply: async ({ args }) => { state[key] = args.value ?? 'set'; },
    readAfter: async () => ({ value: state[key] }),
    verify: ({ args, after }) => after.value === (args.value ?? 'set'),
    present: ({ after }) => ({ value: after.value }),
    ...extraSpec
  });
  const write = writeTool('github_fixture_write', 'value', { profiles: ['everyday', 'full'] });
  const guarded = writeTool('github_fixture_guarded', 'guarded', { confirm: 'always', profiles: ['everyday', 'full'] });
  const fullOnly = writeTool('github_fixture_full_only', 'full', {profiles:['full']});
  const access = writeTool('github_fixture_access', 'guarded', { accessWidening: true, profiles: ['everyday', 'full'] });
  const fixture = {
    tools: [read, write.tool, guarded.tool, fullOnly.tool, access.tool, repoRead],
    handlers: {
      github_fixture_read: async (args) => reply({ value: state.value, payload: args.detail === 'full' ? 'X'.repeat(9000) : 'short' }),
      github_fixture_repo_read: async (args) => { state.repoReads.push(`${args.owner}/${args.repo}`); return { repo: args.repo, value: 'ok' }; },
      [write.tool.name]: write.handler, [guarded.tool.name]: guarded.handler,
      [fullOnly.tool.name]: fullOnly.handler, [access.tool.name]: access.handler
    }
  };
  const registry = mergeNamespaces([fixture, ...extra, { tools: server.tools, handlers: server.handlers }]);
  return { registry, state };
}

/** Starts the real handler on 127.0.0.1. `world` supplies the fake database; several servers may share one world. */
export async function startRtc({ world, registry, manifest = true } = {}) {
  const dispatch = createDispatch({ env: world.ctx.env, credentials: world.credentials, gates: createGates(), fetch: world.gh.fetch, now: world.ctx.now, sleep: world.ctx.sleep });
  const handler = createRtcHttpHandler({ db: world.db, registry, dispatch });
  const http = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname; const query = Object.fromEntries(url.searchParams);
    let route = path === '/api/contract' ? 'contract' : path === '/api/whoami' ? 'whoami' : path === '/api/openapi.json' ? 'openapi'
      : path === '/api/tools' ? 'tools' : path.startsWith('/api/results/') ? 'results' : path.startsWith('/api/tools/') ? 'tool' : 'missing';
    if (path === '/api/tools/_batch') route = 'batch';
    if (route === 'tool') query.name = decodeURIComponent(path.split('/').at(-1));
    if (route === 'results') query.handle = decodeURIComponent(path.split('/').at(-1));
    let data = '';
    for await (const chunk of req) { data += chunk; if (data.length > 65536) break; }
    let body = {}; try { if (data) body = JSON.parse(data); } catch { body = null; }
    const headers = {};
    const out = { setHeader(k, v) { headers[k] = v; }, status(n) { this.code = n; return this; },
      json(value) { res.writeHead(this.code ?? 200, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(value)); return this; } };
    // The fixture run is the only place a manifest claims RTC 1; production keeps `rtc: 0` (not certified).
    if (route === 'contract' && manifest) return out.status(200).json({ ...rtcManifest(registry), rtc: 1 });
    await handler({ method: req.method, headers: req.headers, query, body }, out, route);
  });
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${http.address().port}`, close: () => new Promise((resolve) => http.close(resolve)) };
}

export const newPass = () => `rtc_pass_${randomBytes(32).toString('base64url')}`;
export const newPassId = () => randomBytes(12).toString('hex');

/** A world whose account is installed and active (so passes can be issued), plus a way to issue a pass. */
export async function passWorld(options = {}) {
  const world = await makeWorld({ profile: 'full', accounts: ['example-org'], scratchAccount: true, ...options });
  const issue = async (grant = {}, { days = 1 } = {}) => {
    const pass = newPass(); const passId = newPassId();
    const full = { profile: 'everyday', mode: 'preview', areas: null, repos: null, allowWrites: true, allowAccessChanges: false, moneyLimitCents: 0, forHub: false, days, ratePerMinute: 120, ...grant };
    const id = await world.db.createRtcPassGrant({ pass, passId, account: 'example-org', expiresAt: new Date(Date.now() + days * 86400000), grant: full });
    return { pass, passId, id };
  };
  return { ...world, issue };
}
