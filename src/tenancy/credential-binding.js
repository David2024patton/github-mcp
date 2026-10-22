// CAP-3: metadata bound to the EXISTING encrypted private-user grant. There is
// no second token store, no bearer input/output and no provider I/O here.
import { createHash } from 'node:crypto';

const subjectPattern=/^[1-9][0-9]{0,15}$/;
const loginPattern=/^[a-z0-9][a-z0-9-]{0,38}$/;
const positive=n=>Number.isSafeInteger(n)&&n>0;
export const cipherFingerprint=value=>createHash('sha256').update(value).digest('hex');

/** Only a server-verified GitHub App user identity + installation readback can
 * construct this record. It proves GET /user identity, NOT write permissions,
 * repository access, or general installation-wide authority. */
export function userGrantBinding({subject,tenant,account,accessEnc,expiresAt}) {
  if (!subjectPattern.test(String(subject)) || !positive(Number(subject)) ||
      !tenant?.tenantId || !tenant?.identityId ||
      !positive(tenant.membershipRevision) || !positive(tenant.pilotRevision) ||
      !positive(account?.account_id) || !positive(account.installation_id) ||
      !positive(account.app_id) || account.credential_kind!=='app' ||
      account.installation_status!=='active' ||
      !loginPattern.test(String(account.login).toLowerCase()) ||
      typeof accessEnc!=='string' || !accessEnc.startsWith('v1.') ||
      !Number.isFinite(new Date(expiresAt).getTime()))
    throw new TypeError('Verified scoped user grant binding required.');
  return Object.freeze({version:1,kind:'app_user',host:'github.com',
    githubUserId:Number(subject),tenantId:tenant.tenantId,identityId:tenant.identityId,
    membershipRevision:tenant.membershipRevision,pilotRevision:tenant.pilotRevision,
    accountId:account.account_id,login:account.login.toLowerCase(),
    installationId:account.installation_id,appId:account.app_id,
    fingerprint:cipherFingerprint(accessEnc),expiresAt:new Date(expiresAt).toISOString(),
    resources:['user/'+subject],permissions:[],scopes:[],
    operations:['GET /user'],verification:'identity-and-capability-readback'});
}

/** Fail closed for legacy grants without proof. A refresh/replacement, context
 * switch, allowlist cycle or new installation invalidates the old binding.
 * Return an allowlisted copy; unknown DB fields can never leak into tools. */
export function currentUserGrantBinding({row,tenant,subject,account,now=Date.now(),allowExpired=false}) {
  try {
    const proof=row?.authority_binding;
    const expected=userGrantBinding({subject,tenant,account,
      accessEnc:row.access_enc,expiresAt:row.access_expires_at});
    if (!proof || proof.version!==1 || (!allowExpired && new Date(expected.expiresAt).getTime()<=now) ||
        Object.keys(expected).some(k=>JSON.stringify(expected[k])!==JSON.stringify(proof[k])))
      return null;
    return {...expected,currentCipherFingerprint:expected.fingerprint};
  } catch { return null; }
}
