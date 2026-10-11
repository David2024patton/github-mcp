// GitHub MCP composition boundary for the setup page and the GitHub redirects (A-5b). One serverless function serves all of
// them (Vercel's Hobby plan caps the number of functions), selected by the first path segment.
import { createSetupHandlers } from './setup-page.js';
import { createWebhookHandler } from './webhook.js';
import { getSecretsRuntime } from '../runtime.js';

const ROUTES = { 'setup': 'setup', 'manifest-callback': 'manifestCallback', 'user-callback': 'userCallback' };

/** Runs one setup handler. Any failure answers 503 with no detail (never SQL, tokens, passphrases or stack text). */
export async function handleGithub(action, req, res, { runtime, env = process.env, fetch = globalThis.fetch } = {}) {
  const name = Object.hasOwn(ROUTES, String(action)) ? ROUTES[action] : null;
  if (!name) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ error: 'not_found' });
  }
  try {
    const { db, credentials, oneTimeStore } = runtime ?? await getSecretsRuntime({ env, fetch });
    const handlers = createSetupHandlers({ db, credentials, oneTimeStore, env, fetch });
    res.setHeader('Cache-Control', 'no-store');
    return await handlers[name](req, res);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'temporarily_unavailable', description: 'GitHub MCP is not configured or its database is unavailable' });
  }
}

/** The App webhook. Same rule: any failure before the signature is checked answers 503 with no detail. */
export async function handleWebhook(req, res, { runtime, env = process.env, fetch = globalThis.fetch } = {}) {
  try {
    const { db, credentials } = runtime ?? await getSecretsRuntime({ env, fetch });
    return await createWebhookHandler({ db, credentials })(req, res);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'temporarily_unavailable' });
  }
}
