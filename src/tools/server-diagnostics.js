// Tools that look at the server's own standing with GitHub (B-8): what the installations are allowed to do, how much of
// GitHub's rate budget is left, and where to click for the settings GitHub gives no API for. Reads only; none shows a credential.
import { bareOctokit } from '../github/client.js';
import { GithubClientError } from '../github/errors.js';
import { formatDenver } from '../github/errors.js';
import { AREAS, LEVELS } from '../data/permission-needs.js';
import { MAP_STATUS, SETTINGS, findSettings, fill } from '../data/dashboard-map.js';
import { enrolledGuideUser, restrictUnknownUserLink } from './guide-personal.js';
import {effectiveToolAccess,documentedOperationAccess,accessRecovery,additionalCredentialHandoff} from '../github/effective-access.js';
import { publicOrigin } from '../core/http.js';
import {optionalCredentialIdentityStatus} from '../github/optional-identity-status.js';
import {restOperation} from '../github/openapi-index.js';

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
  // The canonical static registry is read at call time to avoid granting meta
  // tools the dynamic registry-injection privilege reserved for dispatcher runners.
  // Import only inside the requested read handler: the registration graph
  // imports this module while constructing the registry, so a top-level
  // import here would create a cyclic, partially initialized registry.
  const registeredTools = args.tool===undefined ? null : (await import('./index.js')).registry;
  const chosen=args.tool===undefined?null:registeredTools.tools.find(t=>t.name===args.tool);
  if(args.tool!==undefined&&!chosen)throw new TypeError('That GitHub tool is not registered. Search with github_search_tools.');
  if (args.area && !AREAS.some((a) => a.id === args.area)) throw new TypeError(`Unknown area "${args.area}". Areas: ${AREAS.map((a) => a.id).join(', ')}.`);
  if(args.operation && (!args.account || (!args.area && !chosen)))
    throw new TypeError('For operation evidence select one connection account and a tool or area.');
  let pinned=null;
  if(args.operation){
    try{pinned=restOperation(args.operation);}
    catch{throw new TypeError('That exact REST operation is absent from pinned GitHub 2026-03-10.');}
  }
  const rows = await accountsFor(ctx, args.account);
  // A named tool should not add a 24-area report to the existing size-bounded
  // MCP result. Narrow to its known capability area, or explicitly say the
  // exact tool-to-area mapping is unknown. A caller can still select any area
  // separately, and an omitted tool retains the original whole audit.
  const areaForTool = {
    pr:'pull-requests',repo:'repositories',content:'content',branch:'branches',
    issue:'issues',actions:'actions',release:'releases',security:'security',
    webhook:'webhooks',org:'organization',billing:'billing',package:'packages'
  };
  const inferredArea = chosen ? (areaForTool[chosen.area] ?? null) : null;
  const areas = AREAS.filter(a => args.area ? a.id === args.area : !chosen || a.id === inferredArea);
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
  if(pinned) for(const entry of accounts){
    const account=rows.find(x=>sameLogin(x.login,entry.login));
    entry.operation_evidence=documentedOperationAccess({account,route:pinned.route});
    const ownerContext=ctx.connection?.pass!==true &&
      typeof ctx.credentials?.operationAuthority!=='function';
    let origin=null;
    if(ownerContext)try{origin=publicOrigin(ctx.env);}catch{/* No safe link without configured server origin. */}
    const proposed=additionalCredentialHandoff({
      operation:pinned.route,account,origin,ownerContext
    });
    if(ownerContext && proposed.status==='protected-setup' &&
       typeof ctx.db.additionalCredentialProofs==='function'){
      // listAccounts intentionally redacts encrypted values; inspect an exact
      // allowed account row only inside this owner-only diagnostic. Never
      // include ciphertext or a token-derived hash in returned output.
      const privateAccount=await ctx.db.getAccount(account.login);
      const existing=optionalCredentialIdentityStatus({
        account:privateAccount,proofs:await ctx.db.additionalCredentialProofs(account.login)
      });
      entry.optional_credentials=existing;
      const previous=existing[proposed.kind];
      entry.additional_setup=previous?.documentedRead===pinned.route &&
        previous.operationPermission==='observed-for-read-at-enrollment'
        ?{status:'read-observed-at-enrollment',kind:proposed.kind,
          account:account.login,operation:pinned.route,
          note:'This exact read succeeded during prior protected enrollment. Current GitHub permission has NOT been rechecked; do not replay a refused write.'}
        :proposed;
    }else entry.additional_setup=proposed;
    entry.operation_note='Area-level permission needs include writes and do not prove an individual read operation.';
    if(typeof ctx.credentials?.operationAuthority==='function')
      entry.operation_authority=await ctx.credentials.operationAuthority({
        account:account.login,operation:pinned.route});
    // Private tenant optional authority has a different protected form from
    // the operator's global setup. Never route a member or pass to owner setup.
    // A single registered callback is required to return to the exact client;
    // no caller-supplied arbitrary redirect can ever reach the browser.
    if(pinned.route==='GET /notifications' &&
       typeof ctx.credentials?.operationAuthority==='function' &&
       ctx.connection?.pass!==true &&
       typeof ctx.connection?.client_id==='string' &&
       ctx.connection.client_id.startsWith('tcl_') &&
       typeof ctx.db?.getOAuthClient==='function'){
      try{
        const {verifyTenantCredential}=await import('../tenancy/routed-credential.js');
        const claim=verifyTenantCredential(ctx.connection.client_id,'tcl',ctx.env);
        const client=claim?await ctx.db.getOAuthClient(ctx.connection.client_id):null;
        const redirects=client?.redirect_uris;
        if(ctx.env?.VERCEL_ENV==='production' &&
           Array.isArray(redirects) && redirects.length===1){
          const {validRedirectUri}=await import('../core/oauth.js');
          if(validRedirectUri(redirects[0])){
            const url=new URL('/api/tenant/optional',publicOrigin(ctx.env));
            url.searchParams.set('client_id',ctx.connection.client_id);
            url.searchParams.set('account',account.login.toLowerCase());
            url.searchParams.set('kind','K');
            url.searchParams.set('redirect_uri',redirects[0]);
            const observed=entry.operation_authority?.status==='verified-for-scope';
            entry.additional_setup={
              status:observed?'renew-or-revoke':'protected-tenant-setup',
              kind:'classic_pat',operation:pinned.route,
              url:url.toString(),
              note:observed
                ?'An exact notification read was observed at enrollment; current rights are not rechecked. Use this protected page to renew or revoke.'
                :'GitHub requires a classic personal token with notifications scope. Calling github_notify_list starts client OAuth reauthorization and returns through its pending PKCE transaction. This standalone management page requires returning to chat yourself; never paste the token into chat.'
            };
          }
        }
      }catch{/* Missing origin/client/signed scope never becomes a setup link. */}
    }
  }
  if(chosen) for(const entry of accounts){
    const account=rows.find(row=>sameLogin(row.login,entry.login));
    entry.effective_access=effectiveToolAccess({connection:ctx.connection,account,tool:chosen});
    if(!entry.optional_credentials && ctx.connection?.pass!==true &&
        !ctx.credentials?.operationAuthority &&
        typeof ctx.db.additionalCredentialProofs==='function') {
      const privateAccount=await ctx.db.getAccount(account.login);
      const proofs=await ctx.db.additionalCredentialProofs(account.login);
      entry.optional_credentials=optionalCredentialIdentityStatus({
        account:privateAccount,proofs
      });
    }
    entry.recovery=accessRecovery({
      connection:ctx.connection,account,tool:chosen,
      missingPermissions:(entry.areas??[]).flatMap(a=>a.missing??[]),
      operation:entry.operation_evidence??null
    });
    if(!areas.length && entry.status==='all good') entry.status='area unverified';
    if(!areas.length) entry.area_note='No audited permission family is mapped to this registered tool. Select an area explicitly; do not assume GitHub grants.';
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
    inputSchema: { type: 'object', properties: { account: { type: 'string', maxLength: 39 }, area: { type: 'string', maxLength: 40, description: 'One area, e.g. pull-requests' }, tool: { type: 'string', maxLength: 80, description: 'Registered tool to diagnose for each scoped account' }, operation: { type: 'string', maxLength: 240, description: 'Pinned REST METHOD /path documentation; requires account and tool or area' }, detail: DETAIL }, additionalProperties: false },
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
