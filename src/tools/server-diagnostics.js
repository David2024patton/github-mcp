// Tools that look at the server's own standing with GitHub (B-8): what the installations are allowed to do, how much of
// GitHub's rate budget is left, and where to click for the settings GitHub gives no API for. Reads only; none shows a credential.
import { bareOctokit } from '../github/client.js';
import { GithubClientError } from '../github/errors.js';
import { formatDenver } from '../github/errors.js';
import { AREAS, LEVELS } from '../data/permission-needs.js';
import { MAP_STATUS, SETTINGS, findSettings, fill } from '../data/dashboard-map.js';
import { enrolledGuideUser, restrictUnknownUserLink } from './guide-personal.js';
import {effectiveToolAccess} from '../github/effective-access.js';

const DETAIL = { type: 'string', enum: ['brief', 'full'], description: 'brief (default) or full' };
const when = (value) => (value ? formatDenver(value) : null);
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const sameLogin = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** The accounts this connection may use, optionally narrowed to one the caller named. */
async function accountsFor(ctx, named) {
  const allowed = new Set(ctx.connection.accounts.map((l) => l.toLowerCase()));
  if (named && !allowed.has(String(named).toLowerCase())) throw new TypeError(`"${named}" is not one of the GitHub accounts this connection may use (${ctx.connection.accounts.join(', ')}).`);
  return (await ctx.db.listAccounts()).filter((a) => allowed.has(a.login.toLowerCase()) && (!named || sameLogin(a.login, named)));
}

const configureUrl = (row) => (row.installation_id == null ? null : row.account_type === 'Organization'
  ? `https://github.com/organizations/${row.login}/settings/installations/${row.installation_id}` : `https://github.com/settings/installations/${row.installation_id}`);

/** Compares granted permissions with an area's needs. `granted` is the installation's `{ name: level }` map. */
export function compareArea(area, granted) {
  const missing = [];
  for (const [permission, need] of Object.entries(area.needs)) {
    const have = granted[permission] ?? null;
    if ((LEVELS[have] ?? 0) < LEVELS[need]) missing.push({ permission, needed: need, granted: have ?? 'none' });
  }
  return missing;
}

async function checkPermissions(args, ctx) {
  const chosen=args.tool===undefined?null:ctx.registry?.tools?.find(t=>t.name===args.tool);
  if(args.tool!==undefined&&!chosen)throw new TypeError('That GitHub tool is not registered. Search with github_search_tools.');
  if (args.area && !AREAS.some((a) => a.id === args.area)) throw new TypeError(`Unknown area "${args.area}". Areas: ${AREAS.map((a) => a.id).join(', ')}.`);
  const rows = await accountsFor(ctx, args.account);
  const areas = AREAS.filter((a) => !args.area || a.id === args.area);
  const accounts = rows.map((row) => {
    const base = { login: row.login };
    if (row.credential_kind === 'fine_grained') {
      return { ...base, status: 'fine-grained token', note: 'This account uses a fine-grained token. Its permissions are set on the token at GitHub and cannot be read from here; if a tool is refused, edit the token on GitHub.' };
    }
    if (row.app_id == null) return { ...base, status: 'no GitHub App yet', note: 'Create the App on the setup page first.' };
    if (row.installation_status !== 'active' || row.installation_id == null) return { ...base, status: 'not installed', note: 'Install the App on this account from the setup page, then check again.' };
    const granted = row.installation_permissions ?? {};
    if (!Object.keys(granted).length) return { ...base, status: 'unknown', note: 'The permissions this installation holds have not been recorded yet. Reconnect the account on the setup page.' };
    const results = areas.map((a) => ({ area: a.id, title: a.title, tools: a.tools, missing: compareArea(a, granted),
      ...(a.capabilityNote ? { capability: 'unverified', note: a.capabilityNote } : {}) }));
    const lacking = results.filter((r) => r.missing.length);
    const unverified = results.filter((r) => !r.missing.length && r.capability === 'unverified');
    const needed = [...new Map(lacking.flatMap((r) => r.missing).map((m) => [m.permission, m])).values()];
    return {
      ...base, status: lacking.length ? 'permissions missing' : unverified.length ? 'capability unverified' : 'all good',
      areas_ok: results.length - lacking.length - unverified.length, areas_missing: lacking.length, areas_unverified: unverified.length,
      ...(needed.length ? {
        add_these: needed.map((m) => `${m.permission}: ${m.needed} (now ${m.granted})`),
        how: `On GitHub open the App's settings → Permissions & events, raise those permissions, save, then accept the new permissions on the installation page${configureUrl(row) ? ` (${configureUrl(row)})` : ''}.`
      } : {}),
      areas: args.detail === 'full' ? results.map((r) => ({ ...r, permissions_ok: r.missing.length === 0, ok: r.missing.length === 0 && !r.capability }))
        : results.filter((r) => r.missing.length || r.capability)
    };
  });
  if(chosen) for(const entry of accounts){
    const account=rows.find(row=>sameLogin(row.login,entry.login));
    entry.effective_access=effectiveToolAccess({connection:ctx.connection,account,tool:chosen});
  }
  return { checked_areas: areas.length, accounts };
}

const RESOURCES = ['core', 'graphql', 'search', 'code_search'];

