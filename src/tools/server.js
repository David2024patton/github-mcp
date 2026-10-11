// Server tools (A-5): `github_whoami` and `github_list_accounts`. Read-only, no GitHub call, no credential used. They report
// what the server itself knows. Every field is chosen by name below, so a column added to the database later can never
// leak into a result, and no ciphertext, token, key or token tail beyond the last four characters is ever returned.
import { GITHUB_API_VERSION } from '../github/client.js';
import { formatDenver } from '../github/errors.js';

const CORE = 'core';
const dollars = (cents) => `$${(Number(cents) / 100).toFixed(2)}`;
const iso = (value) => (value ? new Date(value).toISOString() : null);

/** What kinds of credential an account has, never the credentials themselves. */
function credentialsOf(row) {
  const out = [];
  if (row.credential_kind === 'fine_grained') {
    if (row.has_fine_grained ?? row.fine_grained_enc) out.push({ type: 'fine_grained_token', last4: row.fine_grained_last4 ?? null });
  } else if (row.installation_status === 'active') {
    out.push({ type: 'app_installation', repository_selection: row.repository_selection ?? null });
  }
  if (row.has_user_token ?? row.user_token_enc) out.push({ type: 'user_authorization', user: row.user_login ?? null });
  if (row.has_classic ?? row.classic_enc) out.push({ type: 'classic_notifications_token', scopes: row.classic_scopes ?? [], last4: row.classic_last4 ?? null });
  return out;
}

/** The brief view of one account (a row from `db.listAccounts()` or `db.getAccount()`). */
export function briefAccount(row) {
  return {
    login: row.login, label: row.label, type: row.account_type, default: !!row.is_default,
    credential_kind: row.credential_kind, installation_status: row.installation_status,
    credentials: credentialsOf(row).map((c) => c.type), production_enabled: !!row.production_enabled
  };
}

/** The full view: brief plus selection, permissions, user sign-in, token tails, plan, scratch flag and last check. */
export function fullAccount(row) {
  return {
    ...briefAccount(row),
    credentials: credentialsOf(row),
    repository_selection: row.repository_selection ?? null,
    installation_permissions: row.installation_permissions ?? {},
    plan: row.plan_name ?? null,
    scratch: !!row.is_scratch,
    checked_at: iso(row.checked_at)
  };
}

const pick = (object, fields) => {
  if (!Array.isArray(fields) || !fields.length) return object;
  return Object.fromEntries(fields.filter((f) => Object.hasOwn(object, f)).map((f) => [f, object[f]]));
};

const COMMON = {
  detail: { type: 'string', enum: ['brief', 'full'], description: 'brief (default) or full' },
  fields: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Only these fields' }
};

export const tools = [
  {
    name: 'github_whoami',
    description: 'Which GitHub accounts this connection may use, its mode and profile, the API version, rate budget left and spend limit.',
    inputSchema: { type: 'object', properties: { ...COMMON }, additionalProperties: false }
  },
  {
    name: 'github_list_accounts',
    description: 'The GitHub accounts this connection can use: app installation, user sign-in, optional tokens, and whether production is on.',
    inputSchema: { type: 'object', properties: { ...COMMON }, additionalProperties: false }
  }
];

const parse = (args) => {
  const detail = args?.detail === 'full' ? 'full' : 'brief';
  if (args?.detail !== undefined && args.detail !== 'brief' && args.detail !== 'full') throw new TypeError('detail must be "brief" or "full".');
  if (args?.fields !== undefined && (!Array.isArray(args.fields) || args.fields.some((f) => typeof f !== 'string'))) throw new TypeError('fields must be a list of names.');
  return { detail, fields: args?.fields };
};

/** Accounts of this connection, in the connection's order, each row read from the database (no ciphertext leaves this file). */
async function connectionAccounts(db, connection, read) {
  const rows = [];
  for (const login of connection.accounts) {
    const row = await read(login);
    if (row) rows.push(row);
  }
  return rows;
}

async function whoami(args, ctx) {
  const { detail, fields } = parse(args);
  const { db, connection } = ctx;
  const rows = await connectionAccounts(db, connection, (login) => db.getAccount(login));
  const accounts = [];
  for (const row of rows) {
    const rate = await db.getRateState(row.login, CORE);
    const view = detail === 'full' ? fullAccount(row) : briefAccount(row);
    accounts.push(pick({
      ...view,
      spend_limit_cents: row.spend_limit_cents ?? 0,
      spend_limit_display: dollars(row.spend_limit_cents ?? 0),
      rate: rate
        ? {
            resource: CORE, remaining: rate.remaining ?? null, resets_at: iso(rate.reset_at), resets_at_display: rate.reset_at ? formatDenver(rate.reset_at) : null,
            blocked_until: iso(rate.blocked_until), blocked_until_display: rate.blocked_until ? formatDenver(rate.blocked_until) : null
          }
        : { resource: CORE, remaining: null, note: 'No GitHub call has been made for this account yet.' }
    }, fields));
  }
  const missing = connection.accounts.filter((login) => !rows.some((r) => r.login.toLowerCase() === login.toLowerCase()));
  return {
    mode: connection.mode, profile: connection.profile, listing: connection.listing,
    default_account: connection.default_account, github_api_version: GITHUB_API_VERSION,
    accounts, ...(missing.length ? { unknown_accounts: missing } : {})
  };
}

async function listAccounts(args, ctx) {
  const { detail, fields } = parse(args);
  const { db, connection } = ctx;
  const allowed = new Set(connection.accounts.map((l) => l.toLowerCase()));
  const rows = (await db.listAccounts()).filter((r) => allowed.has(r.login.toLowerCase()));
  return { count: rows.length, accounts: rows.map((r) => pick(detail === 'full' ? fullAccount(r) : briefAccount(r), fields)) };
}

/** Handlers take `(args, ctx)` with `ctx = { connection, db }`; Batch B's dispatcher supplies the guarded call. */
export const handlers = { github_whoami: whoami, github_list_accounts: listAccounts };
