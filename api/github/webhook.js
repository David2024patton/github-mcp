import { createWebhookHandler } from '../../src/github/webhook.js';
import { getSecretsRuntime } from '../../src/runtime.js';

// The signature is over the exact bytes GitHub sent, so the body must not be parsed before it is checked.
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  try {
    const { db, credentials } = await getSecretsRuntime();
    return await createWebhookHandler({ db, credentials })(req, res);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ error: 'temporarily_unavailable' });
  }
}
