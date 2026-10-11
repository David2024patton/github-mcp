// GitHub App webhook receiver (A12). Narrow on purpose: it verifies the signature with the App's own webhook secret, then
// learns only about installations and about the owner revoking the App's user authorization. Everything else is acknowledged
// and ignored. Nothing here ever returns or logs a secret, a signature or a payload.
import crypto from 'node:crypto';

export const MAX_BODY_BYTES = 1024 * 1024;
const DELIVERY = /^[0-9a-fA-F-]{8,64}$/;
const SIGNATURE = /^sha256=[0-9a-f]{64}$/;

/** True when `signature` is the HMAC-SHA256 of the raw `body` under `secret`. Constant-time; any malformed input is false. */
export function verifySignature(secret, body, signature) {
  if (typeof secret !== 'string' || !secret || typeof signature !== 'string' || !SIGNATURE.test(signature)) return false;
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature.slice('sha256='.length), 'hex'));
}

/** The raw bytes of a request, from `req.rawBody` (tests) or the stream. Returns null when over the size limit. */
export async function readRawBody(req, limit = MAX_BODY_BYTES) {
  if (req.rawBody != null) {
    const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(String(req.rawBody));
    return raw.length > limit ? null : raw;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

const header = (req, name) => {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
};

/** Applies one verified event to the stored accounts. Returns a short word for the answer ("updated", "ignored"). */
async function applyEvent({ db }, appId, event, payload) {
  const accounts = await db.listAccounts();
  const byInstallation = (id) => accounts.find((a) => a.app_id === appId && a.installation_id != null && Number(a.installation_id) === Number(id));
  const installation = payload?.installation;

  if (event === 'installation' && installation?.id != null) {
    const action = payload.action;
    if (action === 'created') {
      const login = installation.account?.login;
      const row = typeof login === 'string' ? accounts.find((a) => a.login.toLowerCase() === login.toLowerCase()) : null;
      // Only an account this server already knows, created for this very App, can be linked. Anything else is left alone.
      if (!row || row.app_id !== appId) return 'ignored';
      await db.setInstallation(row.login, {
        installationId: installation.id, repositorySelection: installation.repository_selection ?? 'selected',
        permissions: installation.permissions ?? {}, status: 'active'
      });
      return 'updated';
    }
    const row = byInstallation(installation.id);
    if (!row) return 'ignored';
    if (action === 'deleted') {
      await db.setInstallationStatus(row.login, 'none');
      await db.deleteInstallationTokens(row.installation_id);
      return 'updated';
    }
    if (action === 'suspend') {
      await db.setInstallationStatus(row.login, 'suspended');
      await db.deleteInstallationTokens(row.installation_id);
      return 'updated';
    }
    if (action === 'unsuspend') {
      await db.setInstallationStatus(row.login, 'active');
      return 'updated';
    }
    if (action === 'new_permissions_accepted') {
      await db.setInstallation(row.login, {
        installationId: row.installation_id, repositorySelection: installation.repository_selection ?? row.repository_selection,
        permissions: installation.permissions ?? row.installation_permissions ?? {}, status: row.installation_status === 'suspended' ? 'suspended' : 'active'
      });
      await db.deleteInstallationTokens(row.installation_id);
      return 'updated';
    }
    return 'ignored';
  }

  if (event === 'installation_repositories' && installation?.id != null) {
    const row = byInstallation(installation.id);
    const selection = payload.repository_selection ?? installation.repository_selection;
    if (!row || (selection !== 'all' && selection !== 'selected')) return 'ignored';
    await db.setInstallation(row.login, {
      installationId: row.installation_id, repositorySelection: selection,
      permissions: row.installation_permissions ?? {}, status: row.installation_status
    });
    return 'updated';
  }

  if (event === 'github_app_authorization' && payload?.action === 'revoked') {
    const user = payload.sender?.login;
    if (typeof user !== 'string') return 'ignored';
    const matches = accounts.filter((a) => a.app_id === appId && a.user_login && a.user_login.toLowerCase() === user.toLowerCase());
    for (const row of matches) await db.clearUserAuthorization(row.login);
    return matches.length ? 'updated' : 'ignored';
  }
  return 'ignored';
}

/**
 * @returns a Vercel-style handler. Answers: 405 for anything but POST, 413 for a body over 1 MB, 401 for a missing, malformed
 *   or wrong signature and for an App this server does not hold (the same answer, so nobody can probe which Apps exist),
 *   400 for a verified body that is not JSON, 200 `{ ok: true, result }` otherwise. Failures inside answer 503 with no detail.
 */
export function createWebhookHandler({ db, credentials }) {
  return async function webhook(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    try {
      const raw = await readRawBody(req);
      if (raw === null) return res.status(413).json({ error: 'payload_too_large' });
      const appId = Number(header(req, 'x-github-hook-installation-target-id'));
      const unauthorized = () => res.status(401).json({ error: 'invalid_signature' });
      if (!Number.isSafeInteger(appId) || appId <= 0) return unauthorized();
      const secret = await credentials.webhookSecret(appId).catch(() => null);
      if (!secret || !verifySignature(secret, raw, header(req, 'x-hub-signature-256'))) return unauthorized();
      let payload;
      try { payload = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'invalid_json' }); }
      const event = String(header(req, 'x-github-event') ?? '');
      const delivery = String(header(req, 'x-github-delivery') ?? '');
      const result = await applyEvent({ db }, appId, event, payload);
      return res.status(200).json({ ok: true, result, delivery: DELIVERY.test(delivery) ? delivery : undefined });
    } catch {
      return res.status(503).json({ error: 'temporarily_unavailable' });
    }
  };
}
