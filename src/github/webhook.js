// The GitHub App webhook (A12): verified, narrow, and only used to learn what happened to an installation or a sign-in.
// It never reads repository events and never writes to GitHub. A delivery is believed only if its signature matches the
// webhook secret stored for the App named in the delivery; everything else is refused before anything is stored.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_WEBHOOK_BYTES = 5 * 1024 * 1024;
const HANDLED = new Set(['ping', 'installation', 'installation_repositories', 'github_app_authorization']);

/** Constant-time check of GitHub's `sha256=<hex>` signature over the exact raw bytes. */
export function signatureMatches(secret, rawBody, header) {
  if (typeof secret !== 'string' || !secret || typeof header !== 'string' || !/^sha256=[0-9a-f]{64}$/.test(header)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(header.slice(7), 'hex'));
}

/** Reads the body exactly as sent (a parsed-and-reserialized body would not match the signature). */
export async function readRawBody(req, limit = MAX_WEBHOOK_BYTES) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

const header = (req, name) => {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
};

/** @param {{ db: object, credentials: object }} deps */
export function createWebhookHandler({ db, credentials }) {
  const reply = (res, status, body) => res.status(status).json(body);

  return async function webhook(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(res, 405, { error: 'method_not_allowed' }); }
    let raw;
    try { raw = await readRawBody(req); } catch (error) { return reply(res, error?.status === 413 ? 413 : 400, { error: 'invalid_request' }); }

    // Which App is this for? Only a number that matches a stored App can have a secret; any other delivery is simply unauthorized.
    const target = String(header(req, 'x-github-hook-installation-target-id') || '');
    const appId = /^\d{1,15}$/.test(target) ? Number(target) : null;
    const secret = appId != null ? await credentials.webhookSecret(appId).catch(() => null) : null;
    if (!secret || !signatureMatches(secret, raw, header(req, 'x-hub-signature-256'))) return reply(res, 401, { error: 'unauthorized' });

    const event = String(header(req, 'x-github-event') || '');
    if (!HANDLED.has(event)) return reply(res, 202, { ok: true, ignored: true });
    let payload;
    try { payload = JSON.parse(raw.toString('utf8')); } catch { return reply(res, 400, { error: 'invalid_request' }); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return reply(res, 400, { error: 'invalid_request' });

    try {
      if (event === 'ping') return reply(res, 200, { ok: true });
      const accounts = (await db.listAccounts()).filter((a) => a.app_id === appId);
      if (event === 'github_app_authorization') {
        if (payload.action === 'revoked') for (const a of accounts) await credentials.forgetUserAuthorization(a.login);
        return reply(res, 200, { ok: true });
      }
      // installation / installation_repositories: believed only for the account that owns this App.
      const installation = payload.installation;
      const login = String(installation?.account?.login || '').toLowerCase();
      const owner = accounts.find((a) => a.login.toLowerCase() === login);
      if (!owner || !Number.isSafeInteger(installation?.id)) return reply(res, 200, { ok: true, ignored: true });
      const action = String(payload.action || '');
      if (event === 'installation' && action === 'deleted') {
        if (owner.installation_id === installation.id || owner.installation_id == null) await db.setInstallationStatus(owner.login, 'none');
        await db.deleteInstallationTokens(installation.id);
        return reply(res, 200, { ok: true });
      }
      const known = event === 'installation'
        ? ['created', 'suspend', 'unsuspend', 'new_permissions_accepted'].includes(action)
        : ['added', 'removed'].includes(action);
      if (!known) return reply(res, 200, { ok: true, ignored: true });
      const status = event === 'installation' && action === 'suspend' ? 'suspended'
        : event === 'installation' && action === 'unsuspend' ? 'active'
          : installation.suspended_at ? 'suspended' : 'active';
      await db.setInstallation(owner.login, {
        installationId: installation.id,
        repositorySelection: installation.repository_selection ?? owner.repository_selection ?? null,
        permissions: installation.permissions ?? owner.installation_permissions ?? {},
        status
      });
      // Anything cached for the old installation state (permissions, repositories, suspension) is dropped.
      await db.deleteInstallationTokens(installation.id);
      return reply(res, 200, { ok: true });
    } catch {
      return reply(res, 503, { error: 'temporarily_unavailable' });
    }
  };
}
