// RFC 9116 security.txt. vercel.json rewrites /.well-known/security.txt here so the file lives
// with the rest of the API. Expires is computed per response: a static date would eventually go
// stale and scanners would discard the file, and one year out is the conservative ceiling that
// keeps the published contact trustworthy without redeploys.
import { only, send } from '../src/core/http.js';

const ORIGIN = 'https://github.robinsonaisystems.com';
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function securityTxt(now = Date.now()) {
  return [
    'Contact: mailto:hello@robinsonaisystems.com',
    `Expires: ${new Date(now + YEAR_MS).toISOString()}`,
    `Canonical: ${ORIGIN}/.well-known/security.txt`,
    `Policy: ${ORIGIN}/security`,
    'Preferred-Languages: en',
    ''
  ].join('\n');
}

export default function handler(req, res) {
  if (!only(res, req, ['GET'])) return;
  return send(res, 200, securityTxt(), 'text/plain; charset=utf-8');
}
