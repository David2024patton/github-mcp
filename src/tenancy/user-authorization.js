// Each pilot member's GitHub user authorization is a distinct encrypted
// record, not a shared gh_accounts U token. Never allow a member to obtain
// another member's user bearer through the organization account name.
import { encryptSecret, decryptSecret, readEncryptionKey } from '../core/crypto.js';
import { GithubClientError } from '../github/errors.js';

const aad=(tenantId,identityId,account,kind)=>
  `github-mcp/private-tenant/${tenantId}/identity/${identityId}/account/${account.toLowerCase()}/${kind}`;
const denied=()=>new GithubClientError('no_credentials',
  'Your own GitHub user authorization is unavailable or expired. Sign in through GitHub again.');

export async function storePilotUserGrant({ directory, tenantId, identityId,
  account, userLogin, accessToken, refreshToken = null, expiresIn,
  refreshExpiresIn = null, env = process.env, now = Date.now }) {
  if (typeof accessToken!=='string' || accessToken.length<8 || accessToken.length>4096 ||
      !Number.isSafeInteger(expiresIn) || expiresIn<60 || expiresIn>31536000 ||
      (refreshToken!==null && (typeof refreshToken!=='string' ||
        refreshToken.length<8 || refreshToken.length>4096)) ||
      (refreshExpiresIn!==null && (!Number.isSafeInteger(refreshExpiresIn) ||
        refreshExpiresIn<60 || refreshExpiresIn>31536000)))
    throw new TypeError('Invalid user authorization details.');
  const key=readEncryptionKey(env);
  const at=now();
  const accessEnc=encryptSecret(accessToken,{
    aad:aad(tenantId,identityId,account,'access'),key});
  const refreshEnc=refreshToken===null?null:encryptSecret(refreshToken,{
    aad:aad(tenantId,identityId,account,'refresh'),key});
  const stored=await directory.storePilotUserAuthorization({
    tenantId,identityId,accountLogin:account.toLowerCase(),userLogin,
    accessEnc,accessExpiresAt:new Date(at+expiresIn*1000),
    refreshEnc,refreshExpiresAt:refreshToken===null?null:
      new Date(at+(refreshExpiresIn??15811200)*1000)
  });
  if (!stored) throw denied();
  return true;
}

/** Returns the ordinary scoped installation credential API unchanged for
 * 'I', but forbids P/K sharing and uses identity-bound U data exclusively.
 * Every user token read enforces fresh membership/allowlist via directory. */
export function createTenantScopedCredentials({ base, directory, tenant,
  env = process.env, now = Date.now }) {
  if (!base || typeof base.token!=='function' ||
      !directory || typeof directory.getPilotUserAuthorization!=='function' ||
      !tenant?.tenantId || !tenant?.identityId)
    throw new TypeError('Private tenant credential scope required.');
  const key=()=>readEncryptionKey(env);
  return {
    ...base,
    async token(args={}) {
      const cred=args.cred??'I';
      // An invited member's U permission is not authority to use the
      // organization-wide installation token. That App may grant access to
      // repositories the individual cannot reach. Until PUB-2 proves live
      // per-repo delegation, only the tenant's owner can use I.
      if (cred==='I') {
        if (tenant.role!=='owner') throw denied();
        return base.token(args);
      }
      if (cred!=='U') throw denied();
      if (typeof args.account!=='string') throw denied();
      const row=await directory.getPilotUserAuthorization(
        tenant.tenantId,tenant.identityId,args.account.toLowerCase());
      if (!row || !row.access_enc ||
          new Date(row.access_expires_at).getTime()<=now()+60_000)
        throw denied();
      try {
        return decryptSecret(row.access_enc,{
          aad:aad(tenant.tenantId,tenant.identityId,args.account,'access'),key:key()
        });
      } catch {
        throw denied();
      }
    },
    async forgetUserAuthorization(account) {
      if (typeof account!=='string') return;
      await directory.revokePilotUserAuthorization(tenant.tenantId,
        tenant.identityId,account.toLowerCase());
    }
  };
}
