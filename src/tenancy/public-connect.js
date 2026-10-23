// PUB-6 (dark): the simple public connect flow. A person registers an MCP client, signs in with GitHub, the server finds
// (or sends them to install) this service's GitHub App for the account they name, creates their own isolated tenant on
// first sign-in, stores their own sealed GitHub authorization, and hands the MCP client an authorization code.
//
// Safety shape (everything fails closed and says nothing about why):
// * Off unless GITHUB_PUBLIC_CONNECT=enabled on the production deployment, and the private-tenant machinery is configured.
// * Hard caps: public clients, open sign-ins, and self-serve tenants (kill switch = unset the flag).
// * The person is whoever GitHub's numeric id says they are; typed names are only a request, verified against the
//   installations their own token can see. The GitHub bearer lives in this request's memory only.
// * A public client's secret is stored as a hash; the tenant copy is the hash too.
// * Authorization codes carry the tenant routing marker `pc.<tenant>.<identity>.<random>`: only a selector. The tenant's
//   own single-use code row, the client secret hash, PKCE and live membership revisions still decide everything.
import { validZone, ZONE_SETTING } from '../core/time-zone.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { createTenantDirectory, initializeProvisionedTenant, openAuthorizedTenantDb } from './directory.js';
import { admitTenantOAuth, recordTenantMetric } from './runtime-limits.js';
import { verifyGithubBearerIdentity, listUserAppInstallations, verifyAccountAuthority } from './github-identity.js';
import { storePilotUserGrant } from './user-authorization.js';
import { createPrivateOptionalEnrollment } from './optional-setup.js';
import { pilotAppClient } from './pilot-app-client.js';
import { createDb } from '../db.js';
import { hashToken, randomToken, validRedirectUri } from '../core/oauth.js';
import { publicOrigin } from '../core/http.js';
import { isPublicClientId, publicAuthCode, parsePublicCode } from './public-code.js';

const gitAuthorize = 'https://github.com/login/oauth/authorize';
const gitToken = 'https://github.com/login/oauth/access_token';
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const STATE = /^pc\.[A-Za-z0-9_-]{32,256}$/;
const CODE = /^[A-Za-z0-9_-]{8,256}$/;
const TENANT_KEY = 'public-connect';
const sha = (text) => createHash('sha256').update(text).digest('hex');
const random = (n) => randomBytes(n).toString('base64url');

/** A refusal whose message is safe to show a person. `code` picks the page; nothing else about why is revealed. */
export class PublicConnectError extends Error {
  constructor(code, message) { super(message); this.name = 'PublicConnectError'; this.code = code; }
}
export const FORGET_CLIENT = 'pcl_forget_my_data_built_in_page_0000000';
// Claude asks for the permission names this server advertises in its discovery document; sign-in gives no extra power for them.
const ADVERTISED_SCOPES = ['github.notifications.read'];
// `why` is an internal label for the server log only (never shown to the person, never a secret).
const refused = (why = '') => Object.assign(new PublicConnectError('refused', 'GitHub could not verify this sign-in. Start again from your client.'), { why });

export { isPublicClientId, publicAuthCode, parsePublicCode };
export const publicConnectEnabled = (env = process.env) => env.GITHUB_PUBLIC_CONNECT === 'enabled';

const whole = (text, fallback, max) => {
  const n = Number(text ?? fallback);
  return Number.isSafeInteger(n) && n >= 1 && n <= max ? n : fallback;
};

