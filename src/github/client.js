// The only file in the server that imports @octokit/*. Every GitHub call goes through an Octokit built here, so the
// pinned API version, request keys, write spacing, rate discipline and ETag caching cannot be skipped (A7–A9).
import crypto from 'node:crypto';
import { Octokit } from '@octokit/core';
import { paginateRest } from '@octokit/plugin-paginate-rest';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { GithubClientError } from './errors.js';
import { assertNotBlocked, rateLimited, recordRate, resourceFor, takeWriteSlot } from './rate.js';

/** The GitHub REST API version sent on every request. Moving it is its own card (BATCH-A A7). */
export const GITHUB_API_VERSION = '2026-03-10';
/** How long one request may spend waiting on GitHub's `retry-after` / reset times before it gives up (A9). */
export const DEFAULT_BUDGET_MS = 20_000;
export const CREDENTIAL_KINDS = Object.freeze(['I', 'U', 'K']);
const USER_AGENT = 'robinson-github-mcp';
const KEY_EXCLUDED_ARGS = Object.freeze(['dryRun', 'confirm', 'fields', 'detail', 'requestKey']);
const BUCKET_MS = 10 * 60 * 1000;

const CompositeOctokit = Octokit.plugin(paginateRest, retry, throttling);
// Our own spacing (database write slots, shared across instances) replaces the plugin's in-process queues.
const noQueue = Object.freeze({ key: () => ({ schedule: (_options, fn, ...args) => fn(...args) }) });

