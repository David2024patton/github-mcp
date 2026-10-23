// Contract-generic MCP bearer authentication (A-3b). Adapted from Robinson-AI-Systems/stripe-mcp src/core/mcp-auth.js @ 90a49c0.
// Never forwards the bearer to any provider. What a stored token row means for this service is decided by the injected
// `toConnection(record, env)`: it returns { connection } (a frozen object handed to tools) or { refuse: { status, body } }.
import { publicOrigin, send } from './http.js';

export async function requireMcpToken(req, res, db, env = process.env, { toConnection } = {}) {
  if (typeof toConnection !== 'function') throw new TypeError('requireMcpToken needs a toConnection function.');
  const origin = publicOrigin(env);
  const challenge = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
  const match = /^[Bb][Ee][Aa][Rr][Ee][Rr][ \t]+([A-Za-z0-9_-]{30,256})$/.exec(String(req.headers?.authorization || ''));
  if (!match) {
    res.setHeader('WWW-Authenticate', challenge);
    send(res, 401, { error: 'unauthorized', error_description: 'A valid connection is required' });
    return null;
  }
  const record = await db.getAccessToken(match[1]);
  const decision = record ? toConnection(record, env) : null;
  if (!decision) {
    res.setHeader('WWW-Authenticate', challenge + ', error="invalid_token"');
    send(res, 401, { error: 'invalid_token' });
    return null;
  }
  if (decision.refuse) {
    send(res, decision.refuse.status, decision.refuse.body);
    return null;
  }
  return decision.connection;
}
