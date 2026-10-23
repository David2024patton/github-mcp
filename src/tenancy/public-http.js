// PUB-6 (dark): the web side of the simple connect flow. Plain-English pages, no scripts, strict CSP. Every failure shows a
// short generic message; nothing about why a sign-in was refused is revealed. All handlers answer 404 while the flow is off.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createPublicConnect, PublicConnectError, publicConnectEnabled } from './public-connect.js';
import { TenantCapacityError } from './runtime-limits.js';
import { escapeHtml as h, paramsOf, publicOrigin, send } from '../core/http.js';
import { COMMON_ZONES } from '../core/time-zone.js';
import { BRAND_CSS, brandHeader, brandFooter } from '../brand/brand.js';

const CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self' https://github.com; base-uri 'none'; frame-ancestors 'none'";
const FORM = 'gh_public_form', STATE = 'gh_public_state', GOD = 'gh_public_god', FORGET = 'gh_public_forget';
const FORM_PATH = '/api/oauth', STATE_PATH = '/api/github', GOD_PATH = '/api/tenant/optional';
const fresh = () => randomBytes(32).toString('base64url');
const cookieOf = (req, name) => new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9._-]{32,300})(?:;|$)`).exec(String(req.headers?.cookie || ''))?.[1] || null;
const setCookie = (name, value, path, same) => `${name}=${value}; Max-Age=600; Path=${path}; HttpOnly; Secure; SameSite=${same}`;
const clearCookie = (name, path) => `${name}=; Max-Age=0; Path=${path}; HttpOnly; Secure; SameSite=Lax`;
const STYLE = BRAND_CSS;
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function page(res, status, title, body, { cookies = [] } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Referrer-Policy', 'same-origin');
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  return send(res, status, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(title)}</title><style>${STYLE}</style></head><body><main>${brandHeader()}<h1>${h(title)}</h1>${body}${brandFooter()}</main></body></html>`, 'text/html; charset=utf-8');
}
function failure(res, error) {
  if (error instanceof TenantCapacityError) {
    res.setHeader('Retry-After', String(error.retryAfterSeconds));
    return page(res, 429, 'Busy right now', '<p>This connection is temporarily busy. Please try again in a minute.</p>');
  }
  if (error instanceof PublicConnectError && error.code !== 'refused')
    return page(res, error.code === 'capacity' ? 503 : 403, error.code === 'capacity' ? 'Not available right now' : 'Could not connect', `<p>${h(error.message)}</p>`);
  return page(res, 403, 'Could not connect', '<p>GitHub could not verify this sign-in. Close this page and start again from your app.</p>');
}
const off = (res) => send(res, 404, { error: 'not_found' });
const make = (env, deps) => deps.connect ?? createPublicConnect({ env, ...deps });

/** POST /api/oauth/register while the flow is on. */
export async function publicRegister(req, res, { env = process.env, ...deps } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (!publicConnectEnabled(env)) return off(res);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'method_not_allowed' }); }
  try {
    return send(res, 201, await make(env, deps).registerClient(paramsOf(req)));
  } catch (error) {
    if (error instanceof PublicConnectError && error.code === 'invalid_client_metadata') return send(res, 400, { error: 'invalid_client_metadata', error_description: error.message });
    if (error instanceof PublicConnectError && error.code === 'capacity') return send(res, 503, { error: 'temporarily_unavailable', error_description: error.message });
    return send(res, 503, { error: 'temporarily_unavailable' });
  }
}

const HIDDEN = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state', 'resource', 'scope'];