const isMutation = (options) => /^\s*(?:#[^\n]*\n\s*)*mutation\b/.test(String(options.query ?? options.body?.query ?? ''));
const isGraphqlUrl = (url) => new URL(url, 'https://api.github.com').pathname.startsWith('/graphql');
const isWrite = (method, options) => (isGraphqlUrl(options.url) ? isMutation(options) : !['GET', 'HEAD'].includes(method));

/** Canonical JSON: object keys sorted, undefined dropped, so equal arguments always serialize identically. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v === undefined ? null : v)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * A plain Octokit for the few calls that happen before a connection exists: minting installation tokens with the App's
 * JWT, reading the App, checking a token the owner pasted. Same API version header and user agent; no database hooks, no
 * throttling, no retries (the setup page shows the plain error and the owner tries again).
 * @param {{ token: string, fetch?: Function }} options
 */
export function bareOctokit({ token, fetch } = {}) {
  if (typeof token !== 'string' || !token) throw new TypeError('bareOctokit needs a token.');
  const octokit = new Octokit({ auth: token, userAgent: USER_AGENT, request: fetch ? { fetch } : {} });
  octokit.hook.before('request', (options) => { options.headers['x-github-api-version'] = GITHUB_API_VERSION; });
  return octokit;
}

/**
 * Request key for a write (A8): `rmcp_<tool>_<sha256(account, tool, args)>_<10-minute bucket>`. `dryRun`, `confirm`,
 * `fields` and `detail` never change it, so previewing a write and then confirming it yield the same key. A caller's
 * `requestKey` argument replaces the arguments in the hash, so the same intent retried with different wording is
 * still one write.
 * @param {{ connection: { default_account: string }, now?: () => number }} ctx
 */
export function requestKey(ctx, tool, args = {}) {
  const account = String(args.owner ?? ctx.connection.default_account ?? '').toLowerCase();
  const basis = typeof args.requestKey === 'string' && args.requestKey
    ? canonical({ requestKey: args.requestKey })
    : canonical(Object.fromEntries(Object.entries({ ...args, ...(typeof args.owner === 'string' ? { owner: account } : {}) })
      .filter(([k]) => !KEY_EXCLUDED_ARGS.includes(k))));
  const digest = crypto.createHash('sha256').update(`${account}\n${tool}\n${basis}`).digest('hex');
  const bucket = Math.floor((ctx.now ?? Date.now)() / BUCKET_MS);
  return `rmcp_${tool}_${digest}_${bucket}`;
}

function resolveAccount(connection, owner) {
  const wanted = String(owner ?? connection.default_account ?? '');
  const match = (connection.accounts || []).find((login) => login.toLowerCase() === wanted.toLowerCase());
  if (!match) {
    throw new GithubClientError('outside_scope',
      `"${wanted}" is not one of the GitHub accounts this connection may use (${(connection.accounts || []).join(', ') || 'none'}).`,
      { account: wanted });
  }
  return match;
}

/**
 * Builds the Octokit for one request (A9: never shared between requests, so a token never outlives its request).
 * @param {object} ctx `{ connection, db, credentials, fetch?, now?, sleep?, budgetMs?, retryAfterBaseValue? }` where
 *   `credentials.token({ account, cred, scope })` returns the token string (A-5 supplies it).
 * @param {{ owner?: string, cred?: 'I'|'U'|'K', scope?: object }} target the account to act as and the credential kind
 */
export async function githubFor(ctx, { owner, cred = 'I', scope } = {}) {
  if (!CREDENTIAL_KINDS.includes(cred)) throw new TypeError(`Unknown credential kind "${cred}".`);
  const account = resolveAccount(ctx.connection, owner);
  const token = await ctx.credentials?.token({ account, cred, scope });
  if (typeof token !== 'string' || !token) {
    throw new GithubClientError('no_credentials', `No GitHub credential is set up for ${account}. Open the setup page to add one.`, { account });
  }
  const now = ctx.now ?? Date.now;
  const deadline = now() + (ctx.budgetMs ?? DEFAULT_BUDGET_MS);
  const withinBudget = (retryAfterSeconds, retryCount) => retryCount < 1 && now() + retryAfterSeconds * 1000 <= deadline;
  const baseValue = ctx.retryAfterBaseValue ?? 1000;

  const octokit = new CompositeOctokit({
    auth: token,
    userAgent: USER_AGENT,
    request: ctx.fetch ? { fetch: ctx.fetch } : {},
    throttle: {
      id: account,
      retryAfterBaseValue: baseValue,
      global: noQueue, auth: noQueue, search: noQueue, write: noQueue, notifications: noQueue,
      onRateLimit: (retryAfter, _options, _octokit, retryCount) => withinBudget(retryAfter, retryCount),
      onSecondaryRateLimit: (retryAfter, _options, _octokit, retryCount) => withinBudget(retryAfter, retryCount)
    },
    retry: { retries: 2, retryAfterBaseValue: baseValue }
  });

  octokit.hook.wrap('request', async (request, options) => {
    // `options.url` is still a template here ("/repos/{owner}/{repo}"); the expanded, encoded URL is what GitHub sees.
    const { method: rawMethod, url } = octokit.request.endpoint.parse(options);
    const method = String(rawMethod || 'GET').toUpperCase();
    const write = isWrite(method, { ...options, url });
    const resource = resourceFor(method, url);
    options.headers = { ...options.headers, 'x-github-api-version': GITHUB_API_VERSION };
    await assertNotBlocked(ctx.db, account, resource);
    if (write) {
      options.request = { ...options.request, retries: 0 }; // a write is never replayed after an error (A8)
      await takeWriteSlot(ctx.db, `${account}:${cred}`, { sleep: ctx.sleep });
    }
    const parsedUrl = new URL(url, 'https://api.github.com');
    const urlKey = !write && options.request?.etag ? parsedUrl.pathname + parsedUrl.search : null;
    let cached = null;
    if (urlKey) {
      cached = await ctx.db.getEtag(account, urlKey);
      if (cached) options.headers = { ...options.headers, 'if-none-match': cached.etag };
    }
    let response;
    try {
      response = await request(options);
    } catch (error) {
      if (error?.status === 304 && cached) {
        return { status: 200, url, headers: error.response?.headers ?? {}, data: cached.body, notModified: true };
      }
      throw await asRateLimited(ctx, account, resource, error);
    }
    try {
      await recordRate(ctx.db, account, response.headers, { status: response.status, fallbackResource: resource, now });
      const etag = response.headers?.etag;
      if (urlKey && etag) await ctx.db.putEtag(account, urlKey, etag, response.data);
    } catch { /* bookkeeping must never turn a completed GitHub call into a failure */ }
    return response;
  });
  return octokit;
}

/** Records what a failed response says about rate limits and, when it is one, replaces it with `rate_limited`. */
async function asRateLimited(ctx, account, resource, error) {
  const headers = error?.response?.headers;
  const status = error?.status;
  const now = ctx.now ?? Date.now;
  const graphqlLimit = error?.message === 'GraphQL Rate Limit Exceeded';
  let recorded = null;
  try { recorded = headers ? await recordRate(ctx.db, account, headers, { status, fallbackResource: resource, now }) : null; } catch { /* see above */ }
  const limited = graphqlLimit || ((status === 403 || status === 429)
    && (recorded?.blockedUntil || /rate limit/i.test(String(error?.message ?? '')) || recorded?.remaining === 0));
  if (!limited) return error;
  let until = recorded?.blockedUntil;
  if (!until) {
    until = new Date(now() + 60_000);
    try { await ctx.db.recordRateState({ account, resource, remaining: recorded?.remaining ?? null, resetAt: recorded?.resetAt ?? null, blockedUntil: until }); } catch { /* see above */ }
  }
  return rateLimited(account, recorded?.resource ?? resource, until);
}

/**
 * Every item of a paginated list, following `Link` headers, up to `max` items.
 * @returns {Promise<{ items: any[], capped: boolean }>} `capped` is true when more items exist than were returned.
 */
export async function listAll(octokit, route, params = {}, { max = 1000 } = {}) {
  const items = [];
  let capped = false;
  for await (const page of octokit.paginate.iterator(route, { per_page: 100, ...params })) {
    items.push(...page.data);
    if (items.length >= max) {
      capped = items.length > max || /rel="next"/.test(String(page.headers?.link ?? ''));
      break;
    }
  }
  return { items: items.slice(0, max), capped };
}

/** Runs a GraphQL document. Tests validate every document against the vendored schema (fake GitHub). */
export async function graphql(octokit, query, variables = {}) {
  return await octokit.graphql(query, variables);
}
