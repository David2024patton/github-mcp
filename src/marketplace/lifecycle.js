import { createHmac, timingSafeEqual } from 'node:crypto';
import { bareOctokit } from '../github/client.js';
import { decryptSecret, readEncryptionKey } from '../core/crypto.js';
import { readRawBody, signatureMatches } from '../github/webhook.js';
import { pilotAppClient } from '../tenancy/pilot-app-client.js';
import { createMarketplaceStore } from './store.js';
import { marketplaceAccount } from './resource.js';

export function marketplaceEnabled(env = process.env) {
  return env.GITHUB_MARKETPLACE_CONNECT === 'enabled' && env.VERCEL_ENV === 'production';
}
export function freePlanId(env) {
  const id = marketplaceAccount(env.GITHUB_MARKETPLACE_PLAN_ID);
  if (!id) throw new Error('Marketplace plan is not configured.');
  return id;
}
const free = p => p && p.monthly_price_in_cents === 0 && p.yearly_price_in_cents === 0;

/** The provider bearer is never returned. Check the current subscription AND local signed cancellation state. */
export async function verifyMarketplacePurchase({ token, accountId, store, env, fetchImpl = fetch }) {
  if (!marketplaceEnabled(env) || !marketplaceAccount(accountId)) throw new Error('Marketplace unavailable.');
  const planId = freePlanId(env);
  const local = await store.subscription(accountId);
  if (local?.status !== 'active' || Number(local.plan_id) !== planId) throw new Error('Marketplace subscription unavailable.');
  const api = bareOctokit({ token, fetch: fetchImpl });
  for (let page = 1; page <= 10; page++) {
    const result = await api.request('GET /user/marketplace_purchases', { per_page: 100, page, request:{timeout:10000} });
    if (!Array.isArray(result.data)) throw new Error('Marketplace verification unavailable.');
    const match = result.data.find(p => p.account?.id === accountId && p.plan?.id === planId && free(p.plan));
    if (match) return local;
    if (result.data.length < 100) break;
  }
  throw new Error('Marketplace subscription unavailable.');
}

/** Only a customer's own OAuth token is revoked. Never call the global /grant endpoint or uninstall the App. */
export async function cleanMarketplaceCustomer({ row, store, rootDb, env, fetchImpl = fetch }) {
  const app = await pilotAppClient({ env, db: rootDb });
  const api = bareOctokit({ fetch: fetchImpl });
  for (const grant of await store.grants(row.tenant_id)) {
    const token = decryptSecret(grant.access_enc, { key: readEncryptionKey(env),
      aad: `github-mcp/private-tenant/${grant.tenant_id}/identity/${grant.identity_id}/account/${grant.account_login}/access` });
    try {
      await api.request('DELETE /applications/{client_id}/token', { client_id: app.clientId, access_token: token,
        request:{timeout:10000},
        headers: { authorization: 'Basic ' + Buffer.from(app.clientId + ':' + app.clientSecret).toString('base64') } });
    } catch (error) {
      if (error?.status !== 404) throw new Error('Marketplace token revocation pending.');
    }
    await store.revoked(grant);
  }
  if (!await store.purge(row.tenant_id)) throw new Error('Marketplace deletion pending.');
}
export async function sweepMarketplace({ sql, rootDb, env, fetchImpl = fetch, limit = 2 }) {
  const store = createMarketplaceStore(sql);
  let removed = 0, failed = 0;
  for (const row of await store.pending(limit)) {
    try { await cleanMarketplaceCustomer({ row, store, rootDb, env, fetchImpl }); removed++; }
    catch { failed++; }
  }
  return { removed, failed };
}

/** Dedicated signed Marketplace door. Provider bodies and signing secrets never enter logs or responses. */
export function createMarketplaceWebhook({ sql, rootDb, env = process.env, fetchImpl = fetch }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({ error:'method_not_allowed' }); }
    try {
      const secret = env.GITHUB_MARKETPLACE_WEBHOOK_SECRET;
      if (typeof secret !== 'string' || secret.length < 32) return res.status(503).json({ error:'not_configured' });
      const raw = await readRawBody(req, 256 * 1024);
      if (raw.length > 256 * 1024) return res.status(413).json({ error:'too_large' });
      if (!signatureMatches(secret, raw, req.headers?.['x-hub-signature-256']))
        return res.status(401).json({ error:'unauthorized' });
      const event = req.headers?.['x-github-event'];
      if (event === 'ping') return res.status(200).json({ ok:true });
      if (event !== 'marketplace_purchase') return res.status(202).json({ ok:true, ignored:true });
      let body;
      try { body = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error:'invalid_request' }); }
      if (!['purchased','cancelled'].includes(body?.action)) return res.status(202).json({ ok:true, ignored:true });
      const purchase = body.marketplace_purchase, at = new Date(body.effective_date);
      if (!marketplaceAccount(purchase?.account?.id) || purchase?.plan?.id !== freePlanId(env) || !free(purchase.plan) ||
          !Number.isFinite(at.getTime()) || at.getTime() > Date.now() + 300000)
        return res.status(422).json({ error:'unsupported_purchase' });
      const store = createMarketplaceStore(sql);
      await store.event({ accountId:purchase.account.id, planId:purchase.plan.id,
        accountHash:createHmac('sha256',readEncryptionKey(env)).update('marketplace-account/' + purchase.account.id).digest('hex'),
        status:body.action === 'purchased' ? 'active' : 'cancelled', effectiveAt:at.toISOString(),
        deliveryId:req.headers?.['x-github-delivery'], raw });
      if (body.action === 'cancelled') {
        const result = await sweepMarketplace({ sql, rootDb, env, fetchImpl });
        if (result.failed) return res.status(503).json({ error:'cleanup_pending' });
      }
      return res.status(200).json({ ok:true });
    } catch (error) { return res.status(error?.status === 413 ? 413 : 503).json({ error:error?.status === 413 ? 'too_large' : 'temporarily_unavailable' }); }
  };
}

/** Constant-time cron secret comparison without exposing either value. */
export function cronAuthorized(authorization, env) {
  if (typeof env.CRON_SECRET !== 'string' || env.CRON_SECRET.length < 32 || typeof authorization !== 'string') return false;
  const expected = createHmac('sha256', env.CRON_SECRET).update('Bearer ' + env.CRON_SECRET).digest();
  return timingSafeEqual(createHmac('sha256', env.CRON_SECRET).update(authorization).digest(), expected);
}