/** GET/POST /api/oauth/authorize for a pcl_ client. */
export async function publicAuthorize(req, res, { env = process.env, ...deps } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (!publicConnectEnabled(env)) return off(res);
  try {
    const origin = publicOrigin(env), p = paramsOf(req), connect = make(env, deps);
    if (req.method === 'GET') {
      const info = await connect.inspect(p);
      const csrf = fresh();
      const fields = HIDDEN.map((k) => `<input type="hidden" name="${k}" value="${h(p[k] ?? '')}">`).join('');
      const who = info.clientName ? h(info.clientName) : 'your app';
      const host = h(new URL(p.redirect_uri).host);
      return page(res, 200, 'Connect GitHub', `<p>Sign in with GitHub to let ${who} use your GitHub through Robinson GitHub MCP. You will not be asked for any password or token here.</p>` +
        `<p><strong>Only continue if you started this from an app you trust.</strong> After GitHub, you will be sent back to <code>${host}</code>.</p>` +
        `<form method="post" action="/api/oauth/authorize">${fields}<input type="hidden" name="form_csrf" value="${csrf}">` +
        '<label>Your time zone<select name="time_zone">' + COMMON_ZONES.map((z) => `<option value="${h(z)}"${z === 'UTC' ? ' selected' : ''}>${h(z === 'UTC' ? 'UTC (default)' : z.replace('_', ' '))}</option>`).join('') + '</select></label><small>Times your assistant shows you use this zone. Leave it on UTC if you are unsure.</small>' +
        '<label>Accounts to connect (optional)<input name="account" maxlength="400" autocomplete="off" placeholder="leave blank for all"></label>' +
        '<small>Leave blank to connect every account where the GitHub App is installed and you have access: your own, a client\'s, a test account. Or type account names separated by commas.</small>' +
        '<div class="choice"><input type="radio" id="t1" name="tier" value="standard" checked><label for="t1"><strong>Standard</strong><small>Everything that signing in with GitHub alone can unlock. Nothing else to enter.</small></label></div>' +
        '<div class="choice"><input type="radio" id="t2" name="tier" value="god"><label for="t2"><strong>God mode</strong><small>Also lets you add extra keys (package and notifications tokens) on the next page to unlock the remaining tools. You can skip any of them.</small></label></div>' +
        '<div class="choice"><input type="checkbox" id="c1" name="read_only" value="yes"><label for="c1"><strong>Read-only (optional)</strong><small>Your assistant can look and preview but cannot change anything. Leave this unticked for the full toolset: on accounts you own it can create, edit and merge things, and it asks you to confirm each change first.</small></label></div>' +
        '<button type="submit">Continue to GitHub</button></form><p><small>Connected before and want your data removed? <a href="/api/oauth/authorize?forget=1">Delete my data</a>.</small></p>',
        { cookies: [setCookie(FORM, csrf, FORM_PATH, 'Strict')] });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { error: 'method_not_allowed' }); }
    const cookie = cookieOf(req, FORM);
    if (String(req.headers?.origin || '') !== origin || !cookie || !same(cookie, p.form_csrf)) return failure(res, null);
    const { url, csrfState } = await connect.start(p);
    res.setHeader('Set-Cookie', [clearCookie(FORM, FORM_PATH), setCookie(STATE, csrfState, STATE_PATH, 'Lax')]);
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Location', url);
    return res.status(302).end();
  } catch (error) { return failure(res, error); }
}

/** "Delete my data", by the person themselves. GET shows what will happen; POST starts a GitHub sign-in (proof it is them),
 * and a second POST, only after that sign-in, deletes. Reached at /api/oauth/authorize?forget=1 so it needs no extra route. */
export async function publicForget(req, res, { env = process.env, ...deps } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (!publicConnectEnabled(env)) return off(res);
  try {
    const origin = publicOrigin(env), p = paramsOf(req), connect = make(env, deps);
    if (req.method === 'GET') {
      const csrf = fresh();
      return page(res, 200, 'Delete my data', '<p>This removes everything Robinson GitHub MCP stores about you: your sign-in, saved GitHub access, settings, change record and saved results. Your assistant stops working with your accounts straight away. Nothing on GitHub itself is changed or deleted.</p>' +
        '<p>First you will sign in with GitHub so we know it is you. Then you confirm. This cannot be undone, but you can connect again later as a new person.</p>' +
        `<form method="post" action="/api/oauth/authorize"><input type="hidden" name="forget" value="1"><input type="hidden" name="action" value="start"><input type="hidden" name="form_csrf" value="${csrf}"><button type="submit">Sign in with GitHub to continue</button></form>`,
      { cookies: [setCookie(FORM, csrf, FORM_PATH, 'Strict')] });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { error: 'method_not_allowed' }); }
    if (String(req.headers?.origin || '') !== origin) return failure(res, null);
    if (p.action === 'confirm') {
      const cookie = cookieOf(req, FORGET);
      if (!cookie || !same(cookie, p.csrf)) return failure(res, null);
      const deleted = await connect.forgetConfirm({ handle: cookie, browserCsrf: p.csrf });
      return page(res, 200, deleted ? 'Your data is deleted' : 'Nothing to delete', deleted
        ? '<p>Done. Your sign-in, saved access, settings, change record and saved results are removed for good. You can close this page.</p>'
        : '<p>We no longer hold any data for you. You can close this page.</p>', { cookies: [clearCookie(FORGET, FORM_PATH)] });
    }
    const cookie = cookieOf(req, FORM);
    if (!cookie || !same(cookie, p.form_csrf)) return failure(res, null);
    const { url, csrfState } = await connect.startForget();
    res.setHeader('Set-Cookie', [clearCookie(FORM, FORM_PATH), setCookie(STATE, csrfState, STATE_PATH, 'Lax')]);
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Location', url);
    return res.status(302).end();
  } catch (error) { return failure(res, error); }
}