export function createPublicConnect({ env = process.env, fetchImpl = fetch, rootSqlFactory = neon, tenantSqlFactory = neon } = {}) {
  const appId = Number(env.GITHUB_PILOT_APP_ID);
  const limits = Object.freeze({
    maxClients: whole(env.GITHUB_PUBLIC_MAX_CLIENTS, 500, 100000),
    maxOpenFlows: whole(env.GITHUB_PUBLIC_MAX_OPEN_FLOWS, 200, 100000),
    maxTenants: whole(env.GITHUB_PUBLIC_MAX_TENANTS, 25, 1000000)
  });
  const active = () => {
    if (!publicConnectEnabled(env) || env.GITHUB_PRIVATE_TENANT_PILOT !== 'enabled' ||
        env.VERCEL_ENV !== 'production' || !env.DATABASE_URL ||
        !Number.isSafeInteger(appId) || appId <= 0) throw refused('r1');
    return publicOrigin(env);
  };
  const rootSql = () => rootSqlFactory(env.DATABASE_URL);
  const directory = () => createTenantDirectory(rootSql());
  let schemaReady = null;
  const ensureSchema = () => {
    schemaReady ??= directory().initSchema();
    schemaReady.catch(() => { schemaReady = null; });
    return schemaReady;
  };
  const callback = () => active() + '/api/github/user-callback';

  async function loadClient(clientId, redirectUri) {
    const client = await directory().getPublicClient(clientId);
    if (!client || !client.redirectUris.includes(redirectUri)) throw refused('r2');
    return client;
  }
  function checkAuthorizeRequest(p) {
    const origin = active();
    if (!isPublicClientId(p.client_id) || p.client_id === FORGET_CLIENT || p.response_type !== 'code' || p.code_challenge_method !== 'S256' ||
        !CHALLENGE.test(String(p.code_challenge ?? '')) || p.resource !== origin + '/api/mcp' ||
        typeof p.redirect_uri !== 'string' || !validRedirectUri(p.redirect_uri) ||
        (p.state !== undefined && (typeof p.state !== 'string' || p.state.length > 256)) ||
        (p.scope !== undefined && !(typeof p.scope === 'string' && p.scope.split(/\s+/).filter(Boolean).every((x) => ADVERTISED_SCOPES.includes(x))))) throw refused('r3');
  }

  /** RFC 7591 registration for the public flow. Capped; the secret is shown once and only its hash is kept. */
  async function registerClient(body) {
    active(); await ensureSchema();
    const uris = body?.redirect_uris;
    if (!Array.isArray(uris) || uris.length < 1 || uris.length > 8 || new Set(uris).size !== uris.length ||
        !uris.every((u) => typeof u === 'string' && validRedirectUri(u)) ||
        (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== 'client_secret_post'))
      throw new PublicConnectError('invalid_client_metadata', 'One to eight valid, distinct redirect URIs are required.');
    const clientId = 'pcl_' + random(24), secret = randomToken(32);
    const name = typeof body.client_name === 'string' ? body.client_name.slice(0, 100) : null;
    const stored = await directory().createPublicClient({ clientId, secretHash: hashToken(secret), redirectUris: uris,
      clientName: name, maxClients: limits.maxClients });
    if (!stored) throw new PublicConnectError('capacity', 'New connections are paused for now. Please try again later.');
    return Object.freeze({ client_id: clientId, client_secret: secret, client_secret_expires_at: 0, redirect_uris: [...uris],
      token_endpoint_auth_method: 'client_secret_post', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
  }

  /** Read-only check used before the consent page is shown. */
  async function inspect(p) {
    active(); await ensureSchema(); checkAuthorizeRequest(p);
    const client = await loadClient(p.client_id, p.redirect_uri);
    return Object.freeze({ clientName: client.clientName });
  }

  async function openSignIn({ client, flow, stage = 'signin', afterInstall = false }) {
    const dir = directory();
    const state = 'pc.' + random(32), verifier = random(48);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const stored = await dir.createPublicFlow({ stateHash: sha(state), stage, clientId: client.clientId,
      redirectUri: flow.redirectUri, clientState: flow.clientState ?? null, codeChallenge: flow.codeChallenge,
      tier: flow.tier, accountLogin: flow.accountLogin ?? null, allowChanges: flow.allowChanges === true, timeZone: flow.timeZone ?? null, purpose: flow.purpose ?? null,
      providerVerifier: stage === 'signin' ? verifier : null, maxOpen: limits.maxOpenFlows, afterInstall });
    if (!stored) throw new PublicConnectError('capacity', 'Too many people are connecting right now. Please try again in a few minutes.');
    if (stage !== 'signin') return { state };
    const appClient = await pilotAppClient({ env, db: createDb(rootSql()) });
    const q = new URLSearchParams({ client_id: appClient.clientId, redirect_uri: callback(), state,
      code_challenge: challenge, code_challenge_method: 'S256' });
    return { url: gitAuthorize + '?' + q.toString(), csrfState: state };
  }

  /** Account names typed on the consent page: blank means every account where the App is installed and visible to this
   * sign-in; otherwise up to ten names, comma or space separated. */
  const parseAccounts = (text) => {
    if (typeof text !== 'string' || !text.trim()) return null;
    const names = [...new Set(text.split(/[\s,]+/).filter(Boolean).map((n) => n.toLowerCase()))];
    if (names.length < 1 || names.length > 10 || !names.every((n) => LOGIN.test(n))) throw refused('r4');
    return names.join(',');
  };

  /** The consent page was submitted: tier, optional account names, optional "read-only". */
  async function start(p) {
    active(); await ensureSchema(); checkAuthorizeRequest(p);
    const client = await loadClient(p.client_id, p.redirect_uri);
    const tier = p.tier === 'god' ? 'god' : 'standard';
    return await openSignIn({ client, flow: { redirectUri: p.redirect_uri, clientState: p.state, codeChallenge: p.code_challenge,
      tier, accountLogin: parseAccounts(p.account), allowChanges: p.read_only !== 'yes',
      timeZone: p.time_zone ? (validZone(String(p.time_zone)) ?? (() => { throw refused('r5'); })()) : null } });
  }

  const sameState = (state, browserCsrf) => typeof browserCsrf === 'string' && browserCsrf.length === state.length &&
    timingSafeEqual(Buffer.from(state), Buffer.from(browserCsrf));

  /** GitHub sent the person back to install the App and we resume: sign in once more (no second approval needed). */
  async function resumeInstall({ state, browserCsrf }) {
    active();
    if (!STATE.test(String(state ?? '')) || !sameState(state, browserCsrf)) throw refused('r6');
    const flow = await directory().consumePublicFlow(sha(state), 'install');
    if (!flow) throw refused('r7');
    const client = await loadClient(flow.clientId, flow.redirectUri);
    return await openSignIn({ client, flow, afterInstall: true });
  }

  /** One isolated tenant per verified GitHub person; every account that person connects lives inside it. */
  async function ensureTenant({ principal, installations, allowChanges }) {
    const dir = directory(), root = createDb(rootSql());
    const identityId = await dir.enrollVerifiedGithubSubject(principal.subject);
    const existing = await dir.findPilotTenant(identityId, TENANT_KEY);
    if (!existing && await dir.countPilotTenants() >= limits.maxTenants)
      throw new PublicConnectError('capacity', 'We are at our current capacity for new accounts. Please try again later.');
    const tenantId = await dir.provisionPilotForOwnerAccount(identityId, TENANT_KEY);
    const { db } = await initializeProvisionedTenant({ tenantId, connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory });
    const app = await root.getApp(appId);
    if (!app || !app.client_secret_enc || !app.private_key_enc || !app.webhook_secret_enc) throw refused('r8');
    await db.saveApp({ id: app.id, slug: app.slug, ownerLogin: app.owner_login, ownerType: app.owner_type, clientId: app.client_id,
      clientSecretEnc: app.client_secret_enc, privateKeyEnc: app.private_key_enc, webhookSecretEnc: app.webhook_secret_enc,
      permissions: app.permissions });
    if (!await dir.authorized(tenantId, identityId) && !await dir.activate(tenantId, 'gh_t_' + tenantId.replaceAll('-', ''))) throw refused('r9');
    if (!await dir.resolveAllowlistedPilotSubject(tenantId, principal.subject) &&
        !await dir.allowlistPilotIdentity(tenantId, identityId, identityId)) throw refused('r10');
    const logins = [];
    for (const installation of installations) {
      const login = installation.login.toLowerCase();
      await db.upsertAccount({ login, accountId: installation.accountId, accountType: installation.type, label: login,
        credentialKind: 'app', appId });
      if (!await db.setInstallation(login, { installationId: installation.installationId,
        repositorySelection: installation.repositorySelection, permissions: installation.permissions, status: 'active' })) throw refused('r11');
      // The person was verified as the owner of this account (own account, or organization admin) before we got here, and
      // used a page that says plainly that their assistant can make changes (each one still confirmed) unless they tick Read-only. That is their own confirmation.
      if (allowChanges === true && env.VERCEL_ENV === 'production') await db.setProductionEnabled(login, true);
      logins.push(login);
    }
    return { dir, tenantId, identityId, logins };
  }

  async function mintCode({ db, tenantId, identityId, logins, flow, mode }) {
    const code = publicAuthCode(tenantId, identityId);
    await db.createAuthCode({ code, clientId: flow.clientId, redirectUri: flow.redirectUri, codeChallenge: flow.codeChallenge,
      codeChallengeMethod: 'S256', defaultAccount: logins[0], accounts: logins, mode, profile: 'full', listing: 'compact' });
    const url = new URL(flow.redirectUri);
    url.searchParams.set('code', code);
    if (flow.clientState !== null && flow.clientState !== undefined) url.searchParams.set('state', flow.clientState);
    url.searchParams.set('iss', active());
    return url.toString();
  }

  /** Accounts this person administers (personal account first) where the App is not installed. Anything unexpected → none. */
  async function findOffers({ token, principal, installs }) {
    try {
      const have = new Set(installs.map((i) => i.login.toLowerCase()));
      const out = [];
      const subject = Number(principal.subject);
      if (!have.has(principal.login.toLowerCase()) && Number.isSafeInteger(subject) && subject > 0 && LOGIN.test(principal.login.toLowerCase()))
        out.push({ login: principal.login, id: subject, type: 'User' });
      const res = await fetchImpl('https://api.github.com/user/memberships/orgs?state=active&per_page=100', { signal: AbortSignal.timeout(8000),
        headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token, 'x-github-api-version': '2026-03-10' } });
      if (res.ok) {
        for (const m of (await res.json()) ?? []) {
          const org = m?.organization;
          if (m?.state === 'active' && m?.role === 'admin' && org && Number.isSafeInteger(org.id) && org.id > 0 &&
              LOGIN.test(String(org.login).toLowerCase()) && !have.has(String(org.login).toLowerCase())) out.push({ login: org.login, id: org.id, type: 'Organization' });
          if (out.length >= 8) break;
        }
      }
      return out;
    } catch { return []; }
  }

  /** The browser came back from GitHub sign-in. Returns {redirect} to the client, {god} for the extra-keys page, or
   * {install} to send the person to GitHub to install the App. Anything unexpected is a generic refusal. */
  async function finish({ state, code, browserCsrf }) {
    const started = Date.now(); let metricSql = null, outcome = 'error';
    try {
      active();
      if (!STATE.test(String(state ?? '')) || !CODE.test(String(code ?? '')) || !sameState(state, browserCsrf)) throw refused('r12');
      const dir = directory();
      const flow = await dir.consumePublicFlow(sha(state), 'signin');
      if (!flow) throw refused('r13');
      const client = await loadClient(flow.clientId, flow.redirectUri);
      const appClient = await pilotAppClient({ env, db: createDb(rootSql()) });
      const exchange = await fetchImpl(gitToken, { method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: appClient.clientId, client_secret: appClient.clientSecret, code,
          redirect_uri: callback(), code_verifier: flow.providerVerifier }) });
      if (!exchange.ok) throw refused('r14');
      const data = await exchange.json();
      if (!data?.access_token || data.error) throw refused('r15');
      const principal = await verifyGithubBearerIdentity(data.access_token, { fetchImpl });
      if (flow.purpose === 'forget') { outcome = 'ok'; return await forgetLookup(principal); }
      const installs = await listUserAppInstallations(data.access_token, { appId, fetchImpl });
      if (installs === null) throw refused('r16');
      const asked = flow.accountLogin ? flow.accountLogin.split(',') : null;
      const candidates = (asked ? installs.filter((i) => asked.includes(i.login.toLowerCase())) : installs).slice(0, 10);
      // Installation tokens act with the App's own rights, so only accounts this person owns (their personal account, or an
      // organization where they are an admin) may be connected. Others are skipped quietly.
      const chosen = [];
      for (const installation of candidates)
        if (await verifyAccountAuthority(data.access_token, { installation, subject: principal.subject, fetchImpl })) chosen.push(installation);
      if (chosen.length === 0) {
        if (flow.afterInstall) throw new PublicConnectError('no_installation',
          'The GitHub App is not installed on that account yet, or you are not an owner of it. Ask an owner of the account to install it (or connect it themselves), then connect again.');
        const root = createDb(rootSql());
        const app = await root.getApp(appId);
        if (!app?.slug || !/^[a-z0-9-]{1,100}$/.test(app.slug)) throw refused('r17');
        const next = await openSignIn({ client, flow, stage: 'install' });
        return { install: { url: `https://github.com/apps/${app.slug}/installations/new?state=${next.state}`, csrfState: next.state } };
      }
      // Accounts the person could add (their own personal account, organizations they administer) that do not have the App yet.
      // Offered AFTER the connection is safely made, so cancelling GitHub's install page never loses it. Best effort only.
      const offers = asked ? [] : await findOffers({ token: data.access_token, principal, installs });
      // The signed-in person's own account first (if connected), so a developer's default is their own.
      chosen.sort((x, y) => Number(y.login.toLowerCase() === principal.login.toLowerCase()) - Number(x.login.toLowerCase() === principal.login.toLowerCase()));
      const made = await ensureTenant({ principal, installations: chosen, allowChanges: flow.allowChanges });
      const { db, sql } = await openAuthorizedTenantDb({ directory: made.dir, tenantId: made.tenantId,
        verifiedIdentityId: made.identityId, connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory });
      metricSql = sql;
      await admitTenantOAuth(sql, flow.clientId);
      // Display-only; a blank choice keeps whatever the person saved before (UTC if nothing).
      if (flow.timeZone) await db.setSetting(ZONE_SETTING, flow.timeZone);
      const latest = await made.dir.authorizedPilotIdentity(made.tenantId, made.identityId);
      if (!latest) throw refused('r18');
      const expiresIn = Number(data.expires_in ?? 28800);
      const refreshExpiresIn = data.refresh_token_expires_in == null ? null : Number(data.refresh_token_expires_in);
      if (!Number.isSafeInteger(expiresIn) || expiresIn < 60 || expiresIn > 31536000 ||
          (refreshExpiresIn !== null && (!Number.isSafeInteger(refreshExpiresIn) || refreshExpiresIn < 60 || refreshExpiresIn > 31536000)) ||
          (data.refresh_token !== undefined && (typeof data.refresh_token !== 'string' || data.refresh_token.length < 8 || data.refresh_token.length > 4096))) throw refused('r19');
      const rows = [];
      for (const login of made.logins) {
        const account = await db.getAccount(login);
        if (!account || account.installation_status !== 'active') throw refused('r20');
        if (!await storePilotUserGrant({ directory: made.dir, tenantId: made.tenantId, identityId: made.identityId,
          account: login, userLogin: principal.login, accessToken: data.access_token, expiresIn,
          verifiedContext: { subject: principal.subject, tenant: latest, account },
          refreshToken: data.refresh_token ?? null, refreshExpiresIn, env })) throw refused('r21');
        rows.push(account);
      }
      await db.mirrorOAuthClient({ clientId: client.clientId, secretHash: client.secretHash, redirectUris: client.redirectUris,
        clientName: client.clientName, authorizedAccount: null });
      // Changes only when asked for AND every connected account really has them on; otherwise safe preview.
      const mode = flow.allowChanges && env.VERCEL_ENV === 'production' && rows.every((r) => r.production_enabled === true) ? 'production' : 'preview';
      outcome = 'ok';
      const after = { clientId: flow.clientId, redirectUri: flow.redirectUri, clientState: flow.clientState, codeChallenge: flow.codeChallenge,
        tier: flow.tier, accountLogin: made.logins.join(','), allowChanges: mode === 'production', tenantId: made.tenantId,
        identityId: made.identityId, maxOpen: limits.maxOpenFlows };
      if (offers.length > 0) {
        const handle = 'pc.' + random(32);
        if (!await made.dir.createPublicFlow({ ...after, stateHash: sha(handle), stage: 'god', offers })) throw new PublicConnectError('capacity',
          'Too many people are connecting right now. Please try again in a few minutes.');
        return { accounts: { handle, connected: rows.map((r) => r.login), offers } };
      }
      if (flow.tier === 'god') {
        const handle = 'pc.' + random(32);
        if (!await made.dir.createPublicFlow({ stateHash: sha(handle), stage: 'god', clientId: flow.clientId,
          redirectUri: flow.redirectUri, clientState: flow.clientState, codeChallenge: flow.codeChallenge, tier: 'god',
          accountLogin: made.logins.join(','), allowChanges: mode === 'production', tenantId: made.tenantId, identityId: made.identityId,
          maxOpen: limits.maxOpenFlows })) throw new PublicConnectError('capacity', 'Too many people are connecting right now. Please try again in a few minutes.');
        return { god: { handle, accounts: rows.map((r) => ({ login: r.login, organization: r.account_type === 'Organization' })) } };
      }
      return { redirect: await mintCode({ db, tenantId: made.tenantId, identityId: made.identityId, logins: made.logins,
        flow: { clientId: flow.clientId, redirectUri: flow.redirectUri, codeChallenge: flow.codeChallenge, clientState: flow.clientState }, mode }) };
    } finally {
      if (metricSql) await recordTenantMetric(metricSql, { event: 'provider', outcome, durationMs: Math.max(0, Date.now() - started) }).catch(() => {});
    }
  }

  // ---- "Delete my data" by the person themselves: sign in with GitHub, confirm, and their whole stored footprint goes.
  /** Start: sign in with GitHub (no accounts are listed, no identity is created). Returns the GitHub URL and the cookie value. */
  async function startForget() {
    active(); await ensureSchema();
    const dir = directory(), redirectUri = active() + '/api/oauth/authorize';
    await dir.ensureForgetClient(FORGET_CLIENT, redirectUri, hashToken(randomToken(32)));
    const client = await loadClient(FORGET_CLIENT, redirectUri);
    return await openSignIn({ client, flow: { redirectUri, clientState: null, codeChallenge: random(32), tier: 'standard', purpose: 'forget' } });
  }

  /** The person came back from GitHub. Only a person already stored can be found; nobody is enrolled by asking to leave. */
  async function forgetLookup(principal) {
    const tenantId = await directory().findPublicTenantBySubject(principal.subject);
    if (!tenantId) return { forget: { none: true } };
    const handle = 'pc.' + random(32);
    if (!await directory().createPublicFlow({ stateHash: sha(handle), stage: 'god', clientId: FORGET_CLIENT, redirectUri: active() + '/api/oauth/authorize',
      codeChallenge: random(32), tier: 'standard', purpose: 'forget', tenantId, maxOpen: limits.maxOpenFlows }))
      throw new PublicConnectError('capacity', 'Too many people are using this right now. Please try again in a few minutes.');
    return { forget: { handle } };
  }

  /** Confirm: one use per handle, and only the browser that just signed in can use it. Returns true when data was deleted. */
  async function forgetConfirm({ handle, browserCsrf }) {
    active();
    if (!STATE.test(String(handle ?? '')) || !sameState(handle, browserCsrf)) throw refused('r22');
    const flow = await directory().consumePublicFlow(sha(handle), 'god');
    if (!flow || flow.purpose !== 'forget' || !flow.tenantId) throw refused('r23');
    return await directory().forgetPublicTenant(flow.tenantId);
  }

  async function godScope(flow) {
    const dir = directory();
    const { db, sql, tenant } = await openAuthorizedTenantDb({ directory: dir, tenantId: flow.tenantId, verifiedIdentityId: flow.identityId,
      connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory });
    const live = await dir.authorizedPilotIdentity(flow.tenantId, flow.identityId);
    if (!live || live.membershipRevision !== tenant.membershipRevision) throw refused('r24');
    return { dir, db, sql };
  }

  /** The "God mode" page: choose what to add. One use per handle. `choice` is 'finish', 'notifications' or 'package';
   * `account` says which of the connected accounts a token is for. */
  async function godChoose({ handle, browserCsrf, choice, account, offerIndex }) {
    active();
    if (!STATE.test(String(handle ?? '')) || !sameState(handle, browserCsrf) || !['finish', 'notifications', 'package', 'continue', 'add'].includes(choice)) throw refused('r25');
    const flow = await directory().consumePublicFlow(sha(handle), 'god');
    if (!flow || flow.purpose || !flow.tenantId || !flow.identityId || !flow.accountLogin) throw refused('r26');
    const logins = flow.accountLogin.split(',');
    const { db } = await godScope(flow);
    const mode = flow.allowChanges ? 'production' : 'preview';
    for (const login of logins) {
      const row = await db.getAccount(login);
      if (!row || (mode === 'production' && row.production_enabled !== true)) throw refused('r27');
    }
    if (flow.offers && (choice === 'continue' || choice === 'add')) {
      const rest = { clientId: flow.clientId, redirectUri: flow.redirectUri, clientState: flow.clientState, codeChallenge: flow.codeChallenge };
      if (choice === 'add') {
        const offer = flow.offers[Number(offerIndex)];
        if (!offer) throw refused('r29');
        const root = createDb(rootSql());
        const app = await root.getApp(appId);
        if (!app?.slug || !/^[a-z0-9-]{1,100}$/.test(app.slug)) throw refused('r30');
        const client = await loadClient(flow.clientId, flow.redirectUri);
        const next = await openSignIn({ client, flow: { redirectUri: flow.redirectUri, clientState: flow.clientState, codeChallenge: flow.codeChallenge,
          tier: flow.tier, accountLogin: null, allowChanges: flow.allowChanges }, stage: 'install' });
        return { install: { url: `https://github.com/apps/${app.slug}/installations/new?state=${next.state}&suggested_target_id=${offer.id}`, csrfState: next.state } };
      }
      if (flow.tier === 'god') {
        const handle = 'pc.' + random(32);
        if (!await directory().createPublicFlow({ ...rest, stateHash: sha(handle), stage: 'god', tier: 'god', accountLogin: flow.accountLogin,
          allowChanges: flow.allowChanges, tenantId: flow.tenantId, identityId: flow.identityId, maxOpen: limits.maxOpenFlows }))
          throw new PublicConnectError('capacity', 'Too many people are connecting right now. Please try again in a few minutes.');
        const rowsNow = [];
        for (const login of logins) rowsNow.push(await db.getAccount(login));
        return { god: { handle, accounts: rowsNow.map((r) => ({ login: r.login, organization: r.account_type === 'Organization' })) } };
      }
      return { redirect: await mintCode({ db, tenantId: flow.tenantId, identityId: flow.identityId, logins, flow: rest, mode }) };
    }
    if (choice === 'continue' || choice === 'add') throw refused('r31');
    if (choice === 'finish') {
      return { redirect: await mintCode({ db, tenantId: flow.tenantId, identityId: flow.identityId, logins,
        flow: { clientId: flow.clientId, redirectUri: flow.redirectUri, codeChallenge: flow.codeChallenge, clientState: flow.clientState }, mode }) };
    }
    const target = typeof account === 'string' && logins.includes(account.toLowerCase()) ? account.toLowerCase() : logins[0];
    const row = await db.getAccount(target);
    if (choice === 'package' && row.account_type !== 'Organization') throw refused('r28');
    const enrollment = createPrivateOptionalEnrollment({ env, fetchImpl, directoryFactory: directory,
      tenantAccess: (dir, claim) => openAuthorizedTenantDb({ directory: dir, tenantId: claim.tenantId, verifiedIdentityId: claim.identityId,
        connectionString: env.DATABASE_URL, sqlFactory: tenantSqlFactory }) });
    const details = await enrollment.start({ client_id: flow.clientId, account: target,
      kind: choice === 'package' ? 'P' : 'K', redirect_uri: flow.redirectUri },
    { clientState: flow.clientState, codeChallenge: flow.codeChallenge, mode, profile: 'full', listing: 'compact', accounts: logins },
    { tenantId: flow.tenantId, identityId: flow.identityId });
    return { optional: { ...details, oauth: true } };
  }

  return Object.freeze({ registerClient, inspect, start, resumeInstall, finish, godChoose, startForget, forgetConfirm, limits });
}
