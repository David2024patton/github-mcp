// PUB-2: private GitHub-App user OAuth -> tenant-scoped MCP OAuth authorization.
// Not public onboarding. The startup gate, server-signed client, owner allowlist,
// active GitHub App installation, verified numeric /user and single-use CSRF/PKCE
// must ALL pass. The GitHub OAuth bearer is held only in this request's memory.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { createTenantDirectory, openAuthorizedTenantDb } from './directory.js';
import { verifyTenantCredential } from './routed-credential.js';
import { verifyGithubBearerIdentity, verifyGithubUserInstallation } from './github-identity.js';
import { storePilotUserGrant } from './user-authorization.js';
import { validRedirectUri } from '../core/oauth.js';
import { publicOrigin } from '../core/http.js';

const gitAuthorize = 'https://github.com/login/oauth/authorize';
const gitToken = 'https://github.com/login/oauth/access_token';
const challengeValid = /^[A-Za-z0-9_-]{43}$/;
const codeValid = /^[A-Za-z0-9_-]{8,256}$/;
const stateValid = /^[A-Za-z0-9_-]{32,256}$/;
const sha = text => createHash('sha256').update(text).digest('hex');
const random = n => randomBytes(n).toString('base64url');
const refused = () => new Error('Private GitHub authorization was not verified.');