async function rateStatus(args, ctx) {
  const rows = await accountsFor(ctx, args.account);
  const accounts = [];
  for (const row of rows) {
    const stored = {};
    for (const resource of RESOURCES) {
      const s = await ctx.db.getRateState(row.login, resource);
      if (s) stored[resource] = { remaining: s.remaining, resets_at: when(s.reset_at), blocked_until: when(s.blocked_until) };
    }
    const entry = { login: row.login, blocked: Object.entries(stored).filter(([, v]) => v.blocked_until).map(([k, v]) => `${k} until ${v.blocked_until}`), last_seen: stored };
    if (args.live !== false) {
      try {
        // Asked directly, not through the guarded client: the answer is free, and it must still work while a block is in force.
        const token = await ctx.credentials?.token({ account: row.login, cred: 'I', profile: ctx.connection.profile });
        if (typeof token !== 'string' || !token) throw new GithubClientError('no_credentials', `No GitHub credential is set up for ${row.login}.`, { account: row.login });
        const { data } = await bareOctokit({ token, fetch: ctx.fetch }).request('GET /rate_limit');
        entry.live = Object.fromEntries(Object.entries(data.resources ?? {}).filter(([k]) => RESOURCES.includes(k) || args.detail === 'full')
          .map(([k, v]) => [k, { limit: v.limit, used: v.used, remaining: v.remaining, resets_at: when(new Date(v.reset * 1000)) }]));
      } catch (error) {
        entry.live_unavailable = error?.code === 'no_credentials' ? 'No GitHub credential is set up for this account.' : 'GitHub could not be asked just now; the stored numbers above are what the server last saw.';
      }
    }
    accounts.push(entry);
  }
  return { note: 'Asking GitHub for the rate limit does not use any of the budget.', accounts };
}

async function whereIsSetting(args, ctx) {
  if (typeof args.query !== 'string' || !args.query.trim()) throw new TypeError('Say which setting you are looking for, in plain words (for example "require two-factor").');
  const names = new Set(ctx.connection.accounts.map((l) => l.toLowerCase()));
  const org = args.org && names.has(String(args.org).toLowerCase()) ? args.org : null;
  if(args.repo&&!/^[A-Za-z0-9._-]{1,100}$/.test(args.repo))throw new TypeError('Repository name is not valid.');
  if (args.org && !org) throw new TypeError(`"${args.org}" is not one of the GitHub accounts this connection may use (${ctx.connection.accounts.join(', ')}).`);
  const matches = findSettings(args.query, { max: args.detail === 'full' ? 5 : 2 });
  if (!matches.length) return { found: 0, map: MAP_STATUS, note: 'Nothing in the map matches. If GitHub has an API for it, one of the other tools does it; otherwise it has not been mapped yet.', try_words: SETTINGS.map((s) => s.title).slice(0, 8) };
  const user = matches.some((s) => s.scope === 'user')
    ? await enrolledGuideUser(ctx, org ?? ctx.connection.default_account) : null;
  return {
    found: matches.length, map: MAP_STATUS,
    settings: matches.map((s) => restrictUnknownUserLink(fill({
      setting: s.title, where: s.page, url: s.url, scope: s.scope,
      steps: s.steps.map((step, i) => ({ n: i + 1, ...step })), expected: s.expected,
      ...(s.verifyWith ? { verifyWith: s.verifyWith } : { verifyWith: null, check: 'GitHub gives no way to read this back; tell me when it is done and I will note it.' })
    }, { org: org ?? (s.scope === 'org' ? ctx.connection.default_account : null), user: s.scope === 'user' ? user : null,
      repo: args.repo ?? null }), s.url, user))
  };
}

export const tools = [
  {
    name: 'github_check_permissions',
    area: 'server', audience: ['O', 'B'],
    description: 'Check App grants and a named tool\'s profile, mode, stored credential and unverified guard layers.',
    usesRegistry: true,
    inputSchema: { type: 'object', properties: { account: { type: 'string', maxLength: 39 }, area: { type: 'string', maxLength: 40, description: 'One area, e.g. pull-requests' }, tool: { type: 'string', maxLength: 80, description: 'Registered tool to diagnose for each scoped account' }, detail: DETAIL }, additionalProperties: false },
    annotations: readOnly
  },
  {
    name: 'github_rate_status',
    area: 'server', audience: ['Op', 'B'],
    description: 'GitHub rate-limit budget per account: what the server last saw, any block in force, and (unless live=false) GitHub\'s live numbers.',
    inputSchema: { type: 'object', properties: { account: { type: 'string', maxLength: 39 }, live: { type: 'boolean', description: 'Ask GitHub now (default true)' }, detail: DETAIL }, additionalProperties: false },
    annotations: readOnly
  },
  {
    name: 'github_where_is_setting',
    area: 'server', audience: ['O'],
    description: 'Step-by-step directions (link, numbered actions, what you should see, read-back check) for a GitHub setting that has no API.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 2, maxLength: 120, description: 'Plain words, e.g. "require two-factor"' }, org: { type: 'string', maxLength: 39 }, repo: { type: 'string', maxLength: 100 }, detail: DETAIL }, required: ['query'], additionalProperties: false },
    annotations: readOnly
  }
];
export const handlers = { github_check_permissions: checkPermissions, github_rate_status: rateStatus, github_where_is_setting: whereIsSetting };
