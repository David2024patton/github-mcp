// Copied from Robinson-AI-Systems/stripe-mcp src/core/oauth.js @ 90a49c0 (contract-generic; the hub's robinson-mcp-core will replace this copy).
// One change from the source: secretsMatch() returns false for an empty or non-string `supplied` value instead of throwing
// (an empty passphrase submission crashed evaluateLogin with a TypeError). Port the fix back to the source and the hub core.
// Portable OAuth security primitives. No service-specific imports.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_WINDOW_MINUTES = 15;
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export function hashToken(value) {
  if (typeof value !== 'string' || !value) throw new TypeError('Credential must be non-empty');
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
export function secretsMatch(supplied, expected) {
  if (typeof expected !== 'string' || !expected) return false;
  if (typeof supplied !== 'string' || !supplied) return false;
  return timingSafeEqual(Buffer.from(hashToken(supplied), 'hex'), Buffer.from(hashToken(expected), 'hex'));
}
export function verifyPkce(verifier, challenge, method = 'S256') {
  if (method !== 'S256' || typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return false;
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9~._-]{43,128}$/.test(verifier)) return false;
  return secretsMatch(createHash('sha256').update(verifier).digest('base64url'), challenge);
}
export function validRedirectUri(value) {
  try {
    const u = new URL(value);
    return !u.username && !u.password && !u.hash && !!u.hostname &&
      (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)));
  } catch { return false; }
}
function expandIpv6(ip) {
  let text = ip;
  const ipv4 = text.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const [, prefix, a, b, c, d] = ipv4;
    text = `${prefix}${((+a << 8) | +b).toString(16)}:${((+c << 8) | +d).toString(16)}`;
  }
  const [head, tail] = text.includes('::') ? text.split('::') : [text, null];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill = tail === null ? [] : Array(8 - left.length - right.length).fill('0');
  return [...left, ...fill, ...right].map((value) => Number.parseInt(value, 16));
}
export function clientIp(req) {
  const h = req?.headers || {};
  const get = (v) => String(Array.isArray(v) ? v[0] : v || '').split(',')[0].trim();
  const raw = get(h['x-vercel-forwarded-for']) || get(h['x-real-ip']) || req?.socket?.remoteAddress || '';
  const bracketed = raw.match(/^\[([^\]]+)\](?::\d+)?$/);
  const ip = (bracketed ? bracketed[1] : raw).split('%')[0].toLowerCase();
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) !== 6) return 'unknown';
  const groups = expandIpv6(ip);
  if (groups.length !== 8) return 'unknown';
  if (groups.slice(0, 5).every((part) => part === 0) && groups[5] === 0xffff) {
    return `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  }
  return `${groups.slice(0, 4).map((part) => part.toString(16)).join(':')}::/64`;
}
export async function evaluateLogin({ ip, supplied, expected, store }) {
  if (!expected) throw new Error('Login passphrase is not configured');
  const attempt = await store.recordLoginAttempt(ip);
  const count = await store.countRecentFailedLogins(ip, LOCKOUT_WINDOW_MINUTES);
  if (count > MAX_FAILED_LOGINS) return { status: 'locked' };
  if (!secretsMatch(supplied, expected)) return { status: 'wrong', attemptsLeft: MAX_FAILED_LOGINS - count };
  await store.markLoginAttemptSucceeded(attempt);
  return { status: 'ok' };
}
