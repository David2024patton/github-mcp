import { neon } from '@neondatabase/serverless';
import { getSecretsRuntime } from '../../src/runtime.js';
import { createMarketplaceWebhook } from '../../src/marketplace/lifecycle.js';

export const config = {api:{bodyParser:false}};
export default async function handler(req, res) {
  try {
    const {db} = await getSecretsRuntime();
    return await createMarketplaceWebhook({sql:neon(process.env.DATABASE_URL),rootDb:db})(req,res);
  } catch { return res.status(503).json({error:'temporarily_unavailable'}); }
}