export function createPrivateGitHubConsent({ env = process.env, fetchImpl = fetch,
  rootSqlFactory = neon, tenantSqlFactory = neon } = {}) {
  const active = () => {
    if (env.GITHUB_PRIVATE_TENANT_PILOT !== 'enabled') throw refused();
    if (!env.DATABASE_URL || !env.GITHUB_PILOT_APP_CLIENT_ID ||
        !env.GITHUB_PILOT_APP_CLIENT_SECRET ||
        !/^[1-9][0-9]{0,18}$/.test(String(env.GITHUB_PILOT_APP_ID || ''))) throw refused();
    return publicOrigin(env);
  };
  const directory = () => createTenantDirectory(rootSqlFactory(env.DATABASE_URL));
  const scoped = (directory, claim) => openAuthorizedTenantDb({
    directory, tenantId:claim.tenantId, verifiedIdentityId:claim.identityId,
    connectionString:env.DATABASE_URL,sqlFactory:tenantSqlFactory
  });
  const callback = () => active()+'/api/tenant/oauth/callback';

  async function start(p) {
    active();
    const claim = verifyTenantCredential(p.client_id,'tcl',env);
    const mode=p.mode??'preview', profile=p.profile??'everyday',
      listing=p.listing??'compact';
    if (!claim || p.response_type !== 'code' || p.code_challenge_method !== 'S256' ||
        !challengeValid.test(String(p.code_challenge || '')) ||
        p.resource !== active()+'/api/mcp' || !validRedirectUri(p.redirect_uri) ||
        (p.state !== undefined && (typeof p.state !== 'string' || p.state.length > 256)) ||
        !['preview','production'].includes(mode) ||
        !['full','everyday','read_only'].includes(profile) ||
        !['compact','catalog'].includes(listing) ||
        (p.account!==undefined &&
          (typeof p.account!=='string' || !/^[A-Za-z0-9-]{1,39}$/.test(p.account)))) throw refused();
    const dir=directory();
    const pilot=await dir.authorizedPilotIdentity(claim.tenantId,claim.identityId);
    if (!pilot || pilot.membershipRevision!==claim.membershipRevision ||
        pilot.pilotRevision!==claim.pilotRevision) throw refused();
    const { db }=await scoped(dir,claim);
    const client=await db.getOAuthClient(p.client_id);
    if (!client || !client.redirect_uris.includes(p.redirect_uri)) throw refused();
    // Standard MCP OAuth clients don't carry custom account selections. For
    // the first private pilot, infer an account ONLY if exactly one active
    // installation of this service-owned App exists in that tenant. Never
    // silently select between two accounts or fall back to the owner's DB.
    const available=await db.listAccounts();
    const candidates=available.filter(row =>
      row.credential_kind==='app' &&
      row.app_id===Number(env.GITHUB_PILOT_APP_ID) &&
      row.installation_status==='active' &&
      Number.isSafeInteger(row.installation_id) && row.installation_id>0);
    const selected=p.account!==undefined
      ? candidates.find(row=>row.login.toLowerCase()===p.account.toLowerCase())
      : candidates.length===1?candidates[0]:null;
    if (!selected) throw refused();
    const account=await db.getAccount(selected.login);
    if (!account || account.credential_kind!=='app' ||
        account.app_id!==Number(env.GITHUB_PILOT_APP_ID) ||
        !Number.isSafeInteger(account.installation_id) || account.installation_id<=0 ||
        account.installation_status!=='active' ||
        !['all','selected'].includes(account.repository_selection) ||
        (mode==='production' && (env.VERCEL_ENV!=='production' ||
          account.production_enabled!==true))) throw refused();
    const state=random(32), verifier=random(48);
    const challenge=createHash('sha256').update(verifier).digest('base64url');
    const stored=await dir.createPilotOAuthFlow({stateHash:sha(state),
      tenantId:claim.tenantId,identityId:claim.identityId,clientId:p.client_id,
      redirectUri:p.redirect_uri,clientState:p.state??null,
      codeChallenge:p.code_challenge,accountLogin:account.login,
      mode,profile,listing,providerVerifier:verifier});
    if (!stored) throw refused();
    const q=new URLSearchParams({client_id:env.GITHUB_PILOT_APP_CLIENT_ID,
      redirect_uri:callback(),state,code_challenge:challenge,
      code_challenge_method:'S256'});
    return {url:gitAuthorize+'?'+q.toString(),csrfState:state};
  }

  async function finish({state,code,browserCsrf}) {
    active();
    if (!stateValid.test(String(state || '')) || !codeValid.test(String(code || '')) ||
        typeof browserCsrf!=='string' || browserCsrf.length!==state.length ||
        !timingSafeEqual(Buffer.from(state),Buffer.from(browserCsrf))) throw refused();
    const dir=directory();
    // Claim state BEFORE sending any provider request. A failed/replayed code
    // does not recreate a usable state or enable a second callback.
    const flow=await dir.consumePilotOAuthFlow(sha(state));
    if (!flow) throw refused();
    const claim=verifyTenantCredential(flow.clientId,'tcl',env);
    if (!claim || claim.tenantId!==flow.tenantId ||
        claim.identityId!==flow.identityId) throw refused();
    const pilot=await dir.authorizedPilotIdentity(claim.tenantId,claim.identityId);
    if (!pilot || pilot.membershipRevision!==claim.membershipRevision ||
        pilot.pilotRevision!==claim.pilotRevision) throw refused();
    const { db }=await scoped(dir,claim);
    const account=await db.getAccount(flow.accountLogin);
    const client=await db.getOAuthClient(flow.clientId);
    if (!client || !client.redirect_uris.includes(flow.redirectUri) ||
        !account || account.credential_kind!=='app' ||
        account.app_id!==Number(env.GITHUB_PILOT_APP_ID) ||
        !Number.isSafeInteger(account.installation_id) || account.installation_id<=0 ||
        account.installation_status!=='active' ||
        (flow.mode==='production' && (env.VERCEL_ENV!=='production' ||
          account.production_enabled!==true))) throw refused();
    const exchange=await fetchImpl(gitToken,{
      method:'POST',signal:AbortSignal.timeout(10000),
      headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:env.GITHUB_PILOT_APP_CLIENT_ID,
        client_secret:env.GITHUB_PILOT_APP_CLIENT_SECRET,code,
        redirect_uri:callback(),code_verifier:flow.providerVerifier})
    });
    if (!exchange.ok) throw refused();
    const data=await exchange.json();
    if (!data?.access_token || data.error) throw refused();
    const principal=await verifyGithubBearerIdentity(data.access_token,{fetchImpl});
    const validated=await dir.resolveAllowlistedPilotSubject(claim.tenantId,principal.subject);
    if (!validated || validated.identityId!==claim.identityId ||
        validated.membershipRevision!==pilot.membershipRevision) throw refused();
    if (!await verifyGithubUserInstallation(data.access_token,{
      installationId:account.installation_id,
      appId:Number(env.GITHUB_PILOT_APP_ID),
      accountId:account.account_id,fetchImpl
    })) throw refused();
    const latest=await dir.authorizedPilotIdentity(claim.tenantId,claim.identityId);
    if (!latest || latest.membershipRevision!==claim.membershipRevision ||
        latest.pilotRevision!==claim.pilotRevision ||
        latest.membershipRevision!==validated.membershipRevision ||
        latest.pilotRevision!==validated.pilotRevision) throw refused();
    // A successful GitHub user-to-server consent must also authorize the
    // tenant's U-credential tools; a verified identity alone cannot perform
    // personal-user API calls. Save only sealed provider credentials into the
    // tenant's isolated account row using the existing audited crypto layer.
    // Expiry claims must be numeric and bounded; refuse malformed tokens.
    const expiresIn=Number(data.expires_in ?? 28800);
    const refreshExpiresIn=data.refresh_token_expires_in==null
      ? null : Number(data.refresh_token_expires_in);
    if (!Number.isSafeInteger(expiresIn) || expiresIn<60 || expiresIn>31536000 ||
        (refreshExpiresIn!==null &&
          (!Number.isSafeInteger(refreshExpiresIn) || refreshExpiresIn<60 ||
            refreshExpiresIn>31536000)) ||
        (data.refresh_token!==undefined &&
          (typeof data.refresh_token!=='string' ||
           data.refresh_token.length<8 || data.refresh_token.length>4096))) throw refused();
    const saved=await storePilotUserGrant({
      directory:dir,tenantId:claim.tenantId,identityId:claim.identityId,
      account:account.login,userLogin:principal.login,
      accessToken:data.access_token,expiresIn,
      refreshToken:data.refresh_token??null,refreshExpiresIn,env
    });
    if (!saved) throw refused();
    const mcpCode=random(32);
    await db.createAuthCode({code:mcpCode,clientId:flow.clientId,
      redirectUri:flow.redirectUri,codeChallenge:flow.codeChallenge,
      codeChallengeMethod:'S256',defaultAccount:account.login,
      accounts:[account.login],mode:flow.mode,profile:flow.profile,listing:flow.listing});
    const url=new URL(flow.redirectUri);
    url.searchParams.set('code',mcpCode);
    if (flow.clientState !== null) url.searchParams.set('state',flow.clientState);
    return url.toString();
  }
  return {start,finish};
}
