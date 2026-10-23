// PUB-6: the routing marker on a public-connect authorization code, `pc.<tenant>.<identity>.<random>`. It only selects which
// tenant database to look in; the tenant's own single-use code row, client secret hash, PKCE and live membership decide.
import { randomBytes } from 'node:crypto';

const PUBLIC_CODE = /^pc\.([0-9a-f]{32})\.([0-9a-f]{32})\.[A-Za-z0-9_-]{43}$/;
const hex = (uuid) => String(uuid).replaceAll('-', '').toLowerCase();
const uuidOf = (h) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

export const isPublicClientId = (value) => typeof value === 'string' && value.startsWith('pcl_');
export const publicAuthCode = (tenantId, identityId) =>
  `pc.${hex(tenantId)}.${hex(identityId)}.${randomBytes(32).toString('base64url')}`;
export function parsePublicCode(code) {
  const found = PUBLIC_CODE.exec(String(code ?? ''));
  return found ? Object.freeze({ tenantId: uuidOf(found[1]), identityId: uuidOf(found[2]) }) : null;
}
