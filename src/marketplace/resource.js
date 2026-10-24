import { publicOrigin } from '../core/http.js';

export function marketplaceAccount(value) {
  const text = String(value ?? '');
  if (!/^[1-9][0-9]{0,15}$/.test(text) || !Number.isSafeInteger(Number(text))) return null;
  return Number(text);
}
export function marketplaceResource(accountId, env = process.env) {
  const account = marketplaceAccount(accountId);
  if (!account) throw new TypeError('A Marketplace account is required.');
  return publicOrigin(env) + '/api/marketplace/mcp?account=' + account;
}
export function accountFromResource(resource, env = process.env) {
  if (typeof resource !== 'string') return null;
  try {
    const url = new URL(resource);
    const id = marketplaceAccount(url.searchParams.get('account'));
    return id && resource === marketplaceResource(id, env) ? id : null;
  } catch { return null; }
}
