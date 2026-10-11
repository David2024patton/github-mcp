// The owner's private setup page and the three GitHub redirects that finish its steps (A4, A5, A10, A11). The page is the
// only place a GitHub credential is entered or a one-time secret is shown. Every action needs the administrator passphrase
// (with the same lockout as the connector login), a same-origin form post and a double-submit CSRF token, and every
// credential step is refused unless this is the production deployment. The redirects from GitHub carry an unguessable
// `state` created only after the passphrase was accepted; a state works once and expires.
import { createHash } from 'node:crypto';
import { LOCKOUT_WINDOW_MINUTES, clientIp, evaluateLogin, randomToken, secretsMatch } from '../core/oauth.js';
import { only, paramsOf, publicOrigin, send } from '../core/http.js';
import { buildManifest, isValidLogin, manifestFormUrl } from './app-manifest.js';
import { bareOctokit } from './client.js';
import { readBack } from './setup-readback.js';
import { renderSetup, resultPage } from './setup-html.js';
import { PRODUCTION_NAMES_KEY, cleanNames, productionNames } from '../tools/production-guard.js';
import { protectedList } from '../tools/protect-guard.js';
import { OWN_PEOPLE_KEY, cleanLogins, extraOwnPeople } from '../tools/people-guard.js';
import { spendStatus } from '../tools/spend-guard.js';
import { dollars as money } from '../github/prices.js';

