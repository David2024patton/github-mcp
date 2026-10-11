// GitHub MCP composition boundary: the reusable core handlers are dependency-injected with this server's policy.
import { createOAuthHandlers } from '../core/oauth-handlers.js';
import { createGithubPolicy } from './policy.js';
import { getDb } from '../runtime.js';

/** Runs one OAuth handler. Any failure answers 503 with no detail (never SQL, tokens, passphrases or stack text). */
export async function handleOAuth(which, req, res, { db, env = process.env } = {}) {
  try {
    const handlers = createOAuthHandlers({ db: db ?? await getDb(), env, policy: createGithubPolicy({ env }) });
    return await handlers[which](req, res);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'temporarily_unavailable', error_description: 'GitHub MCP is not configured or its database is unavailable' });
  }
}
