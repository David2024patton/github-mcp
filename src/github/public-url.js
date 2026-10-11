// Shared G-5 URL boundary for fetching release assets. No URL is fetched by a tool directly.
// Resolve once, reject all unsafe DNS answers, and pin the selected IP for the TLS connection.
import { lookup as dnsLookup } from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';

export const MAX_ASSET_BYTES = 100 * 1024 * 1024;
const MAX_URL_LENGTH = 2048;
const MAX_DOWNLOAD_MS = 20_000;
const blockedSuffix = /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/i;

export function publicIpv4(address) {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  // IANA private, loopback, CGNAT, link-local, benchmarking, documentation,
  // protocol-assignment, multicast and reserved ranges must never be reachable.
  if (a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)) return false;
  return true;
}

export function publicHttpsUrl(input) {
  if (typeof input !== 'string' || input.length > MAX_URL_LENGTH) throw new TypeError('Asset source URL is too long or invalid.');
  let url;
  try { url = new URL(input); } catch { throw new TypeError('Asset source must be a valid public HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.port && url.port !== '443' ||
      url.username || url.password || url.hash || url.hostname.startsWith('[') || isIP(url.hostname) ||
      blockedSuffix.test(url.hostname)) {
    throw new TypeError('Asset source must be public HTTPS on port 443, without credentials, IP literals or fragments.');
  }
  return url;
}

export async function resolvePublicIpv4(host, resolver = dnsLookup) {
  const addresses = await resolver(host, { all: true, family: 4 });
  if (!Array.isArray(addresses) || !addresses.length ||
      addresses.some((item) => !publicIpv4(item.address))) {
    throw new TypeError('Asset source DNS is private, reserved or unavailable.');
  }
  return addresses[0].address;
}

/** Return bounded bytes only to the server-side uploader. Never put bytes in tool results. */
export async function downloadPublicAsset(input, { resolve = resolvePublicIpv4, request = https.request,
  maxBytes = MAX_ASSET_BYTES, timeoutMs = MAX_DOWNLOAD_MS } = {}) {
  const url = publicHttpsUrl(input);
  const address = await resolve(url.hostname);
  if (!publicIpv4(address)) throw new TypeError('Asset source address is not public.');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_ASSET_BYTES) {
    throw new TypeError('Invalid asset byte limit.');
  }
  const lookup = (_host, options, callback) => {
    if (options?.all) callback(null, [{ address, family: 4 }]);
    else callback(null, address, 4);
  };
  return new Promise((resolveDownload, reject) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const req = request(url, {
      method: 'GET', family: 4, autoSelectFamily: false, lookup, signal,
      headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity' }
    }, (response) => {
      (async () => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) throw new TypeError('Asset source redirects are refused.');
        if (status !== 200) throw new TypeError(`Asset source returned HTTP ${status}.`);
        const announced = Number(response.headers['content-length']);
        if (response.headers['content-length'] !== undefined &&
            (!Number.isSafeInteger(announced) || announced < 0 || announced > maxBytes)) {
          throw new TypeError('Asset source exceeds the size limit.');
        }
        if (response.headers['content-encoding'] &&
            response.headers['content-encoding'] !== 'identity') {
          throw new TypeError('Compressed asset responses are refused.');
        }
        const chunks = [];
        let total = 0;
        for await (const chunk of response) {
          total += chunk.length;
          if (total > maxBytes) throw new TypeError('Asset source exceeded the 100 MB streaming limit.');
          chunks.push(chunk);
        }
        return { bytes: Buffer.concat(chunks, total), size: total,
          contentType: String(response.headers['content-type'] ?? 'application/octet-stream').split(';')[0] };
      })().then(resolveDownload, (error) => { response.destroy(); reject(error); });
    });
    req.on('error', reject);
    req.end();
  });
}