function forgetPage(res, forget) {
  if (forget.none) return page(res, 200, 'Nothing to delete', '<p>We found no data stored for this GitHub account. You can close this page.</p>', { cookies: [clearCookie(STATE, STATE_PATH)] });
  return page(res, 200, 'Confirm deletion', '<p>You are signed in. Press the button to delete everything stored about you for good. This cannot be undone.</p>' +
    `<form method="post" action="/api/oauth/authorize"><input type="hidden" name="forget" value="1"><input type="hidden" name="action" value="confirm"><input type="hidden" name="csrf" value="${h(forget.handle)}"><button type="submit">Yes, delete my data</button></form>`,
  { cookies: [clearCookie(STATE, STATE_PATH), setCookie(FORGET, forget.handle, FORM_PATH, 'Strict')] });
}

function godPage(res, god, cookieValue) {
  const accounts = god.accounts;
  const options = accounts.map((a) => `<option value="${h(a.login)}">${h(a.login)}</option>`).join('');
  const pick = accounts.length > 1 ? `<label>For which account?<select name="account">${options}</select></label>` : '';
  const form = (choice, text, note) => `<form method="post" action="${GOD_PATH}"><input type="hidden" name="connect_god" value="1"><input type="hidden" name="csrf" value="${h(cookieValue)}"><input type="hidden" name="choice" value="${choice}">${choice === 'finish' ? '' : pick}<p><small>${note}</small></p><button type="submit">${text}</button></form>`;
  const org = accounts.some((a) => a.organization);
  return page(res, 200, 'God mode', '<p>You are signed in. Each button below uses up this page, so choose what to do first. You can run Connect again later to add another key.</p>' +
    form('notifications', 'Add a notifications token', 'Opens the notification tools. You create the token on GitHub (only the notifications box) and paste it on the next page, never into a chat.') +
    (org ? form('package', 'Add a package token', 'Opens the package tools for an organization account. Needs read, write and delete package access.') : '') +
    form('finish', 'Finish without adding keys', 'Return to your app now with the standard tools.'),
  { cookies: [clearCookie(STATE, STATE_PATH), setCookie(GOD, cookieValue, GOD_PATH, 'Strict')] });
}

/** GET /api/github/user-callback when the state starts with pc. */
export async function publicCallback(req, res, { env = process.env, ...deps } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (!publicConnectEnabled(env)) return off(res);
  try {
    const browserCsrf = cookieOf(req, STATE);
    const result = await make(env, deps).finish({ state: req.query?.state, code: req.query?.code, browserCsrf });
    if (result.forget) return forgetPage(res, result.forget);
    if (result.god) return godPage(res, result.god, result.god.handle);
    res.setHeader('Set-Cookie', clearCookie(STATE, STATE_PATH));
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (result.install) {
      res.setHeader('Set-Cookie', [clearCookie(STATE, STATE_PATH), setCookie(STATE, result.install.csrfState, STATE_PATH, 'Lax')]);
      res.setHeader('Location', result.install.url);
      return res.status(302).end();
    }
    res.setHeader('Location', result.redirect);
    return res.status(302).end();
  } catch (error) {
    res.setHeader('Set-Cookie', clearCookie(STATE, STATE_PATH));
    return failure(res, error);
  }
}

/** GET /api/github/setup?installation_id=…&state=pc.… : GitHub sent the person back after installing the App. */
export async function publicInstallReturn(req, res, { env = process.env, ...deps } = {}) {
  res.setHeader('Cache-Control', 'no-store');
  if (!publicConnectEnabled(env)) return off(res);
  try {
    const { url, csrfState } = await make(env, deps).resumeInstall({ state: req.query?.state, browserCsrf: cookieOf(req, STATE) });
    res.setHeader('Set-Cookie', [clearCookie(STATE, STATE_PATH), setCookie(STATE, csrfState, STATE_PATH, 'Lax')]);
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Location', url);
    return res.status(302).end();
  } catch (error) {
    res.setHeader('Set-Cookie', clearCookie(STATE, STATE_PATH));
    return failure(res, error);
  }
}

/** POST from the God-mode page (mounted on /api/tenant/optional). Returns {redirect} or {optional}; throws on refusal. */
export async function publicGodPost(req, { env = process.env, ...deps } = {}) {
  if (!publicConnectEnabled(env)) throw new PublicConnectError('refused', '');
  const p = paramsOf(req), cookie = cookieOf(req, GOD);
  if (String(req.headers?.origin || '') !== publicOrigin(env) || !cookie || !same(cookie, p.csrf)) throw new PublicConnectError('refused', '');
  return await make(env, deps).godChoose({ handle: cookie, browserCsrf: p.csrf, choice: p.choice, account: p.account });
}
export const clearGodCookie = () => clearCookie(GOD, GOD_PATH);
export const publicFailure = failure;
