// Each pilot member's GitHub user authorization is a distinct encrypted
// record, not a shared gh_accounts U token. Never allow a member to obtain
// another member's user bearer through the organization account name.
import { encryptSecret, decryptSecret, readEncryptionKey } from '../core/crypto.js';
import { GithubClientError } from '../github/errors.js';
import { randomUUID } from 'node:crypto';
import { verifyGithubBearerIdentity, verifyGithubUserInstallation } from './github-identity.js';

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

/** Refresh belongs to one user/tenant/account, not an installation-wide
 * gh_accounts row. PostgreSQL permits at most one process to spend the stored
 * refresh token. GitHub validates the *new* bearer and App installation before
 * the replacement is committed. No secret is ever included in an error. */
async function renewPilotUser({ directory, tenant, db, account, row, env, now, fetchImpl }) {
  if (!row.refresh_enc || !row.refresh_expires_at ||
      new Date(row.refresh_expires_at).getTime()<=now() ||
      typeof directory.claimPilotUserRefresh!=='function' || !db ||
      !env.GITHUB_PILOT_APP_CLIENT_ID || !env.GITHUB_PILOT_APP_CLIENT_SECRET)
    throw denied();
  const scope={tenantId:tenant.tenantId,identityId:tenant.identityId,
    accountLogin:account.toLowerCase()};
  const claimId=randomUUID();
  const got=await directory.claimPilotUserRefresh({
    ...scope,expectedAccessEnc:row.access_enc,claimId
  });
  if (!got) throw new GithubClientError('rate_limited',
    'Your personal GitHub authorization is being renewed. Retry shortly.');
  let invalidGrant=false;
  try {
    const key=readEncryptionKey(env);
    const refreshToken=decryptSecret(got.refresh_enc,{
      aad:aad(tenant.tenantId,tenant.identityId,account,'refresh'),key
    });
    const result=await fetchImpl('https://github.com/login/oauth/access_token',{
      method:'POST',signal:AbortSignal.timeout(15000),
      headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:env.GITHUB_PILOT_APP_CLIENT_ID,
        client_secret:env.GITHUB_PILOT_APP_CLIENT_SECRET,
        grant_type:'refresh_token',refresh_token:refreshToken})
    });
    const data=await result.json();
    if (!result.ok || data?.error) {
      invalidGrant=['invalid_grant','bad_refresh_token'].includes(data?.error);
      throw denied();
    }
    const access=data?.access_token,refresh=data?.refresh_token;
    const expiresIn=Number(data?.expires_in);
    const refreshIn=Number(data?.refresh_token_expires_in);
    if (typeof access!=='string' || access.length<8 || access.length>4096 ||
        typeof refresh!=='string' || refresh.length<8 || refresh.length>4096 ||
        !Number.isSafeInteger(expiresIn) || expiresIn<60 || expiresIn>31536000 ||
        !Number.isSafeInteger(refreshIn) || refreshIn<60 || refreshIn>31536000)
      throw denied();
    const actual=await verifyGithubBearerIdentity(access,{fetchImpl});
    const expected=await directory.getPilotVerifiedSubject(scope.tenantId,scope.identityId);
    const app=await db.getAccount(account);
    if (!expected || actual.subject!==expected || !app ||
        app.credential_kind!=='app' || app.installation_status!=='active' ||
        !await verifyGithubUserInstallation(access,{
          installationId:app.installation_id,appId:app.app_id,
          accountId:app.account_id,fetchImpl
        })) throw denied();
    const newer=await directory.finishPilotUserRefresh({
      ...scope,expectedAccessEnc:row.access_enc,claimId,
      accessEnc:encryptSecret(access,{
        aad:aad(scope.tenantId,scope.identityId,account,'access'),key}),
      accessExpiresAt:new Date(now()+expiresIn*1000),
      refreshEnc:encryptSecret(refresh,{
        aad:aad(scope.tenantId,scope.identityId,account,'refresh'),key}),
      refreshExpiresAt:new Date(now()+refreshIn*1000)
    });
    if (!newer) throw denied();
    return access;
  } catch {
    if (invalidGrant && typeof directory.invalidatePilotUserRefresh==='function')
      await directory.invalidatePilotUserRefresh({
        ...scope,expectedAccessEnc:row.access_enc,claimId
      }).catch(()=>{});
    throw denied();
  } finally {
    await directory.releasePilotUserRefresh({...scope,claimId}).catch(()=>{});
  }
}

/** Returns the ordinary scoped installation credential API unchanged for
 * 'I', but forbids P/K sharing and uses identity-bound U data exclusively.
 * Every user token read enforces fresh membership/allowlist via directory. */
export function createTenantScopedCredentials({ base, directory, tenant, db,
  env = process.env, now = Date.now, fetchImpl = fetch }) {
  if (!base || typeof base.token!=='function' ||
      !directory || typeof directory.getPilotUserAuthorization!=='function' ||
      !tenant?.tenantId || !tenant?.identityId)
    throw new TypeError('Private tenant credential scope required.');
  const key=()=>readEncryptionKey(env);
  return {
    ...base,
    async token(args={}) {
      const cred=args.cred??'I';
      // GitHub explicitly limits an App USER token to the intersection of
      // the user's and the App's permissions. An invited member must NEVER
      // inherit an installation-wide I token; route ordinary I-mode tools
      // through that member's own U token instead. The provider will refuse
      // App-only endpoints the user is not authorized to call.
      if (cred==='I' && tenant.role==='owner') return base.token(args);
      if (cred!=='U' && cred!=='I') throw denied();
      if (typeof args.account!=='string') throw denied();
      const row=await directory.getPilotUserAuthorization(
        tenant.tenantId,tenant.identityId,args.account.toLowerCase());
      if (!row || !row.access_enc) throw denied();
      if (new Date(row.access_expires_at).getTime()<=now()+60_000)
        return renewPilotUser({directory,tenant,db,account:args.account,
          row,env,now,fetchImpl});
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
