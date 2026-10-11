// Tools that describe this server and the connection using them (A-5c). Read-only: they read the database and call no GitHub
// endpoint. They show which credential types exist, never a credential, not even its last characters.
import { GITHUB_API_VERSION } from '../github/client.js';
import { formatDenver } from '../github/errors.js';

const DETAIL = { type: 'string', enum: ['brief', 'full'], description: 'brief (default) or full' };
const FIELDS = { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Only these fields of each account' };
const dollars = (cents) => `$${((Number(cents) || 0) / 100).toFixed(2)}`;
const when = (value) => (value ? formatDenver(value) : null);

function installationLabel(row) {
  if (row.credential_kind === 'fine_grained') return row.has_fine_grained ? 'token saved' : 'no token';
  if (row.app_id == null) return 'no GitHub App yet';
  return row.installation_status === 'active' ? 'installed' : row.installation_status === 'suspended' ? 'suspended' : 'not installed';
}
const credentialsOf = (row) => ({
  I: row.credential_kind === 'fine_grained' ? row.has_fine_grained : row.installation_status === 'active',
  U: !!row.has_user_token,
  K: !!row.has_classic
});

/** Accounts this connection may use, default first. An account removed since the connection was made simply disappears. */
async function visibleAccounts(ctx) {
  const allowed = new Set(ctx.connection.accounts.map((login) => login.toLowerCase()));
  return (await ctx.db.listAccounts()).filter((a) => allowed.has(a.login.toLowerCase()));
}

function pick(entries, fields) {
  if (!fields?.length) return entries;
  const known = new Set(entries.flatMap((e) => Object.keys(e)));
  const unknown = fields.filter((f) => f !== 'login' && !known.has(f));
  if (unknown.length && entries.length) throw new TypeError(`Unknown field: ${unknown.slice(0, 3).join(', ')}. Available: ${[...known].join(', ')}`);
  return entries.map((e) => Object.fromEntries(['login', ...fields.filter((f) => f !== 'login')].filter((f) => f in e).map((f) => [f, e[f]])));
}

async function whoami(args, ctx) {
  const rows = await visibleAccounts(ctx);
  const accounts = [];
  for (const row of rows) {
    const rate = await ctx.db.getRateState(row.login, 'core');
    const entry = {
      login: row.login, label: row.label, type: row.account_type, is_default: row.login.toLowerCase() === ctx.connection.default_account.toLowerCase(),
      credentials: credentialsOf(row), production_enabled: !!row.production_enabled,
      spend_limit: dollars(row.spend_limit_cents), spend_limit_cents: row.spend_limit_cents ?? 0,
      rate_core: rate ? { remaining: rate.remaining, resets_at: when(rate.reset_at), blocked_until: when(rate.blocked_until) } : { remaining: null, note: 'No call made yet' }
    };
    if (args.detail === 'full') Object.assign(entry, { setup: installationLabel(row), repository_selection: row.repository_selection ?? null, user_login: row.user_login ?? null, plan: row.plan_name ?? null });
    accounts.push(entry);
  }
  return {
    mode: ctx.connection.mode.toUpperCase(), profile: ctx.connection.profile, listing: ctx.connection.listing,
    default_account: ctx.connection.default_account, api_version: GITHUB_API_VERSION,
    credential_types: { I: 'installation token (or fine-grained token)', U: 'your sign-in for personal settings', K: 'notifications-only classic token' },
    accounts: pick(accounts, args.fields)
  };
}

async function listAccounts(args, ctx) {
  const rows = await visibleAccounts(ctx);
  const accounts = rows.map((row) => {
    const entry = {
      login: row.login, label: row.label, account_type: row.account_type, credential_kind: row.credential_kind === 'app' ? 'GitHub App' : 'fine-grained token',
      setup: installationLabel(row), repository_selection: row.repository_selection ?? null,
      user_authorization: row.has_user_token ? `signed in as ${row.user_login ?? 'you'}` : 'not signed in',
      notifications_token: row.has_classic ? 'saved' : 'none', production_enabled: !!row.production_enabled, is_default: !!row.is_default
    };
    if (args.detail === 'full') Object.assign(entry, { installation_permissions: row.installation_permissions ?? {}, notifications_scopes: row.classic_scopes ?? [], plan: row.plan_name ?? null, last_checked: when(row.checked_at) });
    return entry;
  });
  return { count: accounts.length, accounts: pick(accounts, args.fields) };
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const tools = [
  {
    name: 'github_whoami',
    description: 'Accounts this connection can use, mode (PREVIEW/PRODUCTION), profile, credential types per account (I, U, K), API version, rate budget, spend limit.',
    inputSchema: { type: 'object', properties: { detail: DETAIL, fields: FIELDS }, additionalProperties: false },
    annotations: readOnly
  },
  {
    name: 'github_list_accounts',
    description: 'Connected GitHub accounts this connection may use: App installation, repository selection, your sign-in, notifications token, production on/off.',
    inputSchema: { type: 'object', properties: { detail: DETAIL, fields: FIELDS }, additionalProperties: false },
    annotations: readOnly
  }
];
export const handlers = { github_whoami: whoami, github_list_accounts: listAccounts };