const HTML = 'text/html; charset=utf-8';
const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com; base-uri 'none'; frame-ancestors 'none'";
const COOKIE = 'github_setup_csrf';
const OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const NOT_PRODUCTION = 'Credentials can only be set up on the production deployment. Preview deployments share the database but never hold or add credentials.';
const csrfCookie = (req) => new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{43})`).exec(String(req.headers?.cookie || ''))?.[1] || null;
const plainStatus = (error) => (error?.status ? `GitHub answered ${error.status}` : 'GitHub could not be reached');

/** @param {{ db: object, credentials: object, oneTimeStore?: object, env?: object, fetch?: Function, now?: () => number }} deps */
export function createSetupHandlers({ db, credentials, oneTimeStore, env = process.env, fetch = globalThis.fetch }) {
  const isProduction = () => env.VERCEL_ENV === 'production';

  function frame(res, status, body) {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Referrer-Policy', 'no-referrer');
    return send(res, status, body, HTML);
  }
  function newCsrf(res) {
    const csrf = randomToken(32);
    res.setHeader('Set-Cookie', `${COOKIE}=${csrf}; Max-Age=600; Path=/api/github; HttpOnly; Secure; SameSite=Strict`);
    return csrf;
  }
  function origin(res) {
    try { return publicOrigin(env); } catch { send(res, 503, { error: 'server_not_configured', description: 'Set PUBLIC_BASE_URL first' }); return null; }
  }

  // ---- GET /api/github/setup (the page, and the install redirect from GitHub) ----
  async function setupGet(req, res) {
    if (!origin(res)) return;
    const installationId = Number(req.query?.installation_id);
    if (Number.isSafeInteger(installationId) && installationId > 0) return await installReturn(res, installationId);
    const csrf = newCsrf(res);
    return frame(res, 200, renderSetup({ csrf, show: String(req.query?.show || '') }));
  }

  /** GitHub sends the owner back here after installing. Nothing in the URL is trusted: the installation is read from GitHub as the App. */
  async function installReturn(res, installationId) {
    try {
      const accounts = await db.listAccounts();
      for (const appId of [...new Set(accounts.map((a) => a.app_id).filter((id) => id != null))]) {
        const octokit = bareOctokit({ token: await credentials.appJwt(appId), fetch });
        const found = await octokit.request('GET /app/installations/{installation_id}', { installation_id: installationId }).then((r) => r.data, () => null);
        const owner = found && accounts.find((a) => a.app_id === appId && a.login.toLowerCase() === String(found.account?.login).toLowerCase());
        if (!owner) continue;
        await db.setInstallation(owner.login, { installationId: found.id, repositorySelection: found.repository_selection, permissions: found.permissions ?? {}, status: found.suspended_at ? 'suspended' : 'active' });
        await db.deleteInstallationTokens(found.id);
        return frame(res, 200, resultPage({ title: 'App installed', message: `The GitHub App is installed on ${owner.login}. Use "Show my accounts" on the setup page to check everything.` }));
      }
      return frame(res, 404, resultPage({ title: 'Unknown installation', message: 'That installation does not belong to any GitHub App set up on this server. Nothing was changed.' }));
    } catch {
      return frame(res, 502, resultPage({ title: 'Could not check the installation', message: 'GitHub could not be asked about this installation. Open the setup page and press "Show my accounts" to retry.' }));
    }
  }

  // ---- POST /api/github/setup ----
  async function setupPost(req, res) {
    const expectedOrigin = origin(res);
    if (!expectedOrigin) return;
    if (String(req.headers?.origin || '') !== expectedOrigin) return send(res, 403, { error: 'forbidden', description: 'Origin check failed' });
    let p;
    try { p = paramsOf(req); } catch { return send(res, 400, { error: 'invalid_request' }); }
    const cookie = csrfCookie(req);
    if (!cookie || !p.csrf || !secretsMatch(p.csrf, cookie)) return send(res, 403, { error: 'forbidden', description: 'Setup page expired; reload it' });
    if (!env.ADMIN_PASSPHRASE) return send(res, 503, { error: 'server_not_configured', description: 'Set ADMIN_PASSPHRASE first' });
    const login = await evaluateLogin({ ip: clientIp(req), supplied: p.passphrase, expected: env.ADMIN_PASSPHRASE, store: db });
    if (login.status === 'locked') {
      res.setHeader('Retry-After', String(LOCKOUT_WINDOW_MINUTES * 60));
      return frame(res, 429, renderSetup({ csrf: cookie, result: 'Too many attempts. Try again later.' }));
    }
    if (login.status !== 'ok') return frame(res, 401, renderSetup({ csrf: cookie, result: 'Incorrect administrator passphrase.' }));

    const page = (status, view) => frame(res, status, renderSetup({ csrf: cookie, ...view }));
    const action = String(p.action || '');
    if (action === 'status') {
      const accounts = [];
      for (const a of (await db.listAccounts()).slice(0, 10)) accounts.push(await readBack({ db, credentials, fetch }, a.login));
      return page(200, { accounts, productionNames: await productionNames(db), protectedList: await protectedList(db), spendLimits: await spendView(), ownPeopleExtra: await extraOwnPeople(db) });
    }
    if (action === 'reveal') {
      if (!isProduction()) return page(403, { blocked: NOT_PRODUCTION });
      try {
        const secret = oneTimeStore ? await oneTimeStore.consume(p.id) : null;
        return secret ? page(200, { revealed: secret.secret, result: `Secret type: ${secret.kind}${secret.account ? ` · account: ${secret.account}` : ''}.` })
          : page(410, { result: 'This one-time secret was used, expired, or does not exist.' });
      } catch { return page(400, { result: 'Unable to retrieve this secret.' }); }
    }
    if (action === 'set-production-names') return await setProductionNames(p, page);
    if (action === 'confirm-production') return await confirmProduction(p, page);
    if (action === 'set-spend-limit') return await setSpendLimit(p, page);
    if (action === 'set-own-people') return await setOwnPeople(p, page);
    if (action === 'save-protected' || action === 'remove-protected') return await editProtected(action, p, page);
    if (!['start-app', 'start-user-auth', 'add-fine-grained', 'add-classic'].includes(action)) return page(400, { result: 'Unknown action.' });
    if (!isProduction()) return page(403, { blocked: NOT_PRODUCTION });
    if (!credentials.keyConfigured()) return page(503, { keyHelp: 'The server has no encryption key, so it will not store anything. Set TOKEN_ENCRYPTION_KEY (see docs/DEPLOY.md) and reload.' });
    if (!isValidLogin(p.login)) return page(400, { result: 'Enter a valid GitHub account name.' });
    const account = p.login;

    if (action === 'start-app') {
      const accountType = p.accountType === 'User' ? 'User' : 'Organization';
      const state = randomToken(32);
      await db.createSetupState({ state, purpose: 'manifest', accountHint: account });
      return page(200, { manifestForm: { action: manifestFormUrl({ login: account, accountType, state }), manifest: JSON.stringify(buildManifest({ origin: expectedOrigin, login: account })) },
        result: `Ready to create the GitHub App for ${account}.` });
    }
    if (action === 'start-user-auth') {
      const row = await db.getAccount(account);
      const client = row?.app_id != null ? await credentials.clientCredentials(row.app_id) : null;
      if (!client) return page(404, { result: 'Create and install the GitHub App for that account first.' });
      const verifier = randomToken(48);
      const state = randomToken(32);
      await db.createSetupState({ state, purpose: 'user_auth', accountHint: row.login, codeVerifierEnc: credentials.sealVerifier(state, verifier) });
      const query = new URLSearchParams({ client_id: client.clientId, redirect_uri: `${expectedOrigin}/api/github/user-callback`, state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      res.setHeader('Location', `https://github.com/login/oauth/authorize?${query}`);
      res.setHeader('Content-Security-Policy', CSP);
      return send(res, 303, '', HTML);
    }
    return await addToken(action, account, p, page);
  }

  /** Names the owner adds to the built-in production names. They can only widen what counts as production, never shrink the built-in list. */
  async function setProductionNames(p, page) {
    if (!isProduction()) return page(403, { blocked: NOT_PRODUCTION });
    const environments = cleanNames(p.environments, 'environment');
    const branches = cleanNames(p.branches, 'branch');
    if (environments.error || branches.error) return page(400, { result: environments.error || branches.error });
    await db.setSetting(PRODUCTION_NAMES_KEY, { environments: environments.names, branches: branches.names });
    return page(200, { result: 'Saved. These names now count as production in addition to the built-in ones.', productionNames: await productionNames(db) });
  }

  const spendView = async () => {
    const rows = [];
    for (const a of (await db.listAccounts()).slice(0, 10)) {
      const st = await spendStatus({ db, now: () => Date.now() }, a.login);
      rows.push({ login: a.login, limit: money(st.limitCents), used: money(st.usedCents) });
    }
    return rows;
  };

  /** The owner's only way to raise the monthly spend limit (Claude's tool can only lower it). */
  async function setSpendLimit(p, page) {
    if (!isProduction()) return page(403, { blocked: NOT_PRODUCTION });
    if (!isValidLogin(p.login)) return page(400, { result: 'Enter a valid GitHub account name.' });
    const row = await db.getAccount(p.login);
    if (!row) return page(404, { result: 'That account is not set up on the server.' });
    const text = String(p.dollars ?? '').trim().replace(/^\$/, '');
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) return page(400, { result: 'Enter dollars as a number such as 25 or 19.50.' });
    const cents = Math.round(Number(text) * 100);
    await db.setSpendLimitCents(row.login, cents);
    const raised = cents > (Number(row.spend_limit_cents) || 0);
    await db.recordChange({ account: row.login, mode: 'setup', tool: 'setup_set_spend_limit', target: row.login, summary: `Monthly spend limit for ${row.login} set to ${money(cents)} (was ${money(Number(row.spend_limit_cents) || 0)})`,
      production: true, accessWidening: false, confirmed: true }).catch(() => {});
    return page(200, { result: `The monthly spend limit for ${row.login} is now ${money(cents)}${raised ? '. Actions that cost money still ask you first.' : '.'}`, spendLimits: await spendView() });
  }

  /** Extra names that count as the owner's own people (they reduce confirmations, so only this page sets them). */
  async function setOwnPeople(p, page) {
    if (!isProduction()) return page(403, { blocked: NOT_PRODUCTION });
    const cleaned = cleanLogins(p.logins);
    if (cleaned.error) return page(400, { result: cleaned.error });
    await db.setSetting(OWN_PEOPLE_KEY, { logins: cleaned.logins });
    await db.recordChange({ account: null, mode: 'setup', tool: 'setup_set_own_people', target: 'own_people', summary: `Extra own people set to: ${cleaned.logins.join(', ') || 'none'}`, production: true, accessWidening: true, confirmed: true }).catch(() => {});
    return page(200, { result: 'Saved. These names now count as your own people in addition to the built-in ones.', ownPeopleExtra: cleaned.logins });
  }

  /** The owner's only way to change the protected list. Loosening protection is logged as an access change. */
  async function editProtected(action, p, page) {
    if (!isProduction()) return page(403, { blocked: NOT_PRODUCTION });
    const kind = String(p.kind || '');
    const before = await protectedList(db);
    const target = String(p.target ?? '').trim().toLowerCase();
    const current = before.find((e) => e.kind === kind && e.target === target);
    let summary; let loosened;
    if (action === 'remove-protected') {
      if (!current) return page(404, { result: 'That entry is not on the list.' });
      await db.removeProtectedResource(kind, target);
      summary = `Removed ${kind} ${target} from the protected list (was ${current.level})`; loosened = true;
    } else {
      let saved;
      try { saved = await db.saveProtectedResource({ kind, target, level: String(p.level || ''), reason: p.reason }); } catch (error) { return page(400, { result: error instanceof TypeError ? error.message : 'That entry was not accepted.' }); }
      summary = `Protected list: ${kind} ${saved.target} is now ${saved.level}${current ? ` (was ${current.level})` : ''}`; loosened = current?.level === 'locked' && saved.level === 'pr-only';
    }
    await db.recordChange({ account: null, mode: 'setup', tool: `setup_${action.replace('-', '_')}`, target, summary, production: true, accessWidening: loosened, confirmed: true }).catch(() => {});
    return page(200, { result: `${summary}.`, protectedList: await protectedList(db) });
  }

  /** Step 2 of turning production on: the owner has asked Claude first (a pending request exists), and now proves it with the passphrase. */
  async function confirmProduction(p, page) {
    if (!isProduction()) return page(403, { blocked: NOT_PRODUCTION });
    if (!isValidLogin(p.login)) return page(400, { result: 'Enter a valid GitHub account name.' });
    const row = await db.getAccount(p.login);
    if (!row) return page(404, { result: 'That account is not set up on the server.' });
    const pending = await db.consumeSetupStateByHint('enable_production', row.login);
    if (!pending) return page(409, { result: `There is no waiting request for ${row.login}, or it expired (they last 10 minutes). Ask Claude to turn production on for ${row.login} first, then come back here.` });
    await db.setProductionEnabled(row.login, true);
    await db.recordChange({ account: row.login, mode: 'setup', tool: 'setup_confirm_production', target: row.login, summary: `Production turned ON for ${row.login} from the setup page`,
      production: true, accessWidening: true, confirmed: true }).catch(() => {});
    return page(200, { result: `Production is now ON for ${row.login}. Connections made in production mode can change its real repositories, always asking you first.` });
  }

  /** The two token boxes. A token is checked with GitHub before anything is stored, and only its last four characters are ever shown. */
  async function addToken(action, account, p, page) {
    const token = typeof p.token === 'string' ? p.token.trim() : '';
    if (token.length < 20 || /\s/.test(token)) return page(400, { result: 'That does not look like a GitHub token.' });
    let probe;
    try { probe = await bareOctokit({ token, fetch }).request('GET /rate_limit'); } catch (error) {
      return page(400, { result: `GitHub did not accept that token (${plainStatus(error)}). Nothing was saved.` });
    }
    const scopes = probe.headers['x-oauth-scopes'];
    if (action === 'add-fine-grained') {
      if (scopes !== undefined) return page(400, { result: 'That is a classic token. Classic tokens are not accepted here; create a fine-grained token instead. Nothing was saved.' });
      let owner;
      try { owner = (await bareOctokit({ token, fetch }).request('GET /users/{username}', { username: account })).data; } catch (error) {
        return page(400, { result: `GitHub could not find the account "${account}" (${plainStatus(error)}). Nothing was saved.` });
      }
      const existing = await db.getAccount(owner.login);
      if (existing && existing.credential_kind !== 'fine_grained') return page(409, { result: `${owner.login} already uses a GitHub App. Remove it before switching to a fine-grained token. Nothing was saved.` });
      await db.upsertAccount({ login: owner.login, accountId: owner.id, accountType: owner.type, label: p.label ? String(p.label).slice(0, 100) : owner.login, credentialKind: 'fine_grained' });
      const expires = Date.parse(probe.headers['github-authentication-token-expiration'] || '');
      await credentials.storeFineGrained(owner.login, token, { expiresAt: Number.isFinite(expires) ? new Date(expires) : null });
      return page(200, { result: `Saved the encrypted fine-grained token for ${owner.login} (ends in ${token.slice(-4)}).` });
    }
    const list = String(scopes ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (scopes === undefined || list.length !== 1 || list[0] !== 'notifications') {
      return page(400, { result: `This server only accepts a classic token with exactly the "notifications" scope (this one has: ${scopes === undefined ? 'not a classic token' : list.join(', ') || 'no scopes'}). Nothing was saved.` });
    }
    const row = await db.getAccount(account);
    if (!row) return page(404, { result: 'Set that account up first (create its GitHub App or add a fine-grained token).' });
    await credentials.storeClassic(row.login, token, list);
    return page(200, { result: `Saved the encrypted notifications token for ${row.login} (ends in ${token.slice(-4)}).` });
  }

  // ---- GET /api/github/manifest-callback?code&state ----
  async function manifestCallback(req, res) {
    if (!only(res, req, ['GET'])) return;
    const state = await db.consumeSetupState(String(req.query?.state || ''), 'manifest');
    const code = String(req.query?.code || '');
    if (!state || !/^[A-Za-z0-9_-]{8,128}$/.test(code)) {
      return frame(res, 400, resultPage({ title: 'Setup link expired', message: 'This GitHub App setup link is unknown, already used or too old. Start again from the setup page.' }));
    }
    try {
      if (!isProduction() || !credentials.keyConfigured()) throw new Error('not allowed');
      const created = (await bareOctokit({ fetch }).request('POST /app-manifests/{code}/conversions', { code })).data;
      const owner = created.owner;
      if (!owner?.login || !owner?.id) throw new Error('no owner');
      await credentials.storeApp(created, { ownerLogin: owner.login, ownerType: owner.type });
      await db.upsertAccount({ login: owner.login, accountId: owner.id, accountType: owner.type, label: state.account_hint || owner.login, credentialKind: 'app', appId: created.id });
      return frame(res, 200, resultPage({ title: 'GitHub App created', message: `The GitHub App for ${owner.login} was created and its keys are stored encrypted. Next: install it on ${owner.login}.`, installSlug: created.slug }));
    } catch {
      return frame(res, 502, resultPage({ title: 'Could not finish creating the App', message: 'GitHub did not complete the App setup, or the server could not store it. Nothing secret was shown. If the App now exists on GitHub, delete it there and start again.' }));
    }
  }

  // ---- GET /api/github/user-callback?code&state ----
  async function userCallback(req, res) {
    if (!only(res, req, ['GET'])) return;
    const state = await db.consumeSetupState(String(req.query?.state || ''), 'user_auth');
    const code = String(req.query?.code || '');
    if (!state || !code || code.length > 256) {
      return frame(res, 400, resultPage({ title: 'Sign-in link expired', message: 'This authorization link is unknown, already used or too old. Start again from the setup page.' }));
    }
    try {
      if (!isProduction() || !credentials.keyConfigured()) throw new Error('not allowed');
      const row = await db.getAccount(state.account_hint);
      const client = await credentials.clientCredentials(row.app_id);
      const stateValue = String(req.query.state);
      const response = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, code, redirect_uri: `${publicOrigin(env)}/api/github/user-callback`,
          code_verifier: credentials.openVerifier(stateValue, state.code_verifier_enc) })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error || !data.access_token) throw new Error('exchange refused');
      const me = (await bareOctokit({ token: data.access_token, fetch }).request('GET /user')).data;
      await credentials.storeUserAuthorization(row.login, { userLogin: me.login, accessToken: data.access_token, expiresIn: data.expires_in, refreshToken: data.refresh_token, refreshExpiresIn: data.refresh_token_expires_in });
      return frame(res, 200, resultPage({ title: 'Signed in', message: `You are authorized as ${me.login} for ${row.login}'s personal-settings tools.` }));
    } catch {
      return frame(res, 502, resultPage({ title: 'Could not finish signing in', message: 'GitHub did not complete the authorization. Nothing was saved. Start again from the setup page.' }));
    }
  }

  return {
    setup: async (req, res) => {
      if (!only(res, req, ['GET', 'POST'])) return;
      return req.method === 'GET' ? await setupGet(req, res) : await setupPost(req, res);
    },
    manifestCallback,
    userCallback
  };
}

