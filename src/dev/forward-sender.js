// V-4: the only place a developer-registered target URL is contacted. A forwarder target is untrusted network
// input, so every send re-applies the same boundary as release assets (public HTTPS on 443, no credentials or IP
// literals, every DNS answer public, the chosen address pinned for the TLS connection, redirects refused) and
// never retries: a timeout or lost connection is reported as unconfirmed, because the target may have received it.
import https from 'node:https';
import { createHmac, randomUUID } from 'node:crypto';
import { publicHttpsUrl, resolvePublicIpv4 } from '../github/public-url.js';

export const FORWARD_TIMEOUT_MS = 10_000;
export const MAX_FORWARD_BYTES = 1024 * 1024;
const MAX_DRAIN_BYTES = 64 * 1024;

/** A registered or webhook target: public HTTPS only. The message never repeats the URL (it may hold a token). */
export function forwarderUrl(input) {
  try { return publicHttpsUrl(input); } catch {
    throw new TypeError('A forwarder target must be a public HTTPS address on port 443 — no credentials, IP numbers, fragments or private/internal host names.');
  }
}
/** The header GitHub sends: HMAC-SHA256 over the exact bytes of the body. */
export const signBody = (secret, body) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

/**
 * Send one signed delivery. Resolves to `{ outcome, status? }` and never throws for a network problem.
 * outcome: delivered (2xx) | rejected_by_target (other status) | redirect_refused | blocked (address not public) |
 * timeout_unconfirmed | error_unconfirmed.
 */
export async function sendSigned({ url: input, event, body, secret, resolve = resolvePublicIpv4, request = https.request, timeoutMs = FORWARD_TIMEOUT_MS, deliveryId = randomUUID() }) {
  const url = forwarderUrl(input);
  const payload = Buffer.from(body, 'utf8');
  if (payload.length > MAX_FORWARD_BYTES) return { outcome: 'blocked', reason: 'The payload is larger than 1 MB.' };
  let address;
  try { address = await resolve(url.hostname); } catch { return { outcome: 'blocked', reason: 'The target resolves to a private, reserved or unknown address.' }; }
  const lookup = (_host, options, callback) => {
    if (options?.all) callback(null, [{ address, family: 4 }]); else callback(null, address, 4);
  };
  return await new Promise((done) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; done(value); } };
    const signal = AbortSignal.timeout(timeoutMs);
    let req;
    try {
      req = request(url, {
        method: 'POST', family: 4, autoSelectFamily: false, lookup, signal,
        headers: {
          'Content-Type': 'application/json', 'Content-Length': payload.length,
          'User-Agent': 'GitHub-Hookshot/robinson-dev-forwarder', 'Accept-Encoding': 'identity',
          'X-GitHub-Event': event, 'X-GitHub-Delivery': deliveryId, 'X-Hub-Signature-256': signBody(secret, payload)
        }
      }, (response) => {
        const status = response.statusCode ?? 0;
        let seen = 0;
        response.on?.('data', (chunk) => { seen += chunk.length; if (seen > MAX_DRAIN_BYTES) response.destroy?.(); });
        response.on?.('error', () => {});
        response.resume?.();
        if (status >= 300 && status < 400) return finish({ outcome: 'redirect_refused', status });
        finish({ outcome: status >= 200 && status < 300 ? 'delivered' : 'rejected_by_target', status });
      });
    } catch { return finish({ outcome: 'error_unconfirmed' }); }
    req.on('error', (error) => finish({ outcome: error?.name === 'AbortError' || error?.code === 'ABORT_ERR' ? 'timeout_unconfirmed' : 'error_unconfirmed' }));
    req.end(payload);
  });
}
