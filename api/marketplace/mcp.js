import { handleMcp } from '../mcp.js';
import { marketplaceAccount } from '../../src/marketplace/resource.js';
import { marketplaceEnabled } from '../../src/marketplace/lifecycle.js';
import { publicOrigin } from '../../src/core/http.js';

export default async function handler(req, res) {
  const account = marketplaceAccount(req.query?.account);
  res.setHeader('Cache-Control','no-store');
  if (!account || !marketplaceEnabled()) return res.status(404).json({error:'not_found'});
  if (!/^Bearer\s+tac_/i.test(req.headers?.authorization ?? '')) {
    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${publicOrigin()}/api/marketplace/resource?account=${account}"`);
    return res.status(401).json({error:'unauthorized'});
  }
  return handleMcp(req, res, {marketplaceAccountId:account});
}
