// Copied from Robinson-AI-Systems/stripe-mcp src/core/http.js @ 90a49c0 (contract-generic; the hub's robinson-mcp-core will replace this copy).
// Service-independent HTTP helpers. Never derive OAuth issuer from an untrusted Host header.
export function publicOrigin(env = process.env) {
  const value = String(env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  let url;
  try { url = new URL(value); } catch { throw new Error('PUBLIC_BASE_URL must be configured as an HTTPS origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || url.pathname !== '/') {
    throw new Error('PUBLIC_BASE_URL must be configured as an HTTPS origin');
  }
  return url.origin;
}

export function send(res, status, value, contentType = 'application/json; charset=utf-8') {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', contentType);
  return res.status(status).send(contentType.startsWith('application/json') ? JSON.stringify(value) : value);
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
export const MAX_REQUEST_BODY_BYTES = 16384;

export function paramsOf(req) {
  if (req.method === 'GET') return req.query || {};
  const contentType = String(req.headers?.['content-type'] || '').split(';')[0].toLowerCase();
  const body = req.body;
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    // Vercel can parse JSON before our handler. Its Content-Length header is not
    // an enforceable size check; measure the actual object representation instead.
    let serialized;
    try { serialized = JSON.stringify(body); }
    catch { throw new Error('Invalid request body'); }
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_REQUEST_BODY_BYTES)
      throw new Error('Invalid request body');
    return body;
  }
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BODY_BYTES)
    throw new Error('Invalid request body');
  if (contentType === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(body));
  if (contentType === 'application/json') {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  }
  throw new Error('Unsupported request body');
}
export const only = (res, req, methods) => {
  if (methods.includes(req.method)) return true;
  res.setHeader('Allow', methods.join(', '));
  send(res, 405, { error: 'method_not_allowed' });
  return false;
};
