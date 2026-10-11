// Tools that describe this server and the connection using them (A-5c). Read-only: they read the database and call no GitHub
// endpoint. They show which credential types exist, never a credential, not even its last characters.
import { randomBytes } from 'node:crypto';
import { GITHUB_API_VERSION } from '../github/client.js';
import { GithubClientError, formatDenver } from '../github/errors.js';
import { defineGithubWrite } from './define-github-write.js';
import { publicOrigin } from '../core/http.js';
import { protectedList } from './protect-guard.js';
import { dollars as money } from '../github/prices.js';
import { spendStatus } from './spend-guard.js';

const DETAIL = { type: 'string', enum: ['brief', 'full'], description: 'brief (default) or full' };
const FIELDS = { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 20, description: 'Only these fields of each account' };
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

async function listProtectedResources(args, ctx) {
  const entries = await protectedList(ctx.db);
  const rows = entries.map((e) => ({ kind: e.kind, target: e.target === '*' ? 'all of this server\'s own GitHub App installations' : e.target, level: e.level, reason: e.reason }));
  return {
    count: rows.length,
    levels: { 'pr-only': 'only pull requests (branches, commits, reviews, checks, issues) and merges on green at an exact head are allowed', locked: 'no change of any kind' },
    editable: 'only on the setup page, with your passphrase',
    protected: pick(rows, args.fields)
  };
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const readTools = [
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
  },
  {
    name: 'github_list_protected_resources',
    description: 'Repositories and installations this server refuses to change (its own repo, other Robinson servers) and the level: pr-only or locked.',
    inputSchema: { type: 'object', properties: { fields: FIELDS }, additionalProperties: false },
    annotations: readOnly
  }
];
const readHandlers = { github_whoami: whoami, github_list_accounts: listAccounts, github_list_protected_resources: listProtectedResources };

// ---- Production switch (B-2): ask here, confirm on the setup page; turning it off needs no passphrase. ----
const PENDING_MINUTES = 10;
const accountTarget = (args) => ({ owner: args.account, scope: 'server' });
const readAccount = (args, ctx) => ctx.db.getAccount(args.account);
const noAccount = (account) => new GithubClientError('outside_scope', `There is no connected account called "${account}".`, { account });
const setupUrl = (ctx) => { try { return `${publicOrigin(ctx.env)}/api/github/setup`; } catch { return '/api/github/setup'; } };

const enableProduction = defineGithubWrite({
  name: 'github_enable_production',
  description: 'Step 1 of turning production on for an account: you then confirm with your passphrase on the setup page.',
  properties: { account: { type: 'string', maxLength: 39 } },
  required: ['account'],
  declarations: { production: 'never', accessWidening: true, confirm: 'always', profiles: ['full'] },
  target: accountTarget,
  read: readAccount,
  classify: ({ args, before }) => (before ? { accessWidening: `production connections could then change ${args.account}\'s real repositories` } : {}),
  summarize: ({ args, before }) => (before
    ? `Start turning production ON for ${args.account} (today: ${before.production_enabled ? 'already on' : 'off'}). Nothing changes until you confirm on the setup page within ${PENDING_MINUTES} minutes`
    : `There is no connected account called "${args.account}"`),
  apply: async ({ args, ctx, before }) => {
    if (!before) throw noAccount(args.account);
    await ctx.db.createSetupState({ state: randomBytes(32).toString('base64url'), purpose: 'enable_production', accountHint: before.login, ttlSeconds: PENDING_MINUTES * 60 });
  },
  readAfter: async ({ args, ctx }) => ({ pending: await ctx.db.hasPendingSetupState('enable_production', args.account), enabled: (await ctx.db.getAccount(args.account))?.production_enabled === true }),
  verify: ({ after }) => after.pending || after.enabled,
  present: ({ args, ctx, after }) => (after.enabled
    ? { production: 'already ON' }
    : { next_step: `Open ${setupUrl(ctx)}, find "Turn on production", enter ${args.account} and your passphrase, within ${PENDING_MINUTES} minutes.`, expires_in_minutes: PENDING_MINUTES })
});

const disableProduction = defineGithubWrite({
  name: 'github_disable_production',
  description: 'Turn production OFF for an account at once; every production connection to it stops being able to change anything.',
  properties: { account: { type: 'string', maxLength: 39 } },
  required: ['account'],
  declarations: { production: 'never', confirm: 'always', profiles: ['full'] },
  target: accountTarget,
  read: readAccount,
  classify: () => ({}),
  summarize: ({ args, before }) => (before ? `Turn production OFF for ${args.account} (today: ${before.production_enabled ? 'on' : 'already off'})` : `There is no connected account called "${args.account}"`),
  apply: async ({ args, ctx, before }) => {
    if (!before) throw noAccount(args.account);
    await ctx.db.setProductionEnabled(args.account, false);
  },
  readAfter: async ({ args, ctx }) => (await ctx.db.getAccount(args.account))?.production_enabled === true,
  verify: ({ after }) => after === false,
  present: ({ args }) => ({ production: `OFF for ${args.account}. Turning it on again needs the setup page and your passphrase.` })
});

const setSpendLimit = defineGithubWrite({
  name: 'github_set_spend_limit',
  description: 'Lower an account\'s monthly spend limit (0 blocks all spending). Raising it is only possible on the setup page.',
  properties: { account: { type: 'string', maxLength: 39 }, limitCents: { type: 'integer', minimum: 0, maximum: 100000000, description: 'New monthly limit in cents (1000 = $10.00)' } },
  required: ['account', 'limitCents'],
  declarations: { production: 'never', profiles: ['everyday', 'full'] },
  target: accountTarget,
  read: async (args, ctx) => spendStatus(ctx, args.account),
  classify: () => ({}),
  summarize: ({ args, before }) => (before
    ? `Set the monthly spend limit for ${args.account} to ${money(args.limitCents)} (today ${money(before.limitCents)}; ${money(before.usedCents)} spent so far this month)`
    : `There is no connected account called "${args.account}"`),
  apply: async ({ args, ctx, before }) => {
    if (!before) throw noAccount(args.account);
    await ctx.db.setSpendLimitCents(args.account, args.limitCents);
  },
  readAfter: async ({ args, ctx }) => (await ctx.db.getAccount(args.account))?.spend_limit_cents,
  verify: ({ args, after }) => after === args.limitCents,
  present: ({ args, after }) => ({ spend_limit: money(after), spend_limit_cents: after, raising_it: `Only the setup page can raise it (account ${args.account}).` })
});

export const tools = [...readTools, enableProduction.tool, disableProduction.tool, setSpendLimit.tool];
export const handlers = { ...readHandlers, [enableProduction.tool.name]: enableProduction.handler, [disableProduction.tool.name]: disableProduction.handler, [setSpendLimit.tool.name]: setSpendLimit.handler };
