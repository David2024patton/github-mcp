import { marketplaceAccount, marketplaceResource } from '../../src/marketplace/resource.js';
import { marketplaceEnabled } from '../../src/marketplace/lifecycle.js';
import { publicOrigin } from '../../src/core/http.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  const account = marketplaceAccount(req.query?.account);
  if (!account || !marketplaceEnabled()) return res.status(404).json({error:'not_found'});
  if (req.method !== 'GET') { res.setHeader('Allow','GET'); return res.status(405).json({error:'method_not_allowed'}); }
  return res.status(200).json({resource:marketplaceResource(account), authorization_servers:[publicOrigin()],
    bearer_methods_supported:['header'],scopes_supported:['github.notifications.read']});
}
